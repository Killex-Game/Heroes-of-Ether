"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {difference,ProfileJournal,recover}=require('../../src/server/profiles/profile-journal');
const {applyTransfer}=require('../../src/server/profiles/profile-transfer');
const {ProfileStore}=require('../../src/server/profiles/profile-store');

test('counter patches preserve life changes, removals, nested records and old snapshots',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'counter-wal-')),file=path.join(root,'profiles.json');
  const journal=new ProfileJournal(file,{intervalMs:60000});
  t.after(async()=>{if(!journal.closed)await journal.close();fs.rmSync(root,{recursive:true,force:true});});
  let world={profiles:{p:{progress:{xp:0,session:null},activity:{values:{a:1},claimed:{a:0}}}},clans:{}};
  journal.commit(world);
  for(let i=0;i<120;i++){
    const before=structuredClone(world),next=structuredClone(world),p=next.profiles.p;
    p.progress.xp=i;
    p.progress.session=i%7?{id:'life-'+Math.floor(i/7),xp:i,splitVictims:['a','b'],
      nested:{count:i,legacy:i%3?{x:1}:null}}:null;
    p.progress.recentVictims=Object.fromEntries(Array.from({length:i%9},(_,j)=>['p'+j,i+j]));
    p.activity.values.a=i;
    if(i%2)p.activity.values.extra={deep:{again:{value:i}}};else delete p.activity.values.extra;
    Object.defineProperty(p.activity.values,'__proto__',{value:i,writable:true,configurable:true,enumerable:true});
    const patch=JSON.parse(JSON.stringify(difference(next,world)));
    const transferred=applyTransfer(world,patch);
    assert.deepEqual(transferred,next);assert.deepEqual(world,before);
    journal.commit(next);
    assert.deepEqual(recover(file).data.profiles,next.profiles);
    if(i%31===0)await journal.requestCheckpoint();
    world=transferred;
  }
  await journal.close();assert.deepEqual(recover(file).data.profiles,world.profiles);
});

test('an arena counter update does not resend unchanged achievement dictionaries',()=>{
  const store=new ProfileStore(),auth=store.open(),before=store.data;
  const next=structuredClone(before),p=Object.values(next.profiles)[0];
  p.activity.values.boosters=123;
  p.progress.kills=456;
  const patch=difference(next,before),edit=Object.values(patch.tables.profileEdits)[0];
  assert.deepEqual(edit.nested.progress,{set:{kills:456},remove:[]});
  assert.equal(edit.nested.activity.nested.values.set.boosters,123);
  assert.ok(JSON.stringify(edit.nested.activity).length<200);
  assert.deepEqual(applyTransfer(before,JSON.parse(JSON.stringify(patch))),next);
  assert.equal(store.find(auth.token).progress.kills,0);
});
