"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp");
const catalog = require("../../public/shared/accessory-catalog");
const { createGameServer } = require("../../src/server/game-server");
const buy = (store, token, id, requestId = randomUUID()) =>
  store.setAccessory(token, {
    action: "buy",
    accessoryId: id,
    requestId,
    price: 0,
    currency: "bucks",
  });
test("Покупка восьми украшений: серверные цены, пассивные бонусы, повторы и восстановление", (t) => {
  const filePath = path.join(temporary(t, "accessory-shop"), "profiles.json"),
    store = new ProfileStore({ filePath }),
    auth = store.open();
  store.find(auth.token).wallet = { coins: 10000, crystals: 10000, bucks: 100 };
  const paid = catalog.items.filter((i) => i.price);
  assert.equal(paid.length, 8);
  const start = structuredClone(store.find(auth.token).wallet);
  for (const item of paid) {
    const id = randomUUID();
    assert.ok(Object.values(item.bonus).some(n => n > 0));
    assert.ok(!item.ability);
    assert.throws(
      () =>
        store.setAccessory(auth.token, {
          slot: item.slot,
          accessoryId: item.id,
          requestId: randomUUID(),
        }),
      /недоступен/,
    );
    buy(store, auth.token, item.id, id);
    assert.equal(buy(store, auth.token, item.id, id).replay, true);
    buy(store, auth.token, item.id);
    store.setAccessory(auth.token, {
      slot: item.slot,
      accessoryId: item.id,
      requestId: randomUUID(),
    });
    start[item.currency] -= item.price;
    assert.deepEqual(store.find(auth.token).wallet, start);
  }
  const disk = new ProfileStore({ filePath });
  assert.deepEqual(disk.find(auth.token).wallet, start);
  assert.deepEqual(
    disk.find(auth.token).purchasedAccessories,
    paid.map((i) => i.id),
  );
  assert.ok(disk.view(disk.find(auth.token)).wardrobe.owned.includes("gold_bow"));
});
test("Недостаток валюты, подмена товара и отказ записи не дают предмет и не списывают баланс", () => {
  const store = new ProfileStore(),
    auth = store.open();
  assert.throws(() => buy(store, auth.token, "gold_bow"), /Недостаточно/);
  assert.throws(() => buy(store, auth.token, "novice_hat"), /не продаётся/);
  store.find(auth.token).wallet.coins = 1000; // Fund the write-failure path beyond the 100-coin start.
  const before = structuredClone(store.find(auth.token)),
    save = store.save,
    id = randomUUID();
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => buy(store, auth.token, "black_bow", id), /disk full/);
  assert.deepEqual(store.find(auth.token), before);
  store.save = save;
  buy(store, auth.token, "black_bow", id);
  assert.equal(store.find(auth.token).wallet.coins, before.wallet.coins - 500);
});
test("HTTP: повтор после потерянного ответа списывает один раз; на арене покупка запрещена", async (t) => {
  const app = createGameServer({ autoTick: false, testBots: { enabled: false } });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    r = await fetch(url + "/api/profile"),
    cookie = r.headers.get("set-cookie").split(";")[0],
    auth = await r.json();
  const requestId = randomUUID(),
    post = (body) =>
      fetch(url + "/api/profile/accessory", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
  app.profiles.byId(auth.profile.id).wallet.coins = 1000;
  const operation = { action: "buy", accessoryId: "black_bow", requestId };
  const first = await post(operation);
  assert.equal(first.status, 200);
  await first.arrayBuffer();
  const retry = await post(operation),
    data = await retry.json();
  assert.equal(data.replay, true);
  assert.equal(data.profile.wallet.coins, 500);
  const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      if (JSON.parse(raw).type === "state") resolve();
    });
  });
  assert.equal(
    (await post({ action: "buy", accessoryId: "red_bow", requestId: randomUUID() })).status,
    409,
  );
  assert.equal(app.profiles.byId(auth.profile.id).wallet.coins, 500);
});
