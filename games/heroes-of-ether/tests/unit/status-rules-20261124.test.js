"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const accounts=require('../../src/server/accounts/account-benefits'),products=require('../../public/shared/virtual-product-catalog');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),slots=require('../../public/shared/quick-slot-rules');
const bonuses=require('../../src/server/progression/chest-bonuses'),pets=require('../../src/server/pets/arena-pets');
const now=Date.UTC(2026,10,24),day=86400000;
test('Approved four-status matrix, separate greatness/currency factors and exact expiry',()=>{
 for(const [vip,premium,start,xp,absorption,greatness,chest,turbo,count] of [
  [false,false,20,0,1,1,1,0,5],[true,false,50,100,2,1,2,120000,6],
  [false,true,100,0,1,2,1,0,5],[true,true,150,100,2,2,2,120000,6]]){
  const p={account:{vipUntil:vip?now+day:0,premiumUntil:premium?now+day:0}},b=accounts.benefits(p,now);
  assert.deepEqual([b.startMass,b.xpPercent,b.absorptionXpMultiplier,b.greatnessMultiplier,b.chestMultiplier,b.turboMs,slots.count(b)], [start,xp,absorption,greatness,chest,turbo,count]);
  assert.deepEqual(bonuses.scale({coins:10,greatness:5,items:{candy:2}},chest,greatness),{coins:10*chest,greatness:5*greatness,items:{candy:2*chest}});
  assert.equal(accounts.benefits(p,now+day).vip,false);assert.equal(accounts.benefits(p,now+day).premium,false);
 }
 assert.deepEqual(products.accountLoginRewards,{vip:{coins:50,crystals:10,bucks:5},premium:{coins:100,crystals:25,bucks:10}});
 assert.equal(slots.unlocked(3,{},11),false);assert.equal(slots.unlocked(4,{},1),true);assert.equal(slots.unlocked(5,{premium:true},50),false);assert.equal(slots.unlocked(5,{vip:true},50),true);
});
test('Server purchase duration follows catalog; retries do not extend twice',()=>{
 for(const [kind,days,votes] of [['vip',7,14],['premium',14,30]]){
  const store=new ProfileStore({now:()=>now}),{token}=store.open(),order={productId:'account:'+kind,confirmed:true,requestId:randomUUID()};
  assert.equal(products.get(order.productId).votes,votes);store.confirmMockPurchase(token,order);
  assert.equal(store.find(token).account[kind+'Until'],now+days*day);store.confirmMockPurchase(token,order);
  assert.equal(store.find(token).account[kind+'Until'],now+days*day);
  store.confirmMockPurchase(token,{...order,requestId:randomUUID()});assert.equal(store.find(token).account[kind+'Until'],now+2*days*day);
 }
});
test('Manya positive mass bonus belongs to VIP, not Premium or inactive pets',()=>{
 for(const [vip,premium,expected] of [[false,false,1],[true,false,1.2],[false,true,1],[true,true,1.2]]){
  const p={account:{vip,premium},pet:{id:'manya',vitalityMs:1}};assert.equal(pets.positiveFactor(p),expected);
  p.pet.vitalityMs=0;assert.equal(pets.positiveFactor(p),1);
 }
});
test('Previously prepared chest with a legacy combined multiplier retains promised greatness',()=>{
 const old={coins:10,greatness:5,items:{candy:2},multiplier:3};
 assert.deepEqual(bonuses.scale(old,old.multiplier),{coins:30,greatness:15,items:{candy:6},multiplier:3});
 assert.throws(()=>bonuses.scale({greatness:Number.MAX_SAFE_INTEGER},1,2));
});
