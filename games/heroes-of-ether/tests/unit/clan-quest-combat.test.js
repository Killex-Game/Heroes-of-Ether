'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Arena}=require('../../src/server/arena/arena-simulation');
function scene(){
 const arena=new Arena({etherCount:0}),owner=arena.addPlayer(0,'owner'),target=arena.addPlayer(0,'target');
 for(const [p,x] of [[owner,1000],[target,1500]]){Object.assign(p,{x,y:1000,targetX:x,targetY:1000,protectedUntil:0,stopped:true,profileId:p.id,level:25});arena.gainMass(p,1000-p.mass);}
 arena.progressEvents.length=0;
 const hit=id=>arena.combat.impact({id:'shot',boosterId:id,ownerId:owner.id,ownerLife:owner.lifeId,x:target.x-target.radius,y:target.y,dx:1,dy:0,speed:200},target,3000);
 return {arena,owner,target,hit};
}
test('split quest counts resulting parts: rocket three, knuckles limit, blocked/unsplittable hit zero',()=>{
 for(const id of ['rocket','knuckles','axe','mine']){
  const {arena,target,hit}=scene();target.effects={golden_shield:10000};hit(id);assert.equal(arena.progressEvents.filter(e=>e.metric==='splitParts').length,0);
  target.effects={};hit(id);const receipts=arena.progressEvents.filter(e=>e.metric==='splitParts');assert.equal(receipts.length,1,id);
  assert.equal(receipts[0].amount,arena.bodies(target).length,id);
  if(id==='rocket')assert.equal(receipts[0].amount,3);
  if(id==='knuckles'){assert.equal(receipts[0].amount,arena.maxParts);hit(id);assert.equal(arena.progressEvents.filter(e=>e.metric==='splitParts').length,1);}
 }
});
test('both poisons count successful applications, no periodic tick credits or shielded impacts',()=>{
 for(const id of ['poison','mega_poison']){
  const {arena,target,hit}=scene();target.effects={sphere:10000};hit(id);assert(!arena.progressEvents.length);
  target.effects={};hit(id);hit(id);const receipts=arena.progressEvents.filter(e=>e.type==='clanArenaAction');
  assert.deepEqual(receipts.map(e=>[e.metric,e.sequence]),[['clanPoisonHits',1],['clanPoisonHits',2]]);
  arena.boosterEffects.tick(target,5000);assert.equal(arena.progressEvents.filter(e=>e.type==='clanArenaAction').length,2);
 }
});
