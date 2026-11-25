"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const { awardTitles } = require("../../src/server/progression/title-chest-rewards");
const { view } = require("../../src/server/rankings/hall-of-fame");

function add(store, greatness, at) {
  const auth = store.open(),
    p = store.find(auth.token);
  p.greatness = greatness;
  p.personal = { nameSet: true, gender: "male", vkUrl: "" };
  if (at) awardTitles(p, at);
  return { auth, p };
}

test("Зал: только заслуженные Герои, текущий рейтинг, стабильные ничьи, страницы и публичные поля", () => {
  const store = new ProfileStore();
  assert.equal(view(store).total, 0);
  add(store, 9999999); // A balance or a test appearance grant alone is not an earned medal.
  const old = add(store, 2000000, 1000).p;
  const newer = add(store, 2000000, 2000).p;
  const historical = add(store, 2000000, 3000).p;
  delete historical.honors.medals;
  const former = add(store, 3000000, 1000).p;
  former.greatness = 50; // Earned titles are permanent.
  for (let i = 0; i < 8; i++) add(store, 2100000 + i, 1000);
  const before = JSON.stringify(store.data),
    first = view(store);
  assert.equal(first.total, 12);
  assert.equal(first.top.length, 7);
  assert.equal(first.heroes.length, 8);
  assert.equal(first.pages, 2);
  const second = view(store, 2);
  assert.deepEqual(
    second.heroes.map((p) => p.id),
    [old.id, newer.id, historical.id, former.id],
  );
  assert.equal(second.heroes[2].awardedAt, null);
  assert.deepEqual(
    second.heroes.map((p) => p.rank),
    [9, 10, 11, 12],
  );
  assert.deepEqual(second.top, first.top);
  assert.deepEqual(Object.keys(first.top[0]).sort(), [
    "awardedAt",
    "clanPrefix",
    "greatness",
    "id",
    "level",
    "name",
    "rank",
    "skinId",
  ]);
  for (const page of ["invalid", -1, 0, 1.2, Infinity]) assert.equal(view(store, page).page, 1);
  assert.equal(view(store, 999).page, 2);
  assert.equal(JSON.stringify(store.data), before);
});

test("Hall carries active gift appearance without changing the earned hero skin", () => {
  let at=10000;const store=new ProfileStore({now:()=>at}),p=add(store,2000000,1000).p;
  const original=p.skinId;p.social={giftEffects:{curse:11000,hex:12000}};
  assert.deepEqual(view(store).heroes[0].giftAppearance,{curse:11000,hex:12000});
  at=11000;assert.deepEqual(view(store).heroes[0].giftAppearance,{hex:12000});
  at=12000;assert.equal(view(store).heroes[0].giftAppearance,undefined);assert.equal(p.skinId,original);
});

test("Зал не пишет прогресс: повторы, недоступный диск и загрузка сохранения не меняют награды", (t) => {
  const filePath = path.join(temporary(t, "hall"), "profiles.json");
  const store = new ProfileStore({ filePath });
  add(store, 2400000, Date.now());
  store.save(store.data);
  const before = fs.readFileSync(filePath),
    expected = view(store);
  store.save = () => {
    throw Error("disk failure");
  };
  for (let i = 0; i < 10; i++) assert.deepEqual(view(store), expected);
  assert.deepEqual(fs.readFileSync(filePath), before);
  const restarted = new ProfileStore({ filePath });
  assert.deepEqual(view(restarted), expected);
});

test("API зала требует входа, не создаёт профиль и отдаёт повторяемый ответ после обрыва", async (t) => {
  const store = new ProfileStore();
  const { auth } = add(store, 2100000, Date.now());
  const app = createGameServer({ profiles: store, autoTick: false, testBots: { enabled: false } });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = "http://127.0.0.1:" + app.httpServer.address().port + "/api/hall-of-fame";
  const before = JSON.stringify(store.data);
  assert.equal((await fetch(url)).status, 401);
  const headers = { Cookie: "sferorumiya_session=" + auth.token };
  const controller = new AbortController();
  const request = fetch(url, { headers, signal: controller.signal }).catch(() => null);
  controller.abort();
  await request;
  const first = await fetch(url, { headers });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), view(store));
  assert.deepEqual(await (await fetch(url, { headers })).json(), view(store));
  assert.equal(JSON.stringify(store.data), before);
});
