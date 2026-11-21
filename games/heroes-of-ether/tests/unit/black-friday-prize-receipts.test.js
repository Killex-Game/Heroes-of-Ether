"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fixture = require("../helpers/black-friday-fixture");
const B = require("../../src/server/events/black-friday");

test("token purchases debit new prices, return exact booster draws, retry old receipts without granting again", () => {
  const f = fixture();
  f.store.confirmMockPurchase(f.user.token, { productId: "event:manya-coupon", confirmed: true,
    eventId: f.run.id, requestId: require("node:crypto").randomUUID() });
  let first;
  // Advancing a purchase order must retain the newly drawn reward receipt.
  fixture.forceOrder(f.p().blackFriday.runs[f.run.id].days[B.day(f.now())],
    require("../../src/server/events/black-friday-orders").templates.findIndex(t => t.metric === "purchasedBoosters"));
  for (const [id, count, price] of [["common",30,10],["advanced",25,15],["rare",20,20],["clan",15,25]]) {
    const input=f.input("buy",id), before=structuredClone(f.p()), random=n=> (count % n);
    const result=B.mutate(f.store,f.user.token,input,random);
    assert.equal(before.blackFriday.runs[f.run.id].tokens-f.view().tokens,price);
    assert.equal(Object.values(result.reward.items).reduce((a,b)=>a+b,0),count);
    for (const [key,n] of Object.entries(result.reward.items)) assert.equal(f.p().inventory[key]-(before.inventory[key]||0),n);
    assert.equal(result.reward.count,count);
    first ||= {input,reward:result.reward};
  }
  const after=structuredClone(f.p());
  const replay=B.mutate(f.store,f.user.token,first.input,()=>{throw Error("must not redraw");});
  assert.equal(replay.replay,true);assert.deepEqual(replay.reward,first.reward);assert.deepEqual(f.p(),after);
  for(const [id,amount,price] of [["coins",250,10],["crystals",25,15],["bucks",5,20]]) {
    const before=f.p().wallet[id],tokens=f.view().tokens,result=f.act("buy",id);
    assert.equal(result.reward,undefined);assert.equal(f.p().wallet[id]-before,amount);assert.equal(tokens-f.view().tokens,price);
  }
  assert.equal(f.act("buy","vip").reward,undefined);
  B.validate(f.p());
});

test("failed save rolls back debit and drawn boosters; retry succeeds with one durable receipt", () => {
  const f=fixture();f.complete();const input=f.input("buy","rare"),before=structuredClone(f.p()),save=f.store.save;
  f.store.save=()=>{throw Error("disk failed");};
  assert.throws(()=>B.mutate(f.store,f.user.token,input,()=>0),/disk failed/);assert.deepEqual(f.p(),before);
  f.store.save=save;
  const result=B.mutate(f.store,f.user.token,input,()=>0),after=structuredClone(f.p());
  assert.equal(result.reward.count,20);
  assert.deepEqual(B.mutate(f.store,f.user.token,input).reward,result.reward);
  assert.deepEqual(f.p(),after);
});

test("ten exchanges per currency each day, next day resets independently; ether has no quota",()=>{
  const f=fixture();Object.assign(f.p().wallet,{coins:20000,crystals:2000,bucks:1000});
  for(const id of ["coins","crystals"]){for(let i=0;i<10;i++)f.act("exchange",id);assert.throws(()=>f.act("exchange",id),/исчерпан/);}
  for(let i=0;i<11;i++)f.act("exchange","bucks");
  f.time(f.now()+86400000);assert.equal(f.view().exchanges[0].used,0);f.act("exchange","coins");f.act("exchange","crystals");B.validate(f.p());
});
