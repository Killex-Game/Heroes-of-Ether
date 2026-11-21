"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { InputIntegrity, inspect, REASON, DURATION_MS } = require("../../src/server/arena/input-integrity");
test("input integrity only attributes explicit server-state injection; ordinary repeats and aim are valid", () => {
  for (const input of [null, [], {}, {type:'chatSend',text:'speed=999'}, {type:'viewport',x:100,y:100,width:1920,height:1080},
    {type:'move',x:999999,y:-50,keepDirection:true}, {type:'split',sequence:4}, {type:'feed',sequence:8},
    {type:'useBooster',boosterId:'sphere',requestId:'same-operation',spawnSerial:1}, {type:'setTurbo',active:true,sequence:3,spawnSerial:1}])
    for(let n=0;n<100;n++) assert.equal(inspect(input),null);
  assert.deepEqual(inspect({type:'move',x:5,y:5,speed:999,mass:999}),
    {kind:'server-state-in-command',command:'move',fields:['mass','speed']});
  assert.deepEqual(inspect({type:'useBooster',boosterId:'sphere',shieldReadyAt:{sphere:0}}).fields,['shieldReadyAt']);
});
test("confirmed tampering bans only the authenticated profile for 180 days, atomically and once", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-integrity-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'profiles.json'),profiles=new ProfileStore({filePath}),a=profiles.open(),b=profiles.open(),at=Date.now(),banned=[];
  const before=structuredClone(profiles.data),guard=new InputIntegrity({profiles,now:()=>at,onBan:id=>banned.push(id)});
  const message={type:'move',targetId:b.profile.id,x:300,y:300,speed:1000};
  await Promise.all([guard.report(a.profile.id,message),guard.report(a.profile.id,message)]);
  const p=profiles.byId(a.profile.id),ban=p.moderation.ban;
  assert.equal(ban.reason,REASON);assert.equal(ban.until-at,DURATION_MS);assert.equal(DURATION_MS,15552000000);
  for(const [key,value] of Object.entries(Object.values(before.profiles).find(p=>p.id===a.profile.id)))
    if(!['moderation','revision'].includes(key)) assert.deepEqual(p[key],value,key);
  assert.deepEqual(profiles.byId(b.profile.id),Object.values(before.profiles).find(p=>p.id===b.profile.id));
  assert.equal(profiles.data.administration.audit.length,1);assert.deepEqual(banned,[a.profile.id]);
  assert.deepEqual(profiles.data.administration.audit[0].evidence,{kind:'server-state-in-command',command:'move',fields:['speed']});
  const restored=new ProfileStore({filePath});assert.deepEqual(restored.byId(a.profile.id).moderation.ban,ban);
  await new InputIntegrity({profiles:restored,now:()=>at}).report(a.profile.id,message);
  assert.equal(restored.data.administration.audit.length,1);
});
test("failed integrity commit never publishes a ban, audit or disconnect and permits a durable retry", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-integrity-fail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'profiles.json'),profiles=new ProfileStore({filePath}),a=profiles.open(),before=structuredClone(profiles.data),bytes=fs.readFileSync(filePath);
  let disconnected=0;const guard=new InputIntegrity({profiles,onBan:()=>disconnected++}),msg={type:'move',speed:100};
  fs.mkdirSync(filePath+'.tmp');await assert.rejects(guard.report(a.profile.id,msg));
  assert.deepEqual(profiles.data,before);assert.deepEqual(fs.readFileSync(filePath),bytes);assert.equal(disconnected,0);assert.equal(guard.pending.size,0);
  fs.rmdirSync(filePath+'.tmp');await guard.report(a.profile.id,msg);assert.equal(disconnected,1);
});

test("WAL failure and a competing save preserve progress before a durable integrity ban", async t => {
  const {ArenaBoosterQueue}=require('../../src/server/profiles/arena-booster-queue');
  const {recover}=require('../../src/server/profiles/profile-journal');
  const {randomUUID}=require('node:crypto');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'integrity-wal-')),filePath=path.join(dir,'profiles.json');
  const profiles=new ProfileStore({filePath,journal:true,incrementalSettlement:true}),a=profiles.open(),queue=new ArenaBoosterQueue(profiles);
  t.after(async()=>{await queue.running;await profiles.close();fs.rmSync(dir,{recursive:true,force:true});});
  const before=structuredClone(profiles.data),stage=profiles.journal.stage.bind(profiles.journal);
  let disconnected=0;const guard=new InputIntegrity({profiles,actionQueue:queue,onBan:()=>disconnected++}),msg={type:'move',speed:100};
  profiles.journal.stage=async()=>{throw Error('injected WAL failure');};
  await assert.rejects(guard.report(a.profile.id,msg),/injected WAL failure/);await queue.running;
  assert.deepEqual(profiles.data,before);assert.equal(disconnected,0);assert.equal(guard.pending.size,0);
  let release,entered,attempts=0;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
  profiles.journal.stage=async next=>{if(++attempts===1){entered();await gate;}return stage(next);};
  const pending=guard.report(a.profile.id,msg);await ready;
  assert.equal(disconnected,0);assert.equal(profiles.byId(a.profile.id).moderation?.ban||null,null);
  profiles.transact(a.token,randomUUID(),'concurrent-test-progress',p=>{p.wallet.coins+=7;});
  const coins=profiles.byId(a.profile.id).wallet.coins;release();await pending;await queue.running;
  assert(attempts>=2);assert.equal(disconnected,1);assert.equal(profiles.byId(a.profile.id).wallet.coins,coins);
  const restored=Object.values(recover(filePath).data.profiles).find(p=>p.id===a.profile.id);
  assert.equal(restored.wallet.coins,coins);assert.equal(restored.moderation.ban.reason,REASON);
  assert.equal(profiles.data.administration.audit.filter(e=>e.actorId==='system:integrity').length,1);
});
