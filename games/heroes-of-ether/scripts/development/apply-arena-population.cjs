"use strict";
// Explicit owner-approved offline fixture, never loaded by the game server.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'data');
const {acquireServerLock}=require('../../src/server/runtime/process-lock');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {prepareBattlePopulation}=require('../../src/server/testing/battle-population');
const {MongoState,readLocal,hash}=require('../../src/server/persistence/mongodb-state');
const {loadConfig,safeError}=require('../../src/server/persistence/mongodb-config');
const B=require('../../src/server/events/black-friday');
const OWNER='c39fe041-62a0-4047-87d1-2be4e8ee6562';
const RUN='41ba6351-a7c3-4743-bcfa-e5b24d7993c4';
(async()=>{
 const release=acquireServerLock(path.join(dir,'server.lock'));let store,mongo;
 try{
  const before=readLocal(dir,true),config=loadConfig(root);
  if(!config||config.database!=='hero_ether_test_sweb_play')throw Error('Wrong test database');
  mongo=new MongoState(config);await mongo.client.connect();await mongo.acquire(before.snapshot);
  const at=Date.now();store=new ProfileStore({filePath:path.join(dir,'profiles.json'),journal:true,now:()=>at});
  const ownerClan=Object.values(store.data.profiles).find(p=>p.id===OWNER)?.clanId;
  if(!ownerClan||!store.data.clans[ownerClan])throw Error('Expected owner clan missing');
  const prepared=prepareBattlePopulation(store.data,at,{includeClanIds:[ownerClan]}),next=prepared.data;
  const owner=Object.values(next.profiles).find(p=>p.id===OWNER),state=owner?.blackFriday?.runs?.[RUN];
  if(!state)throw Error('Expected owner event state missing');
  const oldCompleted=state.completedOrders;
  if(state.testOrderCredits===undefined&&state.completedOrders<49&&state.finalAt===null){
   state.testOrderCredits=49-state.completedOrders;state.completedOrders=49;owner.revision++;
  }
  B.validate(owner);
  // Only the explicitly requested owner fields and new bot membership may differ.
  for(const [key,p] of Object.entries(before.world.profiles)){
   if(p.id!==OWNER)assert.equal(hash(next.profiles[key]),hash(p),'Existing profile changed: '+p.id);
   else {const check=structuredClone(next.profiles[key]);check.revision=p.revision;check.blackFriday=structuredClone(p.blackFriday);assert.equal(hash(check),hash(p));}
  }
  for(const [id,c] of Object.entries(before.world.clans)){
   const check={...next.clans[id],members:c.members,roles:c.roles};assert.equal(hash(check),hash(c));
  }
  const sessionsFile=path.join(dir,'test-bot-sessions.json');
  if(prepared.sessions.length){
   const previous=JSON.parse(fs.readFileSync(sessionsFile,'utf8'));
   fs.writeFileSync(sessionsFile+'.tmp',JSON.stringify([...previous,...prepared.sessions]),{mode:0o600});fs.renameSync(sessionsFile+'.tmp',sessionsFile);
  }
  if(prepared.added||oldCompleted!==state.completedOrders)store.save(next,at);
  await store.close();store=null;
  const after=readLocal(dir,true);await mongo.sync(after.snapshot);
  assert.equal((await mongo.read()).snapshot.digest,after.snapshot.digest);
  const bots=Object.values(after.world.profiles).filter(p=>p.testBot==='local-clan-test-v1');
  const clans=Object.values(after.world.clans).filter(c=>c.testOnly==='local-clan-test-v1');
  assert.ok(clans.every(c=>c.members.length>=10));
  assert.ok(after.world.clans[ownerClan].members.length>=10);
  console.log(JSON.stringify({ok:true,addedBots:prepared.added,bots:bots.length,testClans:clans.length,minRoster:Math.min(...clans.map(c=>c.members.length)),ownerClanMembers:after.world.clans[ownerClan].members.length,levels:{sandbox:bots.filter(p=>p.level<12).length,glade:bots.filter(p=>p.level>=12&&p.level<=120).length,arena:bots.filter(p=>p.level>120).length},ownerOrdersBefore:oldCompleted,ownerOrdersAfter:state.completedOrders,revision:after.snapshot.revision,digest:after.snapshot.digest,existingProfilesPreserved:true}));
 }finally{await store?.close();await mongo?.close();release();}
})().catch(e=>{console.error(safeError(e));process.exitCode=1;});
