"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const { POOLS } = require("../../src/server/progression/title-chest-rewards");
const products = require("../../public/shared/virtual-product-catalog");
const config = { enabled: true, levelMilestones: true, productIds: [] };
const START = Date.UTC(2026, 10, 7, 12), DAY = 86400000;
const order = (level) => ({ productId: "promotion:century:" + level, requestId: randomUUID(), confirmed: true });
function fixture(t) {
  let at = START;
  const filePath = path.join(temporary(t, "century"), "profiles.json");
  const store = new ProfileStore({ filePath, now: () => at, promotionConfig: config });
  const auth = store.open();
  const p = () => store.find(auth.token);
  function reach(level) {
    p().level = level - 1;
    p().progress.xp = xpForLevel(level) - 1;
    const lifeId = randomUUID();
    store.applyArenaProgress(randomUUID(), [
      { type: "lifeStarted", lifeId, profileId: p().id },
      { type: "survivalMinute", mass: 500, minutes: 1, profileId: p().id },
      { type: "lifeEnded", lifeId, durationSeconds: 60, reason: "left", profileId: p().id },
    ], at);
    assert.equal(p().level, level);
  }
  return { store, auth, p, filePath, reach, now: () => at, setTime: value => { at = value; } };
}
test("Новая сотня: реальное повышение запускает 3 дня; старые уровни, повтор и перезагрузка не запускают таймер", t => {
  const f = fixture(t);
  f.p().level = 599;
  f.p().progress.xp = xpForLevel(599);
  assert.deepEqual(f.store.view(f.p()).promotions, []);
  assert.throws(() => f.store.confirmMockPurchase(f.auth.token, order(500)), /недоступна/);
  f.reach(600);
  assert.deepEqual(f.store.view(f.p()).promotions, ["promotion:century:600"]);
  assert.equal(f.store.view(f.p()).promotionEndsAt["promotion:century:600"], START + 3 * DAY);
  const loaded = new ProfileStore({ filePath: f.filePath, now: f.now, promotionConfig: config });
  assert.deepEqual(loaded.find(f.auth.token).progress.levelOffers, { 600: START });
  f.setTime(START + 3 * DAY - 1);
  assert.equal(loaded.view(loaded.find(f.auth.token)).promotions.length, 1);
  f.setTime(START + 3 * DAY);
  assert.deepEqual(loaded.view(loaded.find(f.auth.token)).promotions, []);
  assert.throws(() => loaded.confirmMockPurchase(f.auth.token, order(600)), /3 дня/);
  f.reach(601);
  assert.deepEqual(f.p().progress.levelOffers, { 600: START });
  f.reach(700);
  assert.deepEqual(f.p().progress.levelOffers, { 700: START + 3 * DAY });
});
test("Новая сотня: состав, цена 40/80, VIP продлевается, одна покупка на каждую сотню, без множителей", t => {
  const f = fixture(t);
  f.store.activateAccount(f.auth.token, { kind: "vip", requestId: randomUUID() });
  f.store.activateAccount(f.auth.token, { kind: "premium", requestId: randomUUID() });
  for (const level of [100, 200]) {
    f.reach(level);
    const input = { ...order(level), votes: 0, wallet: { coins: 999999 } };
    const before = structuredClone(f.p());
    const result = f.store.confirmMockPurchase(f.auth.token, input);
    assert.equal(result.payment.votes, 40);
    assert.equal(products.get(input.productId).originalVotes, 80);
    assert.equal(f.p().wallet.coins - before.wallet.coins, 10000);
    assert.equal(f.p().wallet.crystals - before.wallet.crystals, 1000);
    assert.equal(f.p().account.vipUntil - before.account.vipUntil, 3 * DAY);
    assert.equal(f.p().account.premiumUntil, before.account.premiumUntil);
    for (const [rarity, pool] of Object.entries(POOLS))
      assert.equal(pool.reduce((sum, id) => sum + (f.p().inventory[id] || 0) - (before.inventory[id] || 0), 0),
        ["common", "advanced", "rare"].includes(rarity) ? 100 : 0);
    assert.equal(f.store.confirmMockPurchase(f.auth.token, input).replay, true);
    assert.throws(() => f.store.confirmMockPurchase(f.auth.token, order(level)), /уже куплен/);
    const loaded = new ProfileStore({ filePath: f.filePath, now: f.now, promotionConfig: config });
    assert.deepEqual(loaded.find(f.auth.token), f.p());
    assert.equal(loaded.confirmMockPurchase(f.auth.token, input).replay, true);
  }
  for (const bad of ["0", "99", "101", "0100", "100.0", "90071992547410000"])
    assert.equal(products.get("promotion:century:" + bad), undefined);
});
test("Новая сотня: отказ сохранения не выдаёт ни валюту, ни VIP, ни бустеры; повтор возможен", t => {
  const f = fixture(t);
  f.reach(100);
  const input = order(100), before = structuredClone(f.p()), save = f.store.save;
  f.store.save = () => { throw Error("disk failed"); };
  assert.throws(() => f.store.confirmMockPurchase(f.auth.token, input), /disk failed/);
  assert.deepEqual(f.p(), before);
  f.store.save = save;
  f.store.confirmMockPurchase(f.auth.token, input);
  assert.equal(f.p().account.vipUntil, START + 3 * DAY);
  f.reach(200);
  f.store.promotionConfig = { ...config, levelMilestones: false };
  assert.throws(() => f.store.confirmMockPurchase(f.auth.token, order(200)), /недоступна/);
});
