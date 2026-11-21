"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const fixture = require("../helpers/black-friday-fixture");
const B = require("../../src/server/events/black-friday");
const chests = require("../../src/server/events/black-friday-chests");
const accounts = require("../../src/server/accounts/account-benefits");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { temporary } = require("../temp");
function chest(f, coupon = false) {
  f.p().blackFriday = { runs: { [f.run.id]: { tokens: 1000, days: {}, purchases: {}, completedOrders: 0,
    finalAt: null, ...(coupon ? { couponAt: f.now() } : {}) } } };
  f.act("buy", "chest");
  return f.p().blackFriday.chests[0].id;
}
test("BF: 15 per quality, independent 5% ether and 2/4% VIP; account multipliers and exact credited receipt", () => {
  for (const vip of [false, true]) for (const premium of [false, true]) for (const coupon of [false, true]) {
    for (const etherRoll of [4, 5]) {
      const f = fixture(), id = chest(f, coupon);
      f.p().account = { ...accounts.fresh(), vipUntil: vip ? f.now() + 86400000 : 0,
        premiumUntil: premium ? f.now() + 86400000 : 0 };
      const factor = accounts.benefits(f.p(), f.now()).chestMultiplier;
      let calls = 0;
      B.mutate(f.store, f.user.token, f.input("prepare", id), n => {
        calls++;
        return calls === 1 ? 3 : calls === 2 ? etherRoll : calls % n;
      });
      const r = f.p().blackFriday.chests[0].reward;
      assert.equal(calls, 62);
      assert.equal(r.vipMs, coupon ? 3600000 : 0);
      assert.equal(r.bucks, etherRoll === 4 ? 5 * factor : 0);
      const totals = { common: 0, advanced: 0, rare: 0, clan: 0 };
      for (const [key, value] of Object.entries(r.items)) totals[BOOSTERS.get(key).tier] += value;
      assert.deepEqual(Object.values(totals), [15,15,15,15].map(n => n * factor));
      assert.ok(Object.keys(r.items).length > 4, "draw varies inside each quality");
      const before = structuredClone(f.p()), preview = chests.view(f.p(), null, f.now(), f.store.events)[0];
      assert.deepEqual(preview.reward.items, r.items);
      const request = f.input("open", id);
      B.mutate(f.store, f.user.token, request, () => { throw Error("reroll"); });
      for (const key of ["coins", "crystals", "bucks"]) assert.equal(f.p().wallet[key] - before.wallet[key], r[key]);
      for (const [key, value] of Object.entries(r.items)) assert.equal(f.p().inventory[key] - (before.inventory[key] || 0), value);
      const after = structuredClone(f.p());
      assert.equal(B.mutate(f.store, f.user.token, request).replay, true);
      assert.deepEqual(f.p(), after);
    }
  }
});
test("BF: sealed new contents survive restart, expired accounts and failed opening write", t => {
  const filePath = path.join(temporary(t, "bf-expanded-chest"), "profiles.json");
  const f = fixture({ filePath }), id = chest(f);
  f.p().account = { ...accounts.fresh(), premiumUntil: f.now() + 1000 };
  f.act("prepare", id);
  const sealed = structuredClone(f.p().blackFriday.chests[0].reward);
  const restored = new ProfileStore({ filePath, now: () => f.now() + 2000 });
  restored.events = f.store.events;
  const p = () => restored.find(f.user.token);
  assert.deepEqual(p().blackFriday.chests[0].reward, sealed);
  const before = structuredClone(p()), save = restored.save;
  restored.save = () => { throw Error("write failure"); };
  const request = f.input("open", id);
  assert.throws(() => B.mutate(restored, f.user.token, request), /write failure/);
  assert.deepEqual(p(), before);
  restored.save = save;
  B.mutate(restored, f.user.token, request, () => { throw Error("reroll"); });
  assert.equal(p().wallet.bucks - before.wallet.bucks, sealed.bucks);
  for (const [key, value] of Object.entries(sealed.items)) assert.equal(p().inventory[key] - (before.inventory[key] || 0), value);
});
test("BF: legacy sealed reward remains unchanged; malformed new rewards are rejected", () => {
  const f = fixture(), id = chest(f);
  f.p().blackFriday.chests[0].reward = { multiplier: 1, chance: 2, coins: 250, crystals: 50, vipMs: 0 };
  chests.validate(f.p());
  const before = structuredClone(f.p());
  B.mutate(f.store, f.user.token, f.input("open", id), () => { throw Error("legacy reroll"); });
  assert.equal(f.p().wallet.bucks, before.wallet.bucks);
  assert.deepEqual(f.p().inventory, before.inventory);
  const next = chest(f); f.act("prepare", next);
  const r = f.p().blackFriday.chests[0].reward;
  const key = Object.keys(r.items)[0]; r.items[key]++;
  assert.throws(() => chests.validate(f.p()), /количество|бустеры/);
});
