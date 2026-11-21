"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const Q=require('../../src/server/progression/personal-quests'),{massLimitForLevel,totalMassLimitForLevel}=require('../../src/server/arena/player-limits');
const AT=Date.UTC(2026,10,14,9),def=id=>Q.CATALOG.find(q=>q.id===id);
function player(level=1){const p={id:'eligibility',level,wallet:{coins:100000},quests:undefined};Q.ensure(p,AT);return p;}
test('peak mass eligibility uses the actual room part count and per-part simulation limit at level boundaries',()=>{
  for(const [level,limit]of [[1,40000],[11,40000],[12,60000],[25,60000],[26,216000],[120,216000],[121,384000],[501,480000]]){
    assert.equal(totalMassLimitForLevel(level),limit);
    assert.equal(massLimitForLevel(level),require('../../src/server/arena/arena-simulation').massLimitForLevel(level));
    let giants=0;
    for(let i=0;i<200;i++){
      const p={id:'availability-'+i,level};const q=Q.ensure(p,AT);
      for(const row of q.items){const d=def(row.questId);if(d.metric==='mass')assert.ok(d.target<=limit);if(d.id==='giant')giants++;}
      assert.equal(new Set(q.items.map(r=>r.questId)).size,4);
    }
    assert.equal(giants>0,level>=12);
  }
});
test('unreachable old quest is replaced once for free, same reward tier; finished quests and earned chests stay intact',()=>{
  const p=player(),q=p.quests,row=q.items.find(r=>def(r.questId).tier==='large');row.questId='giant';row.progress=39000;
  q.rerolls=2;const pending=q.pending,coins=p.wallet.coins,old=structuredClone(q),originalId=row.id;
  Q.ensure(p,AT);assert.deepEqual(q,old,'previous immutable state unchanged');
  const replacement=p.quests.items.find(r=>r.id===originalId+'-eligible-v1');
  assert.equal(def(replacement.questId).tier,'large');assert.notEqual(replacement.questId,'giant');assert.equal(replacement.progress,0);
  assert.equal(p.quests.rerolls,2);assert.equal(p.wallet.coins,coins);assert.equal(p.quests.pending,pending);
  const repaired=structuredClone(p.quests);Q.ensure(p,AT+1000);assert.deepEqual(p.quests,repaired);
  replacement.questId='giant';replacement.completedAt=AT;replacement.progress=50000;
  const completed=structuredClone(p.quests);Q.ensure(p,AT+2000);assert.deepEqual(p.quests,completed);
});
test('rerolls cannot reintroduce impossible peaks, while cumulative absorbed mass remains eligible',()=>{
  const p=player();let cumulative=false;
  for(let i=0;i<300;i++){
    const row=p.quests.items.find(r=>def(r.questId).tier==='large');
    Q.act(p,{action:'reroll',questId:row.id,expectedCost:p.quests.rerolls?100:0},AT);
    assert.ok(p.quests.items.every(r=>r.questId!=='giant'));
    if(p.quests.items.some(r=>r.questId==='great_feast'))cumulative=true;
  }
  assert.ok(cumulative);
});
test('repair publishes only after persistence, survives restart, and lobby/arena projections stay read-only',t=>{
  const path=require('path'),{temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store');
  const filePath=path.join(temporary(t,'quest-eligibility'),'profiles.json'),store=new ProfileStore({filePath,now:()=>AT}),auth=store.open();
  const p=store.find(auth.token),row=p.quests.items.find(r=>def(r.questId).tier==='large');row.questId='giant';row.progress=39000;
  store.save(store.data);const before=structuredClone(p),write=store.writeSnapshot;
  const preview=store.view(p);assert.ok(preview.quests.items.every(r=>r.questId!=='giant'));assert.deepEqual(p,before);
  const arena=require('../../src/server/progression/arena-objectives').view(p,null,AT);assert.notEqual(arena.daily?.metric==='mass'&&arena.daily.target,50000);assert.deepEqual(p,before);
  store.writeSnapshot=()=>{throw Error('injected failure');};assert.throws(()=>store.open(auth.token),/injected failure/);assert.deepEqual(store.find(auth.token),before);
  store.writeSnapshot=write;store.open(auth.token);const fixed=structuredClone(store.find(auth.token).quests);
  const restored=new ProfileStore({filePath,now:()=>AT});restored.open(auth.token);assert.deepEqual(restored.find(auth.token).quests,fixed);
  assert.deepEqual(restored.find(auth.token).wallet,before.wallet);
});
