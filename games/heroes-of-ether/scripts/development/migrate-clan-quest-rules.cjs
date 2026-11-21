'use strict';
// Explicit offline upgrade of the current day's approved definitions/newcomers.
// Refuses payouts, board replacement, personal progress or history changes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const daily=require('../../src/server/clans/daily-quests/service');
const {MongoState,readLocal,sameContents}=require('../../src/server/persistence/mongodb-state');
const {loadConfig,safeError}=require('../../src/server/persistence/mongodb-config');
const {ProfileJournal,REVISION}=require('../../src/server/profiles/profile-journal');
const {acquireServerLock}=require('../../src/server/runtime/process-lock');
function prepare(before,at){
 const next=daily.capture(before,before,at,{canSettle:false});daily.validate(next);
 assert.deepEqual(next.profiles,before.profiles,'Profile change refused');
 assert.deepEqual(next.clanQuestRewards,before.clanQuestRewards,'Payout/history change refused');
 const changes=[];
 for(const [id,clan]of Object.entries(next.clans)){
  const old=before.clans[id];assert(old,'New clan refused');
  const copy=structuredClone(clan),previous=old.dailyQuests?.board,current=copy.dailyQuests?.board;
  if(current){
   assert(previous&&current.day===previous.day,'Daily board replacement refused');
   assert.deepEqual(current.quests.map(q=>q.id),previous.quests.map(q=>q.id),'Quest reselection refused');
   assert.deepEqual({...current,quests:previous.quests,catalogVersion:previous.catalogVersion},previous,'Roster or progress metadata change refused');
   for(const q of current.quests){
    const prior=previous.quests.find(p=>p.id===q.id);
    assert.equal(q.progress,Math.min(prior.progress,q.target),'Unexpected progress change');
   }
  }
  copy.dailyQuests=old.dailyQuests;
  if(old.dailyQuests===undefined)delete copy.dailyQuests;
  if(copy.competition)copy.competition.recruits=structuredClone(old.competition.recruits);
  assert.deepEqual(copy,old,'Unrelated clan change refused');
  if(clan!==old)changes.push({id,name:clan.name,boardUpgraded:current?.catalogVersion!==previous?.catalogVersion,
   recruits:Object.keys(clan.competition.recruits).filter(pid=>clan.competition.recruits[pid]!==old.competition.recruits[pid])});
 }
 const control={...next.clanQuests};
 for(const field of ['catalogVersion','recruitRulesVersion','nextAt']){
  if(Object.hasOwn(before.clanQuests,field))control[field]=before.clanQuests[field];else delete control[field];
 }
 assert.deepEqual(control,before.clanQuests,'Unrelated schedule change refused');
 assert.deepEqual({...next,clans:before.clans,clanQuests:before.clanQuests},before,'Unrelated world change refused');
 return {next,changes};
}
(async()=>{
 const check=process.argv[2]==='--check',apply=process.argv[2]==='--apply';
 if((!check&&!apply)||!process.argv[3]||(check&&!process.argv[4]))throw Error('Use --check DATA_DIRECTORY REPORT_DIRECTORY or --apply REPORT_DIRECTORY');
 const dir=check?path.resolve(process.argv[3]):path.join(root,'data'),report=path.resolve(process.argv[check?4:3]);
 fs.mkdirSync(report,{mode:0o700});let release,journal,mongo;
 try{
  if(apply)release=acquireServerLock(path.join(dir,'server.lock'));
  const before=readLocal(dir,true),at=Date.now(),{next,changes}=prepare(before.world,at);
  const approved=structuredClone(next);
  fs.writeFileSync(path.join(report,'plan.json'),JSON.stringify({at,changes},null,2),{mode:0o600});
  assert.deepEqual(prepare(next,at).next,next,'Migration must be idempotent');
  if(check){console.log(JSON.stringify({dryRun:true,clans:changes.length,boards:changes.filter(c=>c.boardUpgraded).length,recruits:changes.reduce((n,c)=>n+c.recruits.length,0),allProfilesUnchanged:true}));return;}
  assert(!Object.values(before.world.profiles).some(p=>p.progress?.session),'Life not settled');
  const config=loadConfig(root);
  if(!config||!['hero_ether','hero_ether_test_sweb_play'].includes(config.database))throw Error('Unexpected database');
  mongo=new MongoState(config);await mongo.client.connect();await mongo.acquire(before.snapshot);
  assert(sameContents(await mongo.read(),before),'Cloud differs before migration');
  if(next!==before.world){journal=new ProfileJournal(path.join(dir,'profiles.json'));journal.commit(next);await journal.close();journal=null;}
  const after=readLocal(dir,true),actual=structuredClone(after.world);
  if(Object.hasOwn(approved,REVISION))actual[REVISION]=approved[REVISION];else delete actual[REVISION];
  assert.deepEqual(actual,approved,'Committed migration differs from approved plan');
  await mongo.sync(after.snapshot);assert(sameContents(await mongo.read(),after),'Cloud differs after migration');
  const result={ok:true,at,clans:changes.length,allProfilesUnchanged:true,revision:after.snapshot.revision,digest:after.snapshot.digest};
  fs.writeFileSync(path.join(report,'result.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
 }finally{await journal?.close();await mongo?.close();release?.();}
})().catch(error=>{console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:safeError(error));process.exitCode=1});
