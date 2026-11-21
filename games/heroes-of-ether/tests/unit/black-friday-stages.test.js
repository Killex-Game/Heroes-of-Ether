"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture");
const B = require("../../src/server/events/black-friday");
const book = require("../../src/server/events/black-friday-orders");
const state = f => f.p().blackFriday.runs[f.run.id];
const achievement = (f, id) => f.view().achievements.find(a => a.id === id);
const credit = (f, votes, requestId = randomUUID()) => f.store.transact(
  f.user.token, requestId, "test-package:" + votes,
  p => B.rewardCurrencyPack(p, f.run, votes, f.now()));

test("earned tokens consume each full target; wallet spending and midnight do not reset stage progress", () => {
  const f = fixture();
  credit(f, 10);
  assert.equal(achievement(f, "friday_tokens").claimed, 1);
  assert.equal(achievement(f, "friday_tokens").value, 0);
  credit(f, 29);
  assert.equal(achievement(f, "friday_tokens").value, 290);
  f.act("buy", "common");
  assert.equal(achievement(f, "friday_tokens").value, 290);
  f.time(f.now() + 86400000);
  credit(f, 1);
  assert.equal(achievement(f, "friday_tokens").claimed, 2);
  assert.equal(achievement(f, "friday_tokens").value, 0);
  for (const [votes, degree] of [[60, 3], [100, 4], [150, 5]]) {
    const key = randomUUID(); credit(f, votes, key);
    const saved = structuredClone(f.p()); credit(f, votes, key);
    assert.deepEqual(f.p(), saved);
    assert.equal(achievement(f, "friday_tokens").claimed, degree);
    if (degree < 5) assert.equal(achievement(f, "friday_tokens").value, 0);
  }
  assert.equal(state(f).tokens, 3490);
  assert.equal(Object.values(state(f).days).reduce((n, d) => n + d.earned, 0), 3500);
  B.validate(f.p());
});

test("bulk token receipt carries remainder and failed save never consumes a stage", () => {
  const f = fixture(), key = randomUUID(), before = structuredClone(f.p()), save = f.store.save;
  f.store.save = () => { throw Error("disk failure"); };
  assert.throws(() => credit(f, 150, key), /disk failure/);
  assert.deepEqual(f.p(), before);
  f.store.save = save; credit(f, 150, key);
  assert.equal(achievement(f, "friday_tokens").claimed, 3);
  assert.equal(achievement(f, "friday_tokens").value, 500);
  assert.equal(state(f).stageSpent.friday_tokens, 1000);
  assert.equal(f.p().greatness - before.greatness, 85);
});

test("legacy degrees and greatness survive migration, with only unconsumed progress on next degree", () => {
  const f = fixture();
  f.p().blackFriday = { runs: { [f.run.id]: {
    tokens: 150, completedOrders: 0, days: {}, purchases: {}, finalAt: null,
    achievementVersion: 2, achievementClaims: { friday_tokens: 1 }
  } } };
  book.ensure(f.p(), state(f), B.day(f.now()), f.now()).earned = 150;
  const before = f.p().greatness;
  B.validate(f.p());
  assert.equal(B.migrate(f.p()), true);
  assert.equal(B.migrate(f.p()), false);
  assert.equal(f.p().greatness, before);
  assert.equal(achievement(f, "friday_tokens").value, 50);
  credit(f, 24);
  assert.equal(achievement(f, "friday_tokens").claimed, 1);
  assert.equal(achievement(f, "friday_tokens").value, 290);
  credit(f, 1);
  assert.equal(achievement(f, "friday_tokens").claimed, 2);
  assert.equal(achievement(f, "friday_tokens").value, 0);
  assert.equal(f.p().greatness - before, 25);
  const invalid = structuredClone(f.p());
  invalid.blackFriday.runs[f.run.id].stageSpent.friday_tokens = 401;
  assert.throws(() => B.validate(invalid), /прогресс степеней/);
});

test("Main performer is the only cumulative Friday exception and finishes at 50 of 84 orders", () => {
  const f = fixture();
  assert.deepEqual(B.achievements.filter(a => a.exception).map(a => a.id), ["friday_orders"]);
  assert.ok(B.achievements.every(a => a.cumulative === a.exception));
  for (let day = 0; day < 5; day++) {
    if (day) f.time(f.now() + 86400000);
    f.complete();
    const a = achievement(f, "friday_orders");
    assert.equal(a.value, 12 * (day + 1));
    assert.equal(a.claimed, [2, 2, 3, 4, 5][day]);
  }
  assert.equal(f.view().completedOrders, 60);
  B.validate(f.p());
});

test("VIP allows 24 hours per run without coupon, replay is free and coupon removes the limit", () => {
  const f = fixture(); credit(f, 1000);
  assert.equal(f.view().shop.find(o => o.id === "vip").limit, 24);
  let last;
  for (let i = 0; i < 24; i++) {
    last = f.input("buy", "vip"); B.mutate(f.store, f.user.token, last);
  }
  assert.equal(f.p().account.vipUntil, f.now() + 24 * 3600000);
  assert.equal(state(f).achievementClaims.friday_status, 1);
  const saved = structuredClone(f.p());
  assert.equal(B.mutate(f.store, f.user.token, last).replay, true);
  assert.throws(() => f.act("buy", "vip"), /лимит/);
  assert.deepEqual(f.p(), saved);
  f.time(f.now() + 86400000);
  assert.throws(() => f.act("buy", "vip"), /лимит/);
  f.store.confirmMockPurchase(f.user.token, { productId: "event:manya-coupon", confirmed: true,
    eventId: f.run.id, requestId: randomUUID() });
  assert.equal(f.view().shop.find(o => o.id === "vip").limit, null);
  const before = f.p().greatness;
  f.act("buy", "vip");
  assert.equal(state(f).purchases.vip, 25);
  assert.equal(f.p().greatness, before);
  B.validate(f.p());
});
