"use strict";
// Deliberate offline repair. Normal startup/login never invokes this command.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const {prepare,assertOnlyRepair}=require('../../src/server/testing/bot-membership-repair');
const {MongoState,readLocal,sameContents}=require('../../src/server/persistence/mongodb-state');
const {loadConfig,safeError}=require('../../src/server/persistence/mongodb-config');
const {ProfileJournal}=require('../../src/server/profiles/profile-journal');
const {acquireServerLock}=require('../../src/server/runtime/process-lock');
(async()=>{
 const check=process.argv[2]==='--check',apply=process.argv[2]==='--apply';
 if((!check&&!apply)||!process.argv[3]||(check&&!process.argv[4]))
  throw Error('Use --check DATA_DIRECTORY REPORT_DIRECTORY or --apply REPORT_DIRECTORY');
 const dir=check?path.resolve(process.argv[3]):path.join(root,'data');
 const report=path.resolve(process.argv[check?4:3]);fs.mkdirSync(report,{mode:0o700});
 let release,journal,mongo;
 try{
  if(apply)release=acquireServerLock(path.join(dir,'server.lock'));
  const before=readLocal(dir,true),at=Date.now(),repair=prepare(before.world,at);
  const changes={at,...repair.summary,changes:repair.changes};
  fs.writeFileSync(path.join(report,'changes.json'),JSON.stringify(changes,null,2),{mode:0o600});
  assert.deepEqual(prepare(repair.data,at).summary,{assignedGenders:0,removedUnderlevelMembers:0,affectedClans:0},'Repair must be idempotent');
  if(check){console.log(JSON.stringify({dryRun:true,...repair.summary,profiles:Object.keys(before.world.profiles).length,clans:Object.keys(before.world.clans).length,revision:before.snapshot.revision,digest:before.snapshot.digest}));return;}
  assert(!Object.values(before.world.profiles).some(p=>p.progress?.session),'Life not settled');
  const config=loadConfig(root);
  if(!config||!['hero_ether','hero_ether_test_sweb_play'].includes(config.database))throw Error('Unexpected database');
  mongo=new MongoState(config);await mongo.client.connect();await mongo.acquire(before.snapshot);
  assert(sameContents(await mongo.read(),before),'Cloud differs before repair');
  if(repair.changes.length){journal=new ProfileJournal(path.join(dir,'profiles.json'));journal.commit(repair.data);await journal.close();journal=null;}
  const after=readLocal(dir,true);assertOnlyRepair(before.world,after.world);
  await mongo.sync(after.snapshot);assert.equal((await mongo.read()).snapshot.digest,after.snapshot.digest,'Cloud differs after repair');
  const result={ok:true,database:config.database,...repair.summary,profiles:Object.keys(after.world.profiles).length,
   clans:Object.keys(after.world.clans).length,revision:after.snapshot.revision,digest:after.snapshot.digest,
   humanProfilesUnchanged:true,experienceAndCurrenciesUnchanged:true};
  fs.writeFileSync(path.join(report,'result.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
 }finally{await journal?.close();await mongo?.close();release?.();}
})().catch(e=>{console.error(e.code==='ERR_ASSERTION'?e.message.split('\n')[0]:safeError(e));process.exitCode=1});
