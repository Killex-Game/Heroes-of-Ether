'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {BOOSTERS,publicCatalog,boosterRarity}=require('../../src/server/boosters/booster-catalog');
const Q=require('../../src/server/progression/personal-quests');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const orders=require('../../src/server/events/black-friday-orders');
test('current and future event categories are rare; event acquisition remains restricted',()=>{
 assert.equal(boosterRarity({tier:'event',id:'future-event-item'}),'rare');
 const items=publicCatalog().items;
 for(const item of BOOSTERS.values())if(item.tier==='event'){
  const visible=items.find(i=>i.id===item.id);
  assert.equal(item.rarity,'rare');assert.equal(visible.tier,'rare');assert.equal(visible.eventOnly,true);
  assert.equal(visible.purchasable,false);
  const store=new ProfileStore(),user=store.open(),before=structuredClone(store.find(user.token));
  assert.throws(()=>store.buy(user.token,item.id,randomUUID()));assert.deepEqual(store.find(user.token),before);
 }
});
test('rare event uses reach event orders across lives exactly once, without unknown metrics',()=>{
 const now=Date.UTC(2026,10,21,12),store=new ProfileStore({now:()=>now}),user=store.open(),p=store.find(user.token);
 const d={version:3,catalogVersion:2,earned:0,swaps:0,exchanges:{},
  lanes:Object.fromEntries(orders.tiers.map(t=>[t.id,{done:0,issued:t.id==='important'?1:0}])),
  slots:[{tier:'important',complete:false,current:{id:'important:0:0',revision:0,template:12,progress:0,assignedAt:now,catalogVersion:2}}]};
 // Use the actual tier that owns the rare-use order, independent of translated names.
 const tier=orders.tiers.find(t=>t.targets[12]!==null).id;d.slots[0].tier=tier;d.slots[0].current.id=tier+':0:0';
 for(const t of orders.tiers)d.lanes[t.id].issued=t.id===tier?1:0;
 for(let i=1;i<=2;i++){
  Q.progress(p,{type:'lifeStarted',lifeId:'life'+i},now);
  const event={type:'arenaAction',lifeId:'life'+i,sequence:1,metric:'boosterUses',boosterId:'easter_egg'};
  const session={...p.quests.session},changes=Q.progress(p,event,now);
  assert.deepEqual(changes,{boosterUses:1,rareUses:1});
  orders.progress(p,d,event,now,now,session,changes);
  const duplicate=Q.progress(p,event,now);assert.equal(duplicate,undefined);
  orders.progress(p,d,event,now,now,session,duplicate);
  assert.equal(d.slots[0].current.progress,i);
 }
 orders.validate(d);
});
