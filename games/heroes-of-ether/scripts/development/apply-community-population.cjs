"use strict";
// Explicit owner-approved offline operation, never imported by the game server.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'data');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {prepareBattlePopulation}=require('../../src/server/testing/battle-population');
const {renamePopulation}=require('../../src/server/testing/population-names');
const {MARKER}=require('../../src/server/testing/arena-test-bots');
const {readLocal,hash}=require('../../src/server/persistence/state-snapshot');
const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
const {loadConfig,safeError}=require('../../src/server/persistence/postgresql-config');
const {acquireServerLock}=require('../../src/server/runtime/process-lock');
(async()=>{
 if(process.argv[2]!=='--apply')throw Error('Explicit --apply required');
 const release=acquireServerLock(path.join(dir,'server.lock'));let store,database;
 try{
  const before=readLocal(dir,true),config=loadConfig(root);
  if(!config||config.schema!=='heroether')throw Error('Unexpected database');
  database=new PostgreSQLState(config);await database.client.connect();await database.acquire(before.snapshot);
  const at=Date.now();store=new ProfileStore({filePath:path.join(dir,'profiles.json'),journal:true,now:()=>at});
  const normalized=structuredClone(store.data);
  // Verify that loading new code did not change balances, rewards or social state.
  for(const [key,p] of Object.entries(before.world.profiles)){
   const q=structuredClone(normalized.profiles[key]),old=structuredClone(p);
   delete q.wardrobeState;delete old.wardrobeState;q.revision=old.revision;
   assert.equal(hash(q),hash(old),'Unexpected migration: '+p.id);
  }
  const prepared=prepareBattlePopulation(normalized,at,{includeClanIds:Object.keys(normalized.clans)});
  const named=renamePopulation(prepared.data),next=named.data;
  for(const [key,p] of Object.entries(normalized.profiles)){
   const q=structuredClone(next.profiles[key]);q.revision=p.revision;
   if(p.testBot===MARKER){q.name=p.name;if(p.testDisplayNameVersion===undefined)delete q.testDisplayNameVersion;else q.testDisplayNameVersion=p.testDisplayNameVersion;}
   assert.equal(hash(q),hash(p),'Existing player progress changed: '+p.id);
  }
  for(const [id,c] of Object.entries(normalized.clans)){
   const q=structuredClone(next.clans[id]);q.members=c.members;q.roles=c.roles;
   if(c.testOnly===MARKER){q.name=c.name;q.prefix=c.prefix;if(c.testDisplayNameVersion===undefined)delete q.testDisplayNameVersion;else q.testDisplayNameVersion=c.testDisplayNameVersion;}
   assert.equal(hash(q),hash(c),'Clan history changed: '+id);
  }
  assert(Object.values(next.clans).every(c=>c.members.length>=10));
  const sessionsFile=path.join(dir,'test-bot-sessions.json');
  if(prepared.sessions.length){
   const previous=JSON.parse(fs.readFileSync(sessionsFile,'utf8'));
   const merged=[...previous,...prepared.sessions];assert.equal(new Set(merged.map(s=>s.id)).size,merged.length);
   fs.writeFileSync(sessionsFile+'.next',JSON.stringify(merged),{mode:0o600});
  }
  store.save(next,at);await store.close();store=null;
  if(prepared.sessions.length)fs.renameSync(sessionsFile+'.next',sessionsFile);
  const after=readLocal(dir,true);await database.sync(after.snapshot);
  assert.equal((await database.read()).snapshot.digest,after.snapshot.digest);
  console.log(JSON.stringify({ok:true,database:config.database,sourceId:config.sourceId,addedBots:prepared.added,renamedBots:named.renamedBots,renamedClans:named.renamedClans,profiles:Object.keys(after.world.profiles).length,clans:Object.keys(after.world.clans).length,minRoster:Math.min(...Object.values(after.world.clans).map(c=>c.members.length)),revision:after.snapshot.revision,digest:after.snapshot.digest,existingProgressPreserved:true}));
 }finally{await store?.close();await database?.close();release();}
})().catch(e=>{console.error(e.code==='ERR_ASSERTION'?e.message:safeError(e));process.exitCode=1;});
