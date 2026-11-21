"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/black-friday-fixture');
const Q=require('../../src/server/progression/personal-quests'),H=require('../../src/server/progression/arena-objectives');
const B=require('../../src/server/events/black-friday'),book=require('../../src/server/events/black-friday-orders');
test('arena priorities use unfinished highest rewards, then ready rewards, hide all claimed',()=>{
 const rows=[{priority:1,target:10,progress:0,id:'small'},{priority:3,target:10,progress:0,id:'large'},{priority:2,target:10,progress:0,id:'medium'}];
 assert.equal(H.select(rows).id,'large');rows[1].progress=10;assert.equal(H.select(rows).id,'medium');
 rows[2].progress=10;rows[0].progress=10;assert.equal(H.select(rows).id,'large');
 rows.forEach(r=>r.claimed=true);assert.equal(H.select(rows),null);
});
test('arena objective projection is read only, bounded and respects daily/event expiration',()=>{
 const f=fixture(),before=structuredClone(f.p());
 const first=H.view(f.p(),f.manager,f.now());assert.equal(first.daily.reward,'large');
 // Four random slots do not necessarily include a secret order.
 const available=B.arenaOrders(f.p(),f.manager,f.now());
 assert.equal(first.event.reward,Math.max(...available.map(r=>r.reward)));
 assert.equal(first.event.icon,B.arenaOrders(f.p(),f.manager,f.now()).find(r=>r.id===first.event.id).icon);
 assert.deepEqual(f.p(),before);assert.equal(first.daily.expiresAt,Date.UTC(2026,10,8,21));
 assert.ok(JSON.stringify(first).length<1300);
 Q.ensure(f.p(),f.now());f.p().quests.items.forEach(r=>{r.claimedAt=f.now();});
 assert.equal(H.view(f.p(),f.manager,f.now()).daily,null);
 f.time(Date.UTC(2026,10,8,21));const rollover=structuredClone(f.p());
 assert.ok(H.view(f.p(),f.manager,f.now()).daily);assert.deepEqual(f.p(),rollover);
 f.time(f.run.endsAt);assert.equal(H.view(f.p(),f.manager,f.now()).event,null);
});

test('all order icons follow the current template, including reassignment with the same slot id',()=>{
 const f=fixture();f.p().wallet.coins=500;f.act('exchange','coins');const s=f.p().blackFriday.runs[f.run.id];
 const d=book.ensure(f.p(),s,B.day(f.now()),f.now());
 const slot=d.slots.reduce((a,b)=>book.tiers.find(t=>t.id===a.tier).tokens>=book.tiers.find(t=>t.id===b.tier).tokens?a:b);
 d.slots=[slot]; // Isolate one visible order to test replacement without changing its slot ID.
 const id=slot.current.id;
 for(const [template,icon] of [[0,'assets/menu-icons/128/currency_bucks.webp'],[5,'assets/arena/thorn-v2.webp'],[6,'assets/boosters/png/rocket.png'],[2,'assets/events/black-friday/order-timer.webp']]) {
   slot.current.template=template;slot.current.progress=0;
   assert.equal(H.view(f.p(),f.manager,f.now()).event.icon,icon);
   assert.ok(H.view(f.p(),f.manager,f.now()).event.id.endsWith(id));
 }
});
test('event selection updates after completion/claim, uses coupon reward, and excludes exhausted quotas',()=>{
 const f=fixture();f.p().wallet.coins=500;f.act('exchange','coins');const s=f.p().blackFriday.runs[f.run.id];
 const d=book.ensure(f.p(),s,B.day(f.now()),f.now());
 // Deterministic four-slot projection: the production book may draw any tier order.
 d.slots=['secret','important','common','common'].map((tier,i)=>({tier,complete:false,current:{
   id:`${tier}:${i}:0`,template:0,progress:0,assignedAt:f.now(),revision:0,catalogVersion:2
 }}));
 d.slots[0].current.progress=500;
 assert.equal(H.view(f.p(),f.manager,f.now()).event.reward,20);
 d.slots[0].complete=true;d.slots[1].complete=true;s.couponAt=f.now();
 assert.equal(H.view(f.p(),f.manager,f.now()).event.reward,20);
 d.slots.forEach(slot=>{slot.complete=true;});
 for(const lane of Object.values(d.lanes))lane.done=lane.issued=4;
 assert.equal(H.view(f.p(),f.manager,f.now()).event,null);
});
