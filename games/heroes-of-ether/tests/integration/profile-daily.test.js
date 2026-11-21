/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { once } = require("node:events");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  daily = require("../../src/server/rankings/daily-leaderboards"),
  { temporary } = require("../temp");
const NOW = Date.UTC(2026, 9, 19, 12);
function fixture(filePath) {
  let now = NOW;
  const store = new ProfileStore({ filePath, now: () => now }),
    auth = store.open();
  return {
    store,
    auth,
    p: () => store.find(auth.token),
    clock: (at) => {
      now = at;
    },
  };
}
function edit(f, name, extra = {}) {
  return f.store.setPersonal(f.auth.token, {
    name,
    expectedName: f.p().name,
    gender: "unspecified",
    requestId: randomUUID(),
    ...extra,
  });
}
test("Личные данные: первый ник бесплатно, последующие с подтверждением за 10, пол и тот же ник бесплатно", () => {
  const f = fixture();
  edit(f, "Лесник", { gender: "male" });
  assert.equal(f.p().wallet.crystals, 10);
  assert.equal(f.p().personal.nameSet, true);
  assert.equal(f.p().personal.gender, "male");
  assert.throws(() => edit(f, "Феникс"), /Подтверди/);
  assert.equal(f.p().name, "Лесник");
  edit(f, "Феникс", { confirmed: true });
  assert.equal(f.p().wallet.crystals, 0);
  edit(f, "Феникс", { gender: "female" });
  assert.equal(f.p().wallet.crystals, 0);
  assert.equal(f.p().personal.gender, "female");
  f.store.setLoadout(f.auth.token, {
    name: "Бесплатный обход",
    skinId: "moon-dragon",
    quickSlots: [],
    requestId: randomUUID(),
  });
  assert.equal(f.p().name, "Феникс");
});
test("Смена ника: повтор запроса, устаревшая вкладка, нехватка кристаллов и ошибка диска", () => {
  const f = fixture();
  edit(f, "Первый");
  const operation = {
    name: "Второй",
    expectedName: "Первый",
    gender: "male",
    confirmed: true,
    requestId: randomUUID(),
  };
  f.store.setPersonal(f.auth.token, operation);
  assert.equal(f.store.setPersonal(f.auth.token, operation).replay, true);
  assert.equal(f.p().wallet.crystals, 0);
  assert.throws(
    () =>
      f.store.setPersonal(f.auth.token, { ...operation, name: "Третий", requestId: randomUUID() }),
    /другой вкладке/,
  );
  f.p().wallet.crystals = 9;
  assert.throws(() => edit(f, "Третий", { confirmed: true }), /Недостаточно/);
  assert.equal(f.p().name, "Второй");
  f.p().wallet.crystals = 100;
  const before = structuredClone(f.p()),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => edit(f, "Третий", { confirmed: true }), /disk full/);
  assert.deepEqual(f.p(), before);
  f.store.save = save;
  for (const fields of [{ name: " " }, { name: "Я".repeat(17) }, { gender: "invalid" }])
    assert.throws(() => edit(f, "Третий", { confirmed: true, ...fields }));
});
test("Ник, пол и платная смена переживают перезапуск; старый профиль сохраняет ник и первую бесплатную установку", (t) => {
  const file = path.join(temporary(t, "personal"), "profiles.json"),
    f = fixture(file);
  edit(f, "Сохранён", { gender: "female" });
  let disk = new ProfileStore({ filePath: file, now: () => NOW });
  assert.equal(disk.find(f.auth.token).name, "Сохранён");
  assert.equal(disk.view(disk.find(f.auth.token)).personal.renameCost, 10);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const p of Object.values(data.profiles)) {
    delete p.personal;
    delete p.daily;
  }
  fs.writeFileSync(file, JSON.stringify(data));
  disk = new ProfileStore({ filePath: file, now: () => NOW });
  assert.equal(disk.find(f.auth.token).name, "Сохранён");
  assert.equal(disk.view(disk.find(f.auth.token)).personal.renameCost, 0);
  assert.equal(daily.current(disk.find(f.auth.token), NOW).greatness, 0);
});
test("Дневные киллы и время суммируются между жизнями; повтор пакета не начисляется", () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const lifeId = "life" + i;
    f.store.startLife(f.p().id, lifeId);
    const events = [
      { type: "massBonus", profileId: f.p().id, lifeId, sequence: 1, kills: 2 },
      { type: "lifeEnded", profileId: f.p().id, lifeId, durationSeconds: 70, reason: "left" },
    ];
    f.store.applyArenaProgress(lifeId, events, NOW + i * 100000);
    f.store.applyArenaProgress(lifeId, events, NOW + i * 100000);
  }
  const value = daily.current(f.p(), NOW);
  assert.equal(value.kills, 4);
  assert.equal(value.arenaSeconds, 140);
  assert.equal(value.greatness, f.p().greatness);
});
test("Дневное величие учитывает новые награды, а киллы после предела опыта не считаются", () => {
  const f = fixture();
  f.store.startLife(f.p().id, "cap");
  f.p().progress.session.xp = 500;
  f.store.applyArenaProgress(
    "bonus",
    [{ type: "massBonus", profileId: f.p().id, lifeId: "cap", sequence: 1, kills: 2 }],
    NOW,
  );
  assert.equal(daily.current(f.p(), NOW).kills, 0);
  assert.equal(f.p().progress.session.kills, 2);
  const before = f.p().greatness;
  f.store.transact(f.auth.token, randomUUID(), "greatness-test", (p) => {
    p.greatness += 100;
  });
  assert.equal(daily.current(f.p(), NOW).greatness, f.p().greatness - before);
});
test("Полночь МСК: сброс в 21:00 UTC, интервал жизни через границу и отсутствие сброса общих достижений", () => {
  const f = fixture(),
    midnight = Date.UTC(2026, 9, 19, 21);
  f.clock(midnight - 10000);
  f.store.startLife(f.p().id, "night");
  f.store.applyArenaProgress(
    "night-a",
    [{ type: "lifeTime", profileId: f.p().id, lifeId: "night", durationSeconds: 5 }],
    midnight - 5000,
  );
  assert.equal(daily.current(f.p(), midnight - 1).arenaSeconds, 5);
  assert.equal(daily.current(f.p(), midnight).arenaSeconds, 0);
  f.store.applyArenaProgress(
    "night-b",
    [{ type: "lifeTime", profileId: f.p().id, lifeId: "night", durationSeconds: 13 }],
    midnight + 3000,
  );
  assert.equal(daily.current(f.p(), midnight + 3000).arenaSeconds, 3);
  assert.equal(f.p().activity.arenaSeconds, 13);
  assert.equal(daily.nextReset(midnight), midnight + 86400000);
});
test("Постоянные клановые рейтинги: величие участников, XP при одинаковом уровне и казна; дневной сброс их не меняет", () => {
  const f = fixture(),
    clans = new ClanService(f.store),
    members = [f.auth, f.store.open(), f.store.open()],
    ids = [];
  for (const [i, who] of members.entries()) {
    const p = f.store.find(who.token);
    p.level = 12;
    p.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
    p.wallet.coins = 2000;
    clans.mutate(who.token, {
      action: "create",
      name: "Клан " + i,
      prefix: "К" + i,
      description: "",
      emblem: "grove",
      privacy: "open",
      requestId: randomUUID(),
    });
    ids.push(f.store.find(who.token).clanId);
  }
  for (const [i, id] of ids.entries()) {
    f.store.data.clans[id].xp = [100, 300, 200][i];
    f.store.data.clans[id].treasury = [10, 20, 30][i];
    f.store.find(members[i].token).greatness = [40, 10, 20][i];
  }
  const order = (sort) => clans.state(f.auth.token, "", 1, "", "greatness", 1, sort).clans;
  assert.deepEqual(
    order("greatness").map((c) => c.id),
    [ids[0], ids[2], ids[1]],
  );
  assert.deepEqual(
    order("level").map((c) => c.id),
    [ids[1], ids[2], ids[0]],
  );
  assert.ok(order("level").every((c) => c.progress.level === 1));
  assert.deepEqual(
    order("treasury").map((c) => c.id),
    [ids[2], ids[1], ids[0]],
  );
  f.clock(NOW + 86400000);
  assert.equal(order("treasury")[0].treasury, 30);
});
test("Личные данные HTTP: авторизация, Origin и запрет изменений на арене", async (t) => {
  const { createGameServer } = require("../../src/server/game-server"),
    WebSocket = require("ws"),
    app = createGameServer({ autoTick: false });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    response = await fetch(url + "/api/profile"),
    cookie = response.headers.get("set-cookie").split(";")[0];
  const body = { name: "Тест", expectedName: "Путник", gender: "male", requestId: randomUUID() };
  const post = (extra = {}) =>
    fetch(url + "/api/profile/personal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, ...extra },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ Cookie: "" })).status, 401);
  assert.equal((await post({ Origin: "https://other.invalid" })).status, 403);
  assert.equal((await post()).status, 200);
  const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  await once(ws, "message");
  assert.equal((await post()).status, 409);
  ws.close();
});
