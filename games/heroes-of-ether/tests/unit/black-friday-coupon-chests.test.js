"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture");
const B = require("../../src/server/events/black-friday");
const treasury = require("../../src/server/progression/treasury-capacity");
const book = require("../../src/server/events/black-friday-orders");
const HOUR = 3600000;
const couponInput = f => ({ productId: "event:manya-coupon", confirmed: true, eventId: f.run.id, requestId: randomUUID() });
const coupon = f => f.store.confirmMockPurchase(f.user.token, couponInput(f));
const state = f => f.p().blackFriday.runs[f.run.id];
function seed(f, tokens = 100000) {
  f.p().blackFriday = { runs: { [f.run.id]: { tokens, completedOrders: 0, days: {}, purchases: {}, finalAt: null } } };
}
test("coupon: exactly 500 once; only later receipts double; purchase receipt, failed save and event binding", () => {
  const f = fixture(), input = couponInput(f), before = structuredClone(f.p()), save = f.store.save;
  f.store.save = () => { throw Error("disk failure"); };
  assert.throws(() => f.store.confirmMockPurchase(f.user.token, input), /disk failure/);
  assert.deepEqual(f.p(), before);
  f.store.save = save;
  f.store.confirmMockPurchase(f.user.token, input);
  assert.equal(f.view().tokens, 500);
  assert.equal(f.p().blackFriday.chests.length, 1);
  assert.equal(f.p().blackFriday.chests[0].stored, true);
  assert.equal(f.view().coupon.active, true);
  const after = structuredClone(f.p());
  f.store.confirmMockPurchase(f.user.token, input);
  assert.deepEqual(f.p(), after);
  assert.throws(() => coupon(f), /уже куплен/);
  f.p().wallet.bucks = 30;
  f.act("exchange", "bucks");
  assert.equal(f.view().tokens, 520);
  const d = book.ensure(f.p(), state(f), B.day(f.now()), f.now());
  fixture.forceOrder(d, 0).progress = f.view().orders[0].target;
  f.act("order", f.view().orders[0].id);
  assert.equal(f.view().tokens, 540);
  const other = fixture();
  assert.throws(() => other.store.confirmMockPurchase(other.user.token, { ...couponInput(other), eventId: "old" }), /завершилось/);
  assert.equal(other.p().blackFriday, undefined);
});
test("each booster prize allows 25 exchanges; currency unlimited; VIP unlock and achievements count quantities", () => {
  const f = fixture(); seed(f); coupon(f);
  for (const [tier, count] of [["common", 30], ["advanced", 25], ["rare", 20], ["clan", 15]]) {
    const inv = Object.values(f.p().inventory).reduce((a,b) => a+b, 0);
    for (let i = 0; i < 25; i++) f.act("buy", tier);
    assert.equal(Object.values(f.p().inventory).reduce((a,b) => a+b, 0) - inv, 25 * count);
    assert.throws(() => f.act("buy", tier), /лимит/);
    assert.equal(state(f).achievementClaims["friday_" + tier], 1);
  }
  for (let i = 0; i < 76; i++) f.act("buy", "coins");
  assert.equal(state(f).achievementClaims.friday_currency, 5);
  for (let i = 0; i < 25; i++) f.act("buy", "vip");
  assert.equal(state(f).achievementClaims.friday_status, 1);
  assert.equal(f.p().account.vipUntil, f.now() + 25 * HOUR);
  assert.equal(f.view().shop.find(o => o.id === "vip").limit, null);
  B.validate(f.p());
});
test("50 token chests plus unlimited ether chests, shared capacity, eviction and expiring queue", () => {
  const f = fixture(); seed(f); f.p().wallet.bucks = 1000;
  for (let i = 0; i < 50; i++) f.act("buy", "chest");
  assert.throws(() => f.act("buy", "chest"), /лимит/);
  for (let i = 0; i < 10; i++) f.act("chest-ether");
  assert.equal(f.p().blackFriday.chests.length, 60);
  assert.equal(f.p().wallet.bucks, 0);
  assert.equal(treasury.stored(f.p()), 7);
  assert.ok(f.p().blackFriday.chests.filter(c => !c.stored).every(c => c.expiresAt === f.now() + 3 * HOUR));
  f.p().account = { ...require("../../src/server/accounts/account-benefits").fresh(), premiumUntil: f.now() + HOUR };
  treasury.fill(f.p(), f.now());
  assert.equal(treasury.stored(f.p()), 12);
  const evicted = f.p().blackFriday.chests.filter(c => c.stored).slice(-5).map(c => c.id);
  f.time(f.now() + HOUR);
  treasury.fill(f.p(), f.now());
  assert.equal(treasury.stored(f.p()), 7);
  assert.ok(f.p().blackFriday.chests.filter(c => evicted.includes(c.id)).every(c => !c.stored && c.waitingSince === f.now()));
  f.time(f.now() + 2 * HOUR);
  treasury.fill(f.p(), f.now());
  assert.equal(f.p().blackFriday.chests.length, 12);
  f.time(f.now() + HOUR);
  treasury.fill(f.p(), f.now());
  assert.equal(f.p().blackFriday.chests.length, 7);
  B.validate(f.p());
});
test("chest draw uses exact 2%/4% boundary, seals once, currency multiplier and one static hour", () => {
  for (const hasCoupon of [false, true]) for (const premium of [false, true]) {
    const f = fixture(); seed(f);
    if (hasCoupon) coupon(f);
    if (premium) f.p().account = { ...require("../../src/server/accounts/account-benefits").fresh(), premiumUntil: f.now() + 5 * HOUR };
    const chance = hasCoupon ? 4 : 2;
    for (const [roll, wins] of [[chance - 1, true], [chance, false]]) {
      f.act("buy", "chest");
      const id = f.p().blackFriday.chests.at(-1).id, request = f.input("prepare", id);
      const before = { ...f.p().wallet };
      B.mutate(f.store, f.user.token, request, () => roll);
      const reward = structuredClone(f.p().blackFriday.chests.find(c => c.id === id).reward);
      assert.equal(reward.chance, chance);
      assert.equal(reward.vipMs, wins ? HOUR : 0);
      assert.equal(reward.coins, 250 * reward.multiplier);
      assert.equal(reward.crystals, 50 * reward.multiplier);
      assert.deepEqual(f.p().wallet, before);
      B.mutate(f.store, f.user.token, f.input("prepare", id), () => { throw Error("reroll"); });
      assert.deepEqual(f.p().blackFriday.chests.find(c => c.id === id).reward, reward);
      const vipBefore = Math.max(f.now(), f.p().account?.vipUntil || 0), open = f.input("open", id);
      B.mutate(f.store, f.user.token, open);
      assert.equal(f.p().wallet.coins - before.coins, reward.coins);
      assert.equal(f.p().wallet.crystals - before.crystals, reward.crystals);
      if (wins) assert.equal(f.p().account.vipUntil - vipBefore, HOUR);
      const saved = structuredClone(f.p());
      assert.equal(B.mutate(f.store, f.user.token, open).replay, true);
      assert.deepEqual(f.p(), saved);
      assert.throws(() => f.act("open", id), /не найден/);
    }
  }
});
test("prepared chest survives event end; failed opening save retains sealed loot and balances", () => {
  const f = fixture(); seed(f); coupon(f);
  const id = f.p().blackFriday.chests[0].id;
  f.act("prepare", id);
  const before = structuredClone(f.p()), save = f.store.save, open = f.input("open", id);
  f.store.save = () => { throw Error("disk failure"); };
  assert.throws(() => B.mutate(f.store, f.user.token, open), /disk failure/);
  assert.deepEqual(f.p(), before);
  f.store.save = save;
  f.time(f.run.endsAt + 1000);
  B.mutate(f.store, f.user.token, open);
  assert.equal(f.p().blackFriday.chests.length, 0);
  assert.equal(f.p().account.vipUntil, f.now() + HOUR);
});
test("old achievement degrees survive new thresholds with no repayment or retroactive increase", () => {
  const f = fixture(); seed(f);
  const s = state(f), d = book.ensure(f.p(), s, B.day(f.now()), f.now());
  d.exchanges.coins = 1;
  s.purchases.common = 1;
  s.achievementClaims = { friday_exchange: 1, friday_shopper: 1 };
  const before = f.p().greatness;
  B.validate(f.p());
  f.act("buy", "common");
  assert.equal(f.p().greatness, before);
  assert.equal(state(f).achievementClaims.friday_exchange, 1);
  assert.equal(state(f).achievementClaims.friday_shopper, 1);
  B.validate(f.p());
});
test("arena levels give 5 tokens or 10 with coupon, keep roulette tickets and deduplicate life completion", () => {
  for (const bought of [false, true]) {
    const f = fixture(); if (bought) coupon(f);
    const before = f.view().tokens, tickets = f.p().roulette.tickets, lifeId = randomUUID();
    f.progress({ type: "lifeStarted", lifeId });
    f.progress({ type: "survivalMinute", minutes: 1000, mass: 10000 });
    assert.ok(f.p().progress.session.fridayLevel);
    const event = { type: "lifeEnded", lifeId, durationSeconds: 60, reason: "exit" };
    f.progress(event);
    assert.equal(f.view().tokens - before, bought ? 10 : 5);
    assert.equal(f.p().progress.lastLife.levelReward.fridayTokens, bought ? 10 : 5);
    assert.equal(state(f).arenaLevels, 1);
    assert.equal(f.p().roulette.tickets - tickets, 1);
    f.progress(event);
    assert.equal(state(f).arenaLevels, 1);
    B.validate(f.p());
  }
});
