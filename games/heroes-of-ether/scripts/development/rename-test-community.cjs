"use strict";
// One explicit, offline, durable rename; no population changes or economy settlement.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'data');
const {renamePopulation,assertOnlyRenames}=require('../../src/server/testing/population-names');
const {MongoState,readLocal,sameContents}=require('../../src/server/persistence/mongodb-state');
const {loadConfig,safeError}=require('../../src/server/persistence/mongodb-config');
const {ProfileJournal}=require('../../src/server/profiles/profile-journal');
const {acquireServerLock}=require('../../src/server/runtime/process-lock');
(async()=>{
 if(process.argv[2]!=='--apply'||!process.argv[3])throw Error('Explicit --apply REPORT_DIRECTORY required');
 const report=path.resolve(process.argv[3]);fs.mkdirSync(report,{mode:0o700});
 const release=acquireServerLock(path.join(dir,'server.lock'));let journal,mongo;
 try{
  const before=readLocal(dir,true),config=loadConfig(root);
  if(!config||!['hero_ether','hero_ether_test_sweb_play'].includes(config.database))throw Error('Unexpected database');
  assert(!Object.values(before.world.profiles).some(p=>p.progress?.session),'Life not settled');
  mongo=new MongoState(config);await mongo.client.connect();await mongo.acquire(before.snapshot);
  const remote=await mongo.read();assert(sameContents(remote,before),'Cloud differs before rename');
  const named=renamePopulation(before.world);
  fs.writeFileSync(path.join(report,'names.json'),JSON.stringify({bots:named.botChanges,clans:named.clanChanges},null,2),{mode:0o600});
  if(named.renamedBots||named.renamedClans){journal=new ProfileJournal(path.join(dir,'profiles.json'));journal.commit(named.data);await journal.close();journal=null;}
  const after=readLocal(dir,true);assertOnlyRenames(before.world,after.world);await mongo.sync(after.snapshot);
  assert.equal((await mongo.read()).snapshot.digest,after.snapshot.digest,'Cloud differs after rename');
  const result={ok:true,database:config.database,renamedBots:named.renamedBots,renamedClans:named.renamedClans,profiles:Object.keys(after.world.profiles).length,clans:Object.keys(after.world.clans).length,revision:after.snapshot.revision,digest:after.snapshot.digest,onlyNamesChanged:true};
  fs.writeFileSync(path.join(report,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await journal?.close();await mongo?.close();release();}
})().catch(e=>{console.error(e.code==='ERR_ASSERTION'?e.message.split('\n')[0]:safeError(e));process.exitCode=1});
