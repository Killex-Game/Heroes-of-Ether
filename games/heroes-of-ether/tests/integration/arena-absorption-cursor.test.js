"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const quests=require('../../src/server/progression/personal-quests');
test('actual absorption contacts have a monotonic eater-life cursor, reset only on a new life',()=>{
  const arena=new Arena({etherCount:0});
  const add=(id,mass)=>{const p=arena.addPlayer(0,id);Object.assign(p,{mass,radius:radiusForMass(mass),x:500,y:500,protectedUntil:0});return p;};
  const eater=add('eater',10000),victim=add('victim',20),other=add('other',20);
  const first=arena.resolveAbsorptions(100);
  assert.deepEqual(first.map(e=>[e.eaterId,e.eaterLifeId,e.absorptionSequence]),
    [[eater.id,eater.lifeId,1],[eater.id,eater.lifeId,2]]);
  arena.resetPlayer(victim,200);Object.assign(victim,{mass:20,radius:radiusForMass(20),x:500,y:500,protectedUntil:0});
  assert.equal(arena.resolveAbsorptions(201)[0].absorptionSequence,3);
  const old=eater.lifeId;arena.resetPlayer(eater,300);
  assert.notEqual(eater.lifeId,old);assert.equal(eater.questAbsorptionSequence,0);
  assert.equal(other.dead,true);
});
test('sequenced quest contacts retain legacy results with bounded history and reject repeats/wrong life',async t=>{
  const at=Date.UTC(2026,10,11,12),store=new ProfileStore({now:()=>at});t.after(()=>store.close());
  const auth=store.open();store.startLife(auth.profile.id,'one');
  const legacy=structuredClone(store.find(auth.token)),cursor=structuredClone(legacy);
  let total=0;
  for(let i=1;i<=2000;i++){
    const e={type:'absorbed',profileId:auth.profile.id,victimProfileId:'victim',victimPartId:'p'+i,
      lifeId:'victim-life',gain:1,victimDefeated:false};
    assert.deepEqual(quests.progress(cursor,{...e,eaterLifeId:'one',absorptionSequence:i},at),quests.progress(legacy,e,at));
    total++;
  }
  const retained=structuredClone(cursor.quests);
  for(const e of [{eaterLifeId:'one',absorptionSequence:2000},{eaterLifeId:'old',absorptionSequence:2001},
    {eaterLifeId:'one',absorptionSequence:-1},{eaterLifeId:'one',absorptionSequence:NaN}]){
    assert.equal(quests.progress(cursor,{type:'absorbed',victimProfileId:'victim',victimPartId:'late',lifeId:'v',gain:10,...e},at),undefined);
    assert.deepEqual(cursor.quests,retained);
  }
  assert.deepEqual(cursor.quests.items,legacy.quests.items);
  assert.equal(cursor.quests.session.absorptionSequence,total);
  assert.equal(cursor.quests.session.seenBuckets,undefined);
  quests.validate(cursor);
  cursor.quests.session.absorptionSequence=-1;assert.throws(()=>quests.validate(cursor),/Повреждены/);
});
test('cursor and quest progress commit together, survive recovery and failed writes',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'absorption-cursor-')),filePath=path.join(root,'profiles.json');
  const at=Date.UTC(2026,10,11,12),store=new ProfileStore({filePath,journal:true,now:()=>at});
  t.after(async()=>{await store.close();fs.rmSync(root,{recursive:true,force:true});});
  const auth=store.open();store.startLife(auth.profile.id,'one');
  const event={type:'absorbed',profileId:auth.profile.id,victimProfileId:'victim',victimPartId:'part',
    lifeId:'victim-life',eaterLifeId:'one',absorptionSequence:1,gain:10,victimDefeated:false};
  const before=structuredClone(store.data),save=store.save;
  store.save=()=>{throw Error('disk');};assert.throws(()=>store.applyArenaProgress('one',[event],at),/disk/);
  assert.deepEqual(store.data,before);store.save=save;
  store.applyArenaProgress('one',[event],at);
  const restored=require('../../src/server/profiles/profile-journal').recover(filePath).data;
  const p=Object.values(restored.profiles).find(p=>p.id===auth.profile.id);
  assert.equal(p.quests.session.absorptionSequence,1);
  const committed=structuredClone(p.quests);
  quests.progress(p,event,at);assert.deepEqual(p.quests,committed);
  store.applyArenaProgress('end',[{type:'lifeEnded',profileId:auth.profile.id,lifeId:'one',durationSeconds:2,reason:'absorbed'}],at+2000);
  store.startLife(auth.profile.id,'two');
  assert.equal(store.byId(auth.profile.id).quests.session.absorptionSequence,undefined);
  const fresh=store.byId(auth.profile.id);
  assert.equal(quests.progress(fresh,event,at),undefined);
});
