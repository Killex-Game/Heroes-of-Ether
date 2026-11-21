/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp");
const { grantAll, GRANT_ID, AMOUNTS } = require("../../scripts/development/grant-test-inventory");
test("Тестовая выдача: прибавление всем существующим профилям, сохранение и защита от повтора", (t) => {
  const filePath = path.join(temporary(t, "grant"), "profiles.json"),
    store = new ProfileStore({ filePath });
  const a = store.open(),
    b = store.open();
  store.find(a.token).inventory.candy = 7;
  store.find(a.token).wallet.coins = 25;
  store.startLife(a.profile.id, "grant-test-life");
  const before = structuredClone(store.data);
  assert.deepEqual(grantAll(store), { replay: false, count: 2 });
  for (const [key, p] of Object.entries(before.profiles)) {
    const actual = store.data.profiles[key];
    for (const [currency, amount] of Object.entries(AMOUNTS))
      assert.equal(actual.wallet[currency], p.wallet[currency] + amount);
    assert.deepEqual(actual.inventory, p.inventory);
    assert.deepEqual(actual.progress, p.progress);
    assert.deepEqual(actual.honors, p.honors);
    assert.deepEqual(actual.receipts, p.receipts);
    assert.equal(actual.revision, p.revision + 1);
  }
  const after = structuredClone(store.data);
  assert.deepEqual(grantAll(store), { replay: true, count: 2 });
  assert.deepEqual(store.data, after);
  const disk = new ProfileStore({ filePath });
  assert.equal(disk.data.testGrants[GRANT_ID].count, 2);
  const newcomer = disk.open();
  assert.deepEqual(newcomer.profile.wallet, { coins: 100, crystals: 10, bucks: 0 });
  const persisted = structuredClone(disk.data);
  assert.equal(grantAll(disk).replay, true);
  assert.deepEqual(disk.data, persisted);
  assert.deepEqual(disk.find(b.token).wallet, { coins: 20100, crystals: 2010, bucks: 1000 });
});
test("Ошибка записи или переполнение отменяют всю тестовую выдачу", () => {
  const store = new ProfileStore(),
    a = store.open();
  store.open();
  const before = structuredClone(store.data),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => grantAll(store), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save;
  store.find(a.token).wallet.bucks = Number.MAX_SAFE_INTEGER;
  const overflow = structuredClone(store.data);
  assert.throws(() => grantAll(store), /баланс/);
  assert.deepEqual(store.data, overflow);
  store.find(a.token).wallet.bucks = 0;
  assert.equal(grantAll(store).replay, false);
});
