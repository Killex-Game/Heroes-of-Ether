"use strict";
const test = require("node:test"), assert = require("node:assert/strict"),
  path = require("node:path"), { randomUUID } = require("node:crypto"),
  fixture = require("../helpers/black-friday-fixture"), { temporary } = require("../temp"),
  R = require("../../src/server/roulette/roulette-service"),
  rules = require("../../public/shared/roulette-rules"),
  B = require("../../src/server/events/black-friday"),
  { ProfileStore } = require("../../src/server/profiles/profile-store");
const roll = max => n => n === 6000 ? 1835 : max ? n - 1 : 0;
const act = (f, action, extra = {}, rng = roll(false)) => R.mutate(f.store, f.user.token,
  {action, requestId:randomUUID(), rulesVersion:rules.version, ...extra}, rng);
const tickets = f => { f.p().roulette.tickets = f.p().roulette.earned = 10; };

test("Black Friday replaces exactly three advanced slots; the 1715/6000 category chance is unchanged", () => {
  const f = fixture();
  for (const max of [false, true]) {
    const offer = R.makeOffer(f.now(), roll(max), f.run);
    assert.equal(offer.slots.filter(s => s.category === "fridayTokens").length, 3);
    assert.ok(!offer.slots.some(s => s.category === "advanced"));
    assert.ok(offer.slots.filter(s => s.category === "fridayTokens").every(s => s.amount === (max ? 10 : 5)));
    const counts = {};
    for (let i = 0; i < 6000; i++) {
      const reward = offer.slots[R.pick(offer, n => n === 6000 ? i : 0)];
      counts[reward.category] = (counts[reward.category] || 0) + 1;
    }
    for (const c of rules.forEvent("black-friday").categories) assert.equal(counts[c.id], c.weight);
  }
});

test("Tokens stay 5-10 with every VIP/Premium/coupon combination; balance, day score and achievements update atomically", () => {
  for (const vip of [false, true]) for (const premium of [false, true])
    for (const coupon of [false, true]) for (const max of [false, true]) {
      const f = fixture(); tickets(f);
      if (coupon) B.activateCoupon(f.p(), f.manager, f.run.id, f.now());
      f.p().account ||= require("../../src/server/accounts/account-benefits").fresh();
      Object.assign(f.p().account, {vipUntil:vip ? f.now()+999999 : 0, premiumUntil:premium ? f.now()+999999 : 0});
      const before = f.view().tokens;
      const prepared = act(f, "prepare", {}, roll(max));
      assert.equal(prepared.profile.roulette.variant, "black-friday");
      const request = {offerId:prepared.profile.roulette.offer.id, requestId:randomUUID()};
      const result = act(f, "spin", request, roll(max));
      const amount = max ? 10 : 5;
      assert.equal(result.result.reward.amount, amount);
      assert.match(result.result.reward.icon, /token-v2/);
      assert.equal(f.view().tokens, before + amount);
      assert.equal(f.p().blackFriday.runs[f.run.id].days[B.day(f.now())].earned, before + amount);
      assert.deepEqual(f.p().inventory, {});
      const after = structuredClone(f.p());
      assert.equal(act(f, "spin", request).replay, true);
      assert.deepEqual(f.p(), after);
      R.validate(f.p()); B.validate(f.p());
    }
});

test("Five spins credit five token rewards and cross achievement threshold; replay and disk errors are safe", t => {
  const filePath=path.join(temporary(t,"friday-roulette"),"profiles.json"), f=fixture({filePath}); tickets(f);
  f.p().wallet.coins = 10000;
  for (let i=0;i<9;i++) f.act("exchange","coins"); // 90 tokens, next five spins cross 100.
  const offer=act(f,"prepare").profile.roulette.offer;
  const request={offerId:offer.id,requestId:randomUUID()}, before=structuredClone(f.p());
  const save=f.store.save; f.store.save=()=>{throw Error("disk failed")};
  assert.throws(()=>act(f,"spin-five",request),/disk failed/); assert.deepEqual(f.p(),before);
  f.store.save=save;
  const result=act(f,"spin-five",request);
  assert.equal(result.result.spins.length,5);
  assert.equal(f.view().tokens,115);
  assert.equal(f.p().blackFriday.runs[f.run.id].achievementClaims.friday_tokens,1);
  const restored=new ProfileStore({filePath,now:f.now}); restored.events=f.manager;
  const after=structuredClone(restored.find(f.user.token)); f.store=restored;
  const replay=R.mutate(restored,f.user.token,{action:"spin-five",rulesVersion:rules.version,...request},roll(false));
  assert.equal(replay.replay,true); assert.deepEqual(restored.find(f.user.token),after);
});

test("Event boundaries reject a stale wheel without spending; completed rewards replay after the event", () => {
  const f=fixture(); tickets(f);
  const offer=act(f,"prepare").profile.roulette.offer;
  const request={offerId:offer.id,requestId:randomUUID()}; act(f,"spin",request);
  const stale=act(f,"prepare").profile.roulette.offer;
  f.time(f.run.endsAt);
  f.store.refreshCompetition();
  assert.equal(f.store.view(f.p()).roulette.variant,"default");
  assert.equal(f.store.view(f.p()).roulette.offer,null);
  // Settlement is independent of rejecting/replaying a roulette request.
  const before=structuredClone(f.p());
  assert.throws(()=>act(f,"spin",{offerId:stale.id}),/откроется/);
  assert.deepEqual(f.p(),before);
  assert.equal(act(f,"spin",request).replay,true);
  assert.deepEqual(f.p(),before);
  f.store.events=null; f.store.baseRouletteConfig={testEnabled:true,events:[]};
  assert.throws(()=>act(f,"spin",{offerId:stale.id}),/обновилось/);
  const normal=act(f,"prepare").profile.roulette.offer;
  assert.equal(normal.slots.filter(s=>s.category==="advanced").length,3);
  assert.ok(!normal.slots.some(s=>s.category==="fridayTokens"));
});

test("Version 3 archives load unchanged; old offers cannot be used as event wheels", () => {
  const f=fixture(); tickets(f);
  const offer=R.makeOffer(f.now(),()=>0); offer.rulesVersion=3;
  const requestId=randomUUID(); f.p().roulette.results[requestId]={requestId,at:f.now(),offer,index:3};
  f.p().roulette.lastRequestId=requestId; f.p().roulette.spent=1; f.p().roulette.tickets=9;
  f.p().roulette.offer=offer; R.validate(f.p());
  const view=f.store.view(f.p()).roulette;
  assert.equal(view.offer,null); assert.equal(view.lastSpin.reward.category,"advanced");
  const next=act(f,"prepare").profile.roulette.offer;
  assert.equal(next.variant,"black-friday");
  assert.deepEqual(f.p().roulette.results[requestId].offer,offer);
});
