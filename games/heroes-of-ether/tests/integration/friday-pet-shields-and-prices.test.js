"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const fixture=require('../helpers/black-friday-fixture'),{temporary}=require('../temp');
const B=require('../../src/server/events/black-friday'),book=require('../../src/server/events/black-friday-orders');
const pets=require('../../src/server/pets/arena-pets'),rules=require('../../public/shared/pet-rules');
const {Arena}=require('../../src/server/arena/arena-simulation');
const actions=require('../../src/server/arena/quest-actions');
const products=require('../../public/shared/virtual-product-catalog');
function shieldOrder(f){
 f.store.transact(f.user.token,randomUUID(),'fixture-shield-order',p=>{
  B.rewardCurrencyPack(p,f.run,0,f.now());
  const s=p.blackFriday.runs[f.run.id],d=book.ensure(p,s,B.day(f.now()),f.now());
  fixture.forceOrder(d,book.templates.findIndex(t=>t.metric==='shieldUses'));
 });
}
test('all 24 pet levels advance shield orders once, survive WAL and do not consume inventory',t=>{
 const file=path.join(temporary(t,'friday-pet-shields'),'profiles.json'),f=fixture({filePath:file,journal:true});
 shieldOrder(f);let count=0;
 const initialInventory=structuredClone(f.p().inventory);
 for(const id of ['zaya','leva','drakosha','manya'])for(const games of [0,...rules.thresholds]){
  const arena=new Arena({etherCount:0}),p=arena.addPlayer(0,'pet-owner');p.profileId=f.p().id;
  const stats=rules.stats(id,games),profile={...f.p(),level:100,pets:{equipped:id,owned:{[id]:{games,vitalityMs:stats.capacityMs,refillAt:f.now()+86400000}}}};
  pets.start(p,profile,0,f.now());f.progress({type:'lifeStarted',lifeId:p.lifeId});
  const when=stats.intervalMs;
  pets.tick(arena,p,when-1);assert.equal(actions.takePending(arena).length,0);
  pets.tick(arena,p,when);const events=actions.takePending(arena);assert.equal(events.length,1);
  assert(arena.hasEffect(p,'shield',when));f.time(f.now()+when);
  f.progress(...events);f.progress(...events);
  assert.equal(f.view().orders[0].progress,++count,id+'/'+games);
  pets.tick(arena,p,when);assert.equal(actions.takePending(arena).length,0);
  // An existing shield prevents the next automatic shield; no fictitious progress.
  p.effects.golden_shield=when+stats.intervalMs+1000;p.pet.vitalityMs=stats.capacityMs;
  pets.tick(arena,p,when+stats.intervalMs);assert.equal(actions.takePending(arena).length,0);
  f.progress({type:'lifeEnded',lifeId:p.lifeId,durationSeconds:when/1000,reason:'exit'});
 }
 assert.deepEqual(f.p().inventory,initialInventory);
 const restored=require('../../src/server/profiles/profile-journal').recover(file).data;
 const p=Object.values(restored.profiles).find(p=>p.id===f.p().id);
 assert.deepEqual(p.blackFriday,f.p().blackFriday);assert.deepEqual(p.quests,f.p().quests);
});
test('pet shield write failure, stale life, invalid shield and repeated receipt cannot lose or duplicate progress',t=>{
 const f=fixture({filePath:path.join(temporary(t,'friday-shield-retry'),'profiles.json'),journal:true});
 f.progress({type:'lifeStarted',lifeId:'life-1'});shieldOrder(f);
 const event={type:'clanArenaAction',lifeId:'life-1',sequence:1,metric:'petShield',boosterId:'golden_shield'};
 f.progress({...event,lifeId:'stale',sequence:99},{...event,boosterId:'meat',sequence:99});
 assert.equal(f.view().orders[0].progress,0);
 const before=structuredClone(f.p()),save=f.store.save;
 f.store.save=()=>{throw Error('fixture disk failure');};
 assert.throws(()=>f.progress(event),/disk failure/);assert.deepEqual(f.p(),before);f.store.save=save;
 f.progress(event);f.progress(event);assert.equal(f.view().orders[0].progress,1);
 // The manual-input cursor is independent of pet grants.
 f.progress({type:'arenaAction',lifeId:'life-1',sequence:100,metric:'boosterUses',boosterId:'golden_shield'});
 f.progress({...event,sequence:2});assert.equal(f.view().orders[0].progress,3);
 f.progress({type:'lifeEnded',lifeId:'life-1',durationSeconds:1,reason:'exit'});
 f.progress({type:'lifeStarted',lifeId:'life-2'});f.progress({...event,lifeId:'life-2'});
 assert.equal(f.view().orders[0].progress,4);
 const restored=require('../../src/server/profiles/profile-journal').recover(f.store.filePath).data;
 assert.deepEqual(restored.profiles,f.store.data.profiles);
});
test('ether pack votes and Friday tokens double, contents and other currencies retain their prices',()=>{
 const ids=['change','stash','piggy','gift','treasure','bank'],votes=[2,10,20,50,100,200],amounts=[20,100,200,550,1200,2500];
 for(let i=0;i<ids.length;i++)for(const coupon of [false,true]){
  const product=products.get('bucks:'+ids[i]);assert.equal(product.votes,votes[i]);assert.equal(product.amount,amounts[i]);
  const f=fixture();if(coupon)f.store.confirmMockPurchase(f.user.token,{productId:'event:manya-coupon',confirmed:true,eventId:f.run.id,requestId:randomUUID()});
  const old=f.p().wallet.bucks,tokens=f.view().tokens,input={productId:product.id,confirmed:true,currencyPromoRunId:f.run.id,requestId:randomUUID()};
  const result=f.store.confirmMockPurchase(f.user.token,input);
  assert.equal(result.payment.votes,votes[i]);assert.equal(f.p().wallet.bucks-old,amounts[i]*2);
  assert.equal(f.view().tokens-tokens,votes[i]*10);assert.equal(f.p().activity.values.banker,amounts[i]*2);
  const after=structuredClone(f.p());assert(f.store.confirmMockPurchase(f.user.token,input).replay);assert.deepEqual(f.p(),after);
 }
 assert.deepEqual(products.products.filter(p=>p.type==='currency'&&p.currency!=='bucks').map(p=>p.votes),[1,5,10,25,50,100,1,5,10,25,50,100]);
});
