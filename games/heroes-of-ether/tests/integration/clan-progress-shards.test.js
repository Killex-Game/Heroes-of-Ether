'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {temporary}=require('../temp');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {ClanService}=require('../../src/server/clans/clan-service');
const {ClanArenaProgressShards}=require('../../src/server/profiles/clan-arena-progress-shards');
const {ArenaProgressPreparer}=require('../../src/server/profiles/arena-progress-preparer');
const {recover}=require('../../src/server/profiles/profile-journal');
const start=Date.parse('2026-11-15T05:00:00Z');
function comparable(data){const copy=structuredClone(data);for(const p of Object.values(copy.profiles))
  p.transactions.entries.forEach((e,i)=>{e.id='entry-'+i;});return copy;}
function fixture(t,pipeline=false,day=start){
 let cleanup,now=day-86400000;
 const dir=temporary({after:fn=>{cleanup=fn;}},'clan-progress-shards');
 const store=new ProfileStore({filePath:path.join(dir,'profiles.json'),journal:true,now:()=>now,
   clanDailyQuests:true,incrementalSettlement:true});
 const serial=new ProfileStore({now:()=>now,clanDailyQuests:true,incrementalSettlement:true});
 const pool=pipeline?new ArenaProgressPreparer({parallelism:3,computeBudgetMs:100}):new ClanArenaProgressShards({count:3});
 store.arenaPreparer=pool;
 t.after(async()=>{await store.close();await serial.close();cleanup();});
 const users=Array.from({length:12},()=>store.open()),api=new ClanService(store);
 for(const u of users)store.transact(u.token,'clan-shard-seed-'+u.profile.id,'fixture',p=>{
   p.level=12;p.progress.xp=require('../../src/server/progression/experience-progression').xpForLevel(12);p.wallet.coins=10000;
 });
 for(let i=0;i<3;i++){
   const leader=users[i*4];api.mutate(leader.token,{action:'create',requestId:randomUUID(),name:'Клан '+i,prefix:'C'+i,emblem:'grove',privacy:'open'});
   const clanId=store.find(leader.token).clanId;
   for(const u of users.slice(i*4+1,i*4+4))api.mutate(u.token,{action:'apply',requestId:randomUUID(),clanId});
 }
 now=day;store.refreshCompetition();
 for(const [i,u]of users.entries())store.startLife(u.profile.id,'life-'+i);
 const data=structuredClone(store.data),catalog=require('../../src/server/clans/daily-quests/catalog.json');
 for(const clan of Object.values(data.clans))clan.dailyQuests.board.quests=['xp','food','arenaMs'].map(metric=>({
   ...catalog.items.find(q=>q.metric===metric),progress:0,completedAt:null}));
 for(const p of Object.values(data.profiles))p.quests.items.forEach((q,i)=>{q.questId=['harvest','great_feast','hunter','feast'][i];});
 store.save(data);serial.data=structuredClone(store.data);
 const batch=n=>({id:'clan-tick-'+n,at:day+n*1000,progress:users.flatMap((u,i)=>[
   {type:'questSample',profileId:u.profile.id,lifeId:'life-'+i,food:10*n,rank:i+1},
   {type:'massPeak',profileId:u.profile.id,mass:1000+n*200},
   {type:'absorbed',profileId:u.profile.id,victimProfileId:users[(i+5)%12].profile.id,
     lifeId:'victim-'+n+'-'+i,victimPartId:'part-'+n+'-'+i,gain:30,victimDefeated:true},
 ])});
 return {store,serial,pool,users,batch};
}

for(const pipeline of [false,true])test(`clan progress respects an owner-scheduled extra quest season, pipeline=${pipeline}`,async t=>{
 const day=Date.parse('2027-01-15T05:00:00Z'),f=fixture(t,pipeline,day);
 const schedule=[{start:Date.parse('2026-12-31T21:00:00Z'),mode:'quests'}];
 for(const s of [f.store,f.serial]) {
   const next={...s.data,clanQuests:{...s.data.clanQuests,calendarSchedule:schedule}};
   s.save(next,day);
 }
 const b=f.batch(1);await f.store.applyArenaGroup([b]);f.serial.applyArenaProgress(b.id,b.progress,b.at);
 assert.deepEqual(comparable(f.store.data),comparable(f.serial.data));
 assert.equal(Object.values(f.store.data.clans).reduce((n,c)=>n+c.dailyQuests.board.quests.find(q=>q.metric==='food').progress,0),120);
 assert.deepEqual(recover(f.store.filePath).data.clans,f.store.data.clans);
});
for(const pipeline of [false,true])test(`clan-partitioned progress preserves shared boards, rewards and WAL, pipeline=${pipeline}`,async t=>{
 const f=fixture(t,pipeline);
 for(let n=1;n<=8;n++){
   const b=f.batch(n),base=f.store.data,before=structuredClone(base);
   const result=await f.store.applyArenaGroup([b]);assert.equal(result.length,1);
   f.serial.applyArenaProgress(b.id,b.progress,b.at);
   assert.deepEqual(base,before);assert.deepEqual(comparable(f.store.data),comparable(f.serial.data));
 }
 assert.equal(f.pool.stats.failures,0);if(pipeline)assert.equal(f.pool.stats.shards.failures,0);
 assert.equal(Object.values(f.store.data.clans).reduce((n,c)=>n+Object.keys(c.dailyQuests.board.contributors).length,0),12);
 assert.deepEqual(await f.store.applyArenaGroup([f.batch(8)]),[[]]);
 assert.deepEqual(recover(f.store.filePath).data.profiles,f.store.data.profiles);
});
test('clan shard crash falls back without partial clan contributions',async t=>{
 const f=fixture(t),b=f.batch(1),pending=f.store.applyArenaGroup([b]);
 await f.pool.lanes.find(Boolean).worker.terminate();await pending;
 f.serial.applyArenaProgress(b.id,b.progress,b.at);
 assert.equal(f.pool.stats.failures,1);assert.deepEqual(comparable(f.store.data),comparable(f.serial.data));
});
test('clan sharded fsync failure publishes no profile or board and retry remains exact',async t=>{
 const f=fixture(t),b=f.batch(1),base=f.store.data;
 const fault=t.mock.method(fs,'fsync',(fd,done)=>setImmediate(()=>done(Error('injected flush failure'))));
 await assert.rejects(f.store.applyArenaGroup([b]),/injected flush failure/);fault.mock.restore();
 assert.equal(f.store.data,base);assert.deepEqual(recover(f.store.filePath).data.profiles,base.profiles);
 await f.store.applyArenaGroup([b]);f.serial.applyArenaProgress(b.id,b.progress,b.at);
 assert.deepEqual(comparable(f.store.data),comparable(f.serial.data));
});
test('concurrent clan membership and wallet change invalidates all shard output',async t=>{
 const f=fixture(t),b=f.batch(1),pending=f.store.applyArenaGroup([b]);
 for(const s of [f.store,f.serial])s.transact(f.users[0].token,'concurrent-clan-wallet-1','fixture',p=>{p.wallet.coins+=17;});
 assert.equal(await pending,null);assert.equal(f.pool.stats.conflicts,1);
 await f.store.applyArenaGroup([b]);f.serial.applyArenaProgress(b.id,b.progress,b.at);
 assert.deepEqual(comparable(f.store.data),comparable(f.serial.data));
});
