"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  T = require("../../src/server/progression/title-chest-rewards"),
  { createGameServer } = require("../../src/server/game-server");
const NOW = Date.UTC(2026, 9, 28, 12);
function fixture(filePath) {
  const store = new ProfileStore({ filePath, now: () => NOW }),
    auth = store.open();
  const p = () => store.find(auth.token);
  function grant(mass) {
    store.transact(auth.token, randomUUID(), "fixture-greatness", p => { p.greatness = mass; });
    store.transact(auth.token, randomUUID(), "fixture-settle", () => {});
  }
  return { store, auth, p, grant };
}
test("Звания: несколько новых наград, одноразовый показ, повтор, запись и восстановление", (t) => {
  const filePath = path.join(temporary(t, "title-notice"), "profiles.json"),
    { store, auth, p, grant } = fixture(filePath);
  grant(25000);
  assert.deepEqual(
    store.view(p()).honors.notifications.map((n) => n.id),
    ["novice", "experienced", "expert"],
  );
  const input = { degree: 1, requestId: randomUUID() },
    before = structuredClone(p()),
    save = store.save;
  store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => store.acknowledgeTitle(auth.token, input), /disk failure/);
  assert.deepEqual(p(), before);
  store.save = save;
  store.acknowledgeTitle(auth.token, input);
  assert.equal(store.view(p()).honors.notifications.length, 2);
  assert.equal(store.acknowledgeTitle(auth.token, input).replay, true);
  assert.deepEqual(p().wallet, before.wallet);
  assert.deepEqual(p().inventory, before.inventory);
  assert.equal(p().greatness, before.greatness);
  assert.throws(() => store.acknowledgeTitle(auth.token, { ...input, degree: 2 }));
  assert.throws(() => store.acknowledgeTitle(auth.token, { degree: 4, requestId: randomUUID() }));
  for (const degree of [0, -1, 1.5, "1", 11, null])
    assert.throws(() => store.acknowledgeTitle(auth.token, { degree, requestId: randomUUID() }));
  store.acknowledgeTitle(auth.token, { degree: 3, requestId: randomUUID() });
  const restored = new ProfileStore({ filePath, now: () => NOW });
  assert.deepEqual(restored.view(restored.find(auth.token)).honors.notifications, []);
  grant(100000);
  assert.deepEqual(
    store.view(p()).honors.notifications.map((n) => n.id),
    ["sage"],
  );
});
test("Старый профиль не получает историю окон, но получает уведомление о следующем звании", () => {
  const { store, p, grant } = fixture();
  grant(25000);
  delete p().honors.notified;
  assert.deepEqual(store.view(p()).honors.notifications, []);
  grant(100000);
  assert.equal(p().honors.notified, 3);
  assert.deepEqual(
    store.view(p()).honors.notifications.map((n) => n.id),
    ["sage"],
  );
});
test("Старый подготовленный сундук Мудреца: база, без нового розыгрыша и без списания уже выданного", () => {
  const { store, auth, p, grant } = fixture();
  grant(100000);
  store.prepareChest(auth.token, "sage", randomUUID());
  const base = structuredClone(p().honors.pending);
  for (const factor of [2, 3, 4]) {
    p().honors.pending = structuredClone(base);
    p().honors.pending.multiplier = factor;
    for (const key of ["coins", "crystals", "bucks"]) p().honors.pending[key] *= factor;
    for (const key of Object.keys(base.items)) p().honors.pending.items[key] *= factor;
    T.validateHonors(p());
    const view = store.view(p()).honors;
    assert.deepEqual(view.pending, base);
    assert.equal(view.tiers[3].boosters, 1250);
    assert.equal(view.tiers[3].bucks, 375);
  }
  const before = structuredClone(p()),
    req = randomUUID(),
    save = store.save;
  store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => store.openChest(auth.token, "sage", req), /disk failure/);
  assert.deepEqual(p(), before);
  store.save = save;
  store.openChest(auth.token, "sage", req);
  assert.equal(p().wallet.bucks - before.wallet.bucks, 375);
  for (const [id, n] of Object.entries(base.items))
    assert.equal(p().inventory[id] - (before.inventory[id] || 0), n);
  const after = structuredClone(p());
  store.openChest(auth.token, "sage", req);
  assert.deepEqual(p(), after);
});
test("HTTP отметка звания: сессия, чужой origin, повтор и восстановление после отказа записи", async (t) => {
  const f = fixture();
  f.grant(100);
  const app = createGameServer({
    profiles: f.store,
    autoTick: false,
    testBots: { enabled: false },
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const input = { degree: 1, requestId: randomUUID() };
  const post = (headers = {}) =>
    fetch(url + "/api/profile/title-notice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `sferorumiya_session=${f.auth.token}`,
        ...headers,
      },
      body: JSON.stringify(input),
    });
  assert.notEqual((await post({ Cookie: "" })).status, 200);
  assert.equal((await post({ Origin: "https://untrusted.example" })).status, 403);
  const responses = await Promise.all([post(), post()]),
    values = await Promise.all(responses.map((r) => r.json()));
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(values.filter((v) => v.replay).length, 1);
  assert.equal(f.p().honors.notified, 1);
});
