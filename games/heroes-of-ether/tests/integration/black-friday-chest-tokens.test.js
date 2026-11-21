"use strict";
const test = require("node:test"), assert = require("node:assert/strict"),
  path = require("node:path"), { randomUUID } = require("node:crypto"),
  fixture = require("../helpers/token-chest-fixture"), { temporary } = require("../temp");
const B = require("../../src/server/events/black-friday"),
  Q = require("../../src/server/progression/personal-quests"),
  T = require("../../src/server/progression/title-chest-rewards"),
  E = require("../../src/server/events/easter-hunt"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager");
const kinds = [["friday", null], ...["high", "medium", "low"].map(t => ["clan", t]),
  ...Object.keys(Q.CHESTS).map(t => ["quest", t])];
for (const vip of [false, true]) for (const premium of [false, true]) for (const coupon of [false, true])
  test(`Eligible chests: VIP=${vip}, Premium=${premium}, Coupon=${coupon}: preview, grant, replay`, () => {
    for (const [kind, tier] of kinds) {
      const f = fixture();
      f.p().account = require("../../src/server/accounts/account-benefits").fresh();
      Object.assign(f.p().account, { vipUntil: vip ? f.now() + 86400000 : 0,
        premiumUntil: premium ? f.now() + 86400000 : 0 });
      if (coupon) B.activateCoupon(f.p(), f.manager, f.run.id, f.now());
      const c = f.seed(kind, tier), before = f.tokens(), n = coupon ? 6 : 3;
      const receipts = structuredClone(f.p().receipts);
      assert.equal(f.store.view(f.p()).blackFriday.chestTokens, n);
      c.act("prepare");
      assert.equal(f.tokens(), before);
      assert.equal(c.reward().fridayTokens, n);
      c.act("prepare"); assert.equal(f.tokens(), before);
      const reward = c.reward(), wallet = { ...f.p().wallet }, requestId = randomUUID();
      c.act("open", requestId, { fridayTokens: 999, multiplier: 999 });
      assert.equal(f.tokens(), before + n);
      for (const key of ["coins", "crystals"])
        assert.equal(f.p().wallet[key] - wallet[key], reward[key] || 0);
      assert.equal(f.p().blackFriday.runs[f.run.id].days[B.day(f.now())].earned, (coupon ? 500 : 0) + n);
      const after = structuredClone(f.p());
      assert.equal(c.act("open", requestId).replay, true);
      assert.deepEqual(f.p(), after);
      assert.throws(() => c.act("open"));
      assert.deepEqual(f.p(), after);
      assert.notDeepEqual(f.p().receipts, receipts);
      B.validate(f.p());
    }
  });
test("Tokens use the active event and coupon at claim, never grant outside Black Friday", () => {
  for (const [kind, tier] of kinds) {
    const f = fixture(), c = f.seed(kind, tier);
    c.act("prepare");
    assert.equal(c.reward().fridayTokens, 3);
    B.activateCoupon(f.p(), f.manager, f.run.id, f.now());
    assert.equal(c.reward().fridayTokens, 6);
    f.time(f.run.endsAt);
    assert.equal(c.reward().fridayTokens, undefined);
    const before = f.tokens();
    c.act("open");
    assert.equal(f.tokens(), before);
  }
  const f = fixture(), c = f.seed("quest", Object.keys(Q.CHESTS)[0]);
  const manager = f.store.events;
  f.store.events = null;
  c.act("prepare"); assert.equal(c.reward().fridayTokens, undefined);
  c.act("open"); assert.equal(f.tokens(), 0);
  f.store.events = manager;
});
test("Title chests and Easter chests never award Black Friday tokens, including with coupon", () => {
  const f = fixture();
  B.activateCoupon(f.p(), f.manager, f.run.id, f.now());
  f.p().greatness = 2000000; T.awardTitles(f.p(), f.now());
  for (const title of T.TITLES) {
    const before = f.tokens();
    f.store.prepareChest(f.user.token, title.id, randomUUID());
    assert.equal(f.store.view(f.p()).honors.pending.fridayTokens, undefined);
    f.store.openChest(f.user.token, title.id, randomUUID());
    assert.equal(f.tokens(), before);
  }
  // Earn an Easter chest first; open it during Black Friday.
  const events = new EventManager({ now: f.now });
  events.apply("test", "start", {eventId:E.manifest.id, revision:0, requestId:randomUUID()});
  const runId = events.active().id;
  E.progress(f.p(), events, { type:"easterPickup", eggType:0, runId }, f.now());
  const s = f.p().easter.runs[runId]; s.eggs = [10,10,10,10]; s.found = [10,10,10,10];
  E.act(f.p(), events, { action:"exchange", runId }, f.now(), () => 0);
  const chestId = f.p().easter.chests.at(-1).id, before = f.tokens();
  E.mutate(f.store, f.user.token, { action:"prepare", chestId, requestId:randomUUID() });
  assert.equal(f.store.view(f.p()).easter.chests.find(c=>c.id===chestId).reward.fridayTokens, undefined);
  E.mutate(f.store, f.user.token, { action:"open", chestId, requestId:randomUUID() });
  assert.equal(f.tokens(), before);
});
test("Chest removal and tokens are one durable transaction; failed save and restart cannot duplicate the award", t => {
  for (const [kind, tier] of [["friday",null], ["clan","high"], ["quest",Object.keys(Q.CHESTS)[0]]]) {
    const filePath = path.join(temporary(t, "chest-tokens-" + kind), "profiles.json"),
      f = fixture({filePath}), c = f.seed(kind, tier);
    c.act("prepare");
    const inputId = randomUUID(), before = structuredClone(f.p()), save = f.store.save;
    f.store.save = () => { throw Error("write failed"); };
    assert.throws(() => c.act("open", inputId), /write failed/);
    assert.deepEqual(f.p(), before);
    f.store.save = save;
    c.act("open", inputId);
    const restored = new ProfileStore({filePath,now:f.now}); restored.events = f.manager;
    assert.equal(restored.find(f.user.token).blackFriday.runs[f.run.id].tokens, 3);
    f.store.data = restored.data;
    const after = structuredClone(f.p());
    assert.equal(c.act("open", inputId).replay, true);
    assert.deepEqual(f.p(), after);
  }
});
