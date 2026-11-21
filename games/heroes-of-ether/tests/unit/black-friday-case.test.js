"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/black-friday-fixture'),B=require('../../src/server/events/black-friday');
function seed(f){f.p().blackFriday={runs:{[f.run.id]:{tokens:100000,completedOrders:0,days:{},purchases:{},finalAt:null}}};}
test('Case consumes new stages of 1/3/5/10/15 committed openings, awards once without account multipliers',()=>{
 const f=fixture();seed(f);f.p().account={...require('../../src/server/accounts/account-benefits').fresh(),vipUntil:f.now()+86400000,premiumUntil:f.now()+86400000};
 const s=()=>f.p().blackFriday.runs[f.run.id];
 let total=0,claimed=0;
 const rewards=new Map([[1,25],[4,50],[9,75],[19,100],[34,250]]);
 for(let i=1;i<=35;i++){
  f.act('buy','chest');const id=f.p().blackFriday.chests.at(-1).id;
  const before=f.p().greatness;f.act('prepare',id);f.act('prepare',id);
  assert.equal(s().openedChests||0,i-1);assert.equal(f.p().greatness,before);
  const input=f.input('open',id);B.mutate(f.store,f.user.token,input,()=>99);
  total+=rewards.get(i)||0;if(rewards.has(i))claimed++;
  assert.equal(s().openedChests,i);assert.equal(s().achievementClaims.friday_case,claimed);
  // The 34th chest also crosses the first 100 earned-token threshold (3 per chest).
  assert.equal(f.p().greatness-before,(rewards.get(i)||0)+(i===34?10:0));
  if(rewards.has(i)&&i<34) assert.equal(f.view().achievements.find(a=>a.id==='friday_case').value,0);
  const saved=structuredClone(f.p());assert.equal(B.mutate(f.store,f.user.token,input).replay,true);
  assert.deepEqual(f.p(),saved);assert.throws(()=>f.act('open',id),/не найден/);
 }
 assert.equal(total,500);B.validate(f.p());
});
test('Case opening is atomic on failed save; ended event or another run cannot gain progress',()=>{
 const f=fixture();seed(f);f.act('buy','chest');const id=f.p().blackFriday.chests[0].id;
 f.act('prepare',id);const input=f.input('open',id),before=structuredClone(f.p()),save=f.store.save;
 f.store.save=()=>{throw Error('disk failure');};
 assert.throws(()=>B.mutate(f.store,f.user.token,input),/disk failure/);assert.deepEqual(f.p(),before);
 f.store.save=save;f.time(f.run.endsAt+1000);
 B.mutate(f.store,f.user.token,input);assert.equal(f.p().blackFriday.runs[f.run.id].openedChests,undefined);
 assert.equal(f.p().blackFriday.runs[f.run.id].achievementClaims.friday_case,0);
});
