"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  accounts = require("../../src/server/accounts/account-benefits"),
  {
    awardTitles,
    publicTitle,
    publicHonors,
  } = require("../../src/server/progression/title-chest-rewards"),
  { temporary } = require("../temp");
const NOW = Date.UTC(2026, 9, 27, 12),
  DAY = 86400000;
function fixture(t, name) {
  const filePath = path.join(temporary(t, name), "profiles.json"),
    store = new ProfileStore({ filePath, now: () => NOW }),
    auth = store.open();
  const p = () => store.find(auth.token);
  p().greatness = 2000000;
  awardTitles(p(), NOW);
  return { filePath, store, auth, p };
}

for (const [vip, premium] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
]) {
  test(`Сундук героя: 90 дней каждого аккаунта, сохранение и повтор (VIP=${vip}, Premium=${premium})`, (t) => {
    const { filePath, store, auth, p } = fixture(t, "hero-chest");
    p().account = {
      ...accounts.fresh(),
      vipUntil: vip ? NOW + 12 * DAY : 0,
      premiumUntil: premium ? NOW + 17 * DAY : NOW - DAY,
    };
    assert.equal(publicTitle(p()).name, "Герой");
    const tier = publicHonors(p(), NOW).tiers.find((x) => x.id === "boss");
    assert.equal(tier.chestName, "Сундук героя");
    assert.deepEqual(tier.accountDays, { vip: 90, premium: 90 });
    store.prepareChest(auth.token, "boss", randomUUID());
    assert.deepEqual(p().honors.pending.accountDays, { vip: 90, premium: 90 });
    const disk = new ProfileStore({ filePath, now: () => NOW });
    const before = structuredClone(disk.find(auth.token)),
      save = disk.save,
      requestId = randomUUID();
    disk.save = () => {
      throw Error("TEST disk unavailable");
    };
    assert.throws(() => disk.openChest(auth.token, "boss", requestId), /disk unavailable/);
    assert.deepEqual(disk.find(auth.token), before);
    disk.save = save;
    disk.openChest(auth.token, "boss", requestId);
    const opened = structuredClone(disk.find(auth.token));
    assert.equal(opened.account.vipUntil, NOW + (90 + (vip ? 12 : 0)) * DAY);
    assert.equal(opened.account.premiumUntil, NOW + (90 + (premium ? 17 : 0)) * DAY);
    assert.equal(opened.honors.chests.boss, "opened");
    const restored = new ProfileStore({ filePath, now: () => NOW });
    assert.equal(restored.openChest(auth.token, "boss", requestId).replay, true);
    assert.deepEqual(restored.find(auth.token), opened);
    assert.throws(() => restored.openChest(auth.token, "boss", randomUUID()), /уже открыт/);
  });
}

test("Подготовленный до изменения сундук v5 сохраняет 180 дней, без повторной выдачи", (t) => {
  const { filePath, store, auth, p } = fixture(t, "hero-legacy-chest");
  store.prepareChest(auth.token, "boss", randomUUID());
  p().honors.pending.version = 5;
  p().honors.pending.accountDays = { vip: 180, premium: 180 };
  const pending = structuredClone(p().honors.pending);
  store.save(store.data);
  const disk = new ProfileStore({ filePath, now: () => NOW });
  disk.prepareChest(auth.token, "boss", randomUUID());
  assert.deepEqual(disk.find(auth.token).honors.pending, pending);
  const requestId = randomUUID();
  disk.openChest(auth.token, "boss", requestId);
  const opened = structuredClone(disk.find(auth.token));
  assert.equal(opened.account.vipUntil, NOW + 180 * DAY);
  assert.equal(opened.account.premiumUntil, NOW + 180 * DAY);
  disk.openChest(auth.token, "boss", requestId);
  assert.deepEqual(disk.find(auth.token), opened);
});
