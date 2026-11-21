"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const book = require("../../src/server/events/black-friday-orders");
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
test("order progress preserves the published book, including opponent receipts, for every template/tier", () => {
  for (const tier of book.tiers) for (const [template, def] of book.templates.entries()) {
    if (!(tier.targets[template] > 0)) continue;
    let saved = { version: 3, catalogVersion: 2, exchanges: { coins: 2 }, lanes: {},
      slots: [{ tier: tier.id, complete: false, current: {
        id: `${tier.id}:0:0`, template, progress: 0, assignedAt: 1000, revision: 0, catalogVersion: 2,
        extension: { retained: [1, 2, 3] },
      } }] };
    for (let n = 0; n < 24; n++) {
      freeze(saved);
      const snapshot = JSON.stringify(saved), reference = structuredClone(saved);
      const next = book.copyForProgress(saved);
      const event = { type: ["arenaAction", "absorbed", "questSample", "lifeEnded"][n % 4],
        lifeId: n % 7 === 0 ? "stale" : "life", targetProfileId: `target-${n % 5}`,
        victimProfileId: `target-${n % 5}`, food: n * 10, durationSeconds: 120,
        reason: n % 9 === 0 ? "recovered" : "exit" };
      const session = { id: "life", startedAt: 1000, sampledAt: 2000, food: 10 };
      const changes = { [def.metric]: n % 3 ? 1 : 0 };
      const changed = book.progress({ id: "self" }, next, event, 121000 + n, 1000, session, changes);
      const captured = book.progress({ id: "self" }, saved, event, 121000 + n, 1000, session, changes, true);
      book.progress({ id: "self" }, reference, event, 121000 + n, 1000, session, changes);
      assert.deepEqual(next, reference, `${tier.id}/${def.metric}/${n}`);
      assert.deepEqual(captured, reference, `immutable ${tier.id}/${def.metric}/${n}`);
      if (!changed) assert.strictEqual(captured, saved);
      assert.equal(changed, JSON.stringify(next.slots) !== JSON.stringify(saved.slots));
      assert.equal(JSON.stringify(saved), snapshot);
      assert.strictEqual(next.exchanges, saved.exchanges);
      assert.strictEqual(next.slots[0].current.extension, saved.slots[0].current.extension);
      saved = next;
    }
  }
});

test("selective order capture preserves unrelated rows and duplicate-opponent history", () => {
  const row = (metric) => ({tier:'common',complete:false,current:{
    template:book.templates.findIndex(t=>t.metric===metric),progress:0,assignedAt:1000,catalogVersion:2}});
  const saved = freeze({slots:[row('rocketHits'),row('food'),row('purchasedBoosters'),row('life')]});
  const session={id:'life',startedAt:1000,sampledAt:1000,food:0};
  const event={type:'arenaAction',lifeId:'life',targetProfileId:'opponent'};
  const next=book.progress({id:'self'},saved,event,2000,1000,session,{rocketHits:1},true);
  assert.equal(next.slots[0].current.progress,1);
  assert.deepEqual(next.slots[0].current.opponents,['opponent']);
  for(let i=1;i<4;i++) assert.strictEqual(next.slots[i],saved.slots[i]);
  freeze(next);
  assert.strictEqual(book.progress({id:'self'},next,event,3000,1000,session,{rocketHits:1},true),next);
  assert.strictEqual(book.activity(next,{coinsEarned:50},3000,true),next);
  assert.strictEqual(book.activity(next,{purchasedBoosters:5},999,true),next);
  const bought=book.activity(next,{purchasedBoosters:5},3000,true);
  assert.equal(bought.slots[2].current.progress,5);
  assert.equal(next.slots[2].current.progress,0);
  for(const i of [0,1,3]) assert.strictEqual(bought.slots[i],next.slots[i]);
});
test("economy progress uses an isolated counter without copying unrelated order history", () => {
  const template = book.templates.findIndex(t => t.metric === "purchasedBoosters");
  const saved = freeze({ slots: [{ tier: "common", complete: false,
    current: { template, progress: 0, assignedAt: 1000, catalogVersion: 2 } }], history: { receipt: [1, 2] } });
  const next = book.copyForProgress(saved);
  assert.equal(book.activity(next, { purchasedBoosters: 10 }, 2000), true);
  assert.equal(next.slots[0].current.progress, 10);
  assert.equal(saved.slots[0].current.progress, 0);
  assert.strictEqual(next.history, saved.history);
  assert.equal(book.activity(next, { purchasedBoosters: 10 }, 999), false);
});

test("arena progress shares archived event data and preserves the previous published book", () => {
  const fixture = require("../helpers/black-friday-fixture");
  const B = require("../../src/server/events/black-friday");
  const f = fixture();
  f.p().wallet.bucks = 100;
  f.act("exchange", "bucks");
  const state = f.p().blackFriday.runs[f.run.id];
  fixture.forceOrder(state.days[B.day(f.now())], 0);
  f.progress({ type: "lifeStarted", lifeId: "frozen-book-life" });
  const before = f.p().blackFriday, saved = structuredClone(before);
  freeze(before);
  f.time(f.now() + 1000);
  f.progress({ type: "questSample", lifeId: "frozen-book-life", food: 30, rank: 10 });
  const after = f.p().blackFriday;
  assert.deepEqual(before, saved);
  assert.notStrictEqual(after, before);
  assert.equal(f.view().orders[0].progress, 30);
  assert.strictEqual(after.runs[f.run.id].purchases, before.runs[f.run.id].purchases);
  assert.strictEqual(after.runs[f.run.id].achievementClaims, before.runs[f.run.id].achievementClaims);
  const unchanged = after;
  freeze(unchanged);
  f.progress({ type: "massPeak", mass: 2500 });
  assert.strictEqual(f.p().blackFriday, unchanged);
});

test("arena level reward isolates frozen books and claims, with and without Manya coupon", () => {
  const fixture = require("../helpers/black-friday-fixture");
  const { randomUUID } = require("node:crypto");
  for (const coupon of [false, true]) {
    const f = fixture();
    if (coupon) f.store.confirmMockPurchase(f.user.token, { productId: "event:manya-coupon",
      confirmed: true, eventId: f.run.id, requestId: randomUUID() });
    else { f.p().wallet.bucks = 100; f.act("exchange", "bucks"); }
    f.progress({ type: "lifeStarted", lifeId: "level-book-life" });
    const before = f.p().blackFriday, saved = structuredClone(before), tokens = f.view().tokens;
    freeze(before);
    f.progress({ type: "survivalMinute", minutes: 1000, mass: 10000 });
    f.progress({ type: "lifeEnded", lifeId: "level-book-life", durationSeconds: 60, reason: "exit" });
    assert.deepEqual(before, saved);
    assert.equal(f.view().tokens - tokens, coupon ? 10 : 5);
    const earned = f.view().tokens;
    f.progress({ type: "lifeEnded", lifeId: "level-book-life", durationSeconds: 60, reason: "exit" });
    assert.equal(f.view().tokens, earned);
    require("../../src/server/events/black-friday").validate(f.p());
  }
});
