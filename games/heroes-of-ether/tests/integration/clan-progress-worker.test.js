'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {ClanService}=require('../../src/server/clans/clan-service');
const {ArenaProgressPreparer}=require('../../src/server/profiles/arena-progress-preparer');
const {ArenaProgressShards}=require('../../src/server/profiles/arena-progress-shards');
const {BatchedArenaProgressShards}=require('../../src/server/profiles/arena-progress-batched-shards');
const {IndependentProgress}=require('../../scripts/benchmarks/resident-room-processes/independent-progress.cjs');
const catalog=require('../../src/server/clans/daily-quests/catalog.json');
const start=Date.parse('2026-11-15T03:00:00Z'),end=start+15*3600000;
function comparable(world){const copy=structuredClone(world);
  for(const p of Object.values(copy.profiles))p.transactions.entries.forEach((r,i)=>{r.id='receipt-'+i;});
  return copy;}
function fixture(t){
  let now=start-86400000,ready=false;
  const store=new ProfileStore({now:()=>now,clanDailyQuests:true,incrementalSettlement:true});
  const serial=new ProfileStore({now:()=>now,clanDailyQuests:true,incrementalSettlement:true});
  t.after(async()=>{await store.close();await serial.close();});
  const api=new ClanService(store),a=store.open(),b=store.open();
  for(const who of [a,b]){const p=store.find(who.token);p.level=12;
    p.progress.xp=require('../../src/server/progression/experience-progression').xpForLevel(12);p.wallet.coins=10000;}
  const act=(who,action,extra)=>api.mutate(who.token,{action,requestId:randomUUID(),...extra});
  act(a,'create',{name:'Север',prefix:'С',emblem:'grove',privacy:'open',description:''});
  const id=store.find(a.token).clanId;act(b,'apply',{clanId:id});
  if(store.find(b.token).clanId!==id)act(a,'accept',{clanId:id,memberId:b.profile.id});
  now=start;store.refreshCompetition();
  const data=structuredClone(store.data);
  data.clans[id].dailyQuests.board.quests=[{...catalog.items.find(q=>q.metric==='xp'),
    target:1,reward:{kind:'crystals',amount:500},progress:0,completedAt:null}];
  for(const p of Object.values(data.profiles))p.quests.items.forEach((row,i)=>{row.questId=['harvest','great_feast','hunter','feast'][i];});
  store.save(data,now);store.startLife(a.profile.id,'life');serial.data=structuredClone(store.data);
  store.clanQuestSettlementReady=serial.clanQuestSettlementReady=()=>ready;
  const batch=(key,at,event)=>({id:key,at,progress:[{profileId:a.profile.id,...event}]});
  return{store,serial,id,a,b,batch,ready:value=>{ready=value;},now:value=>{now=value;}};
}
for(const options of [{parallelism:0},{parallelism:3},{parallelism:3,batched:true}])
test(`full-world worker retains clan contribution and deadline barrier ${JSON.stringify(options)}`,async t=>{
  const f=fixture(t),worker=new ArenaProgressPreparer(options);t.after(()=>worker.close());
  const first=f.batch('earned',end-1,{type:'absorbed',victimProfileId:'other',lifeId:'other-life',gain:50,victimDefeated:true});
  let result=await worker.prepare(f.store,[first],8);
  f.serial.applyArenaProgress(first.id,first.progress,first.at);
  assert.deepEqual(comparable(result.snapshot),comparable(f.serial.data));f.store.data=result.snapshot;
  const board=f.store.data.clans[f.id].dailyQuests.board;
  assert.equal(board.quests[0].progress,1);assert(Object.hasOwn(board.contributors,f.a.profile.id));
  const before=f.store.find(f.a.token).wallet.crystals;
  const boundary=f.batch('boundary',end,{type:'massPeak',mass:1000});
  result=await worker.prepare(f.store,[boundary],8);
  f.serial.applyArenaProgress(boundary.id,boundary.progress,boundary.at);
  assert.deepEqual(comparable(result.snapshot),comparable(f.serial.data));f.store.data=result.snapshot;
  assert.equal(f.store.find(f.a.token).wallet.crystals,before);
  assert.equal(f.store.data.clans[f.id].dailyQuests.board.settledAt,undefined);
  f.ready(true);f.now(end);f.store.refreshCompetition();f.serial.refreshCompetition();
  assert.equal(f.store.find(f.a.token).wallet.crystals,before+500);
  assert.deepEqual(comparable(f.store.data),comparable(f.serial.data));
  assert.equal(worker.stats.failures,0);
});
test('settlement readiness changing during calculation invalidates the result even without a world write',async t=>{
  const f=fixture(t),worker=new ArenaProgressPreparer();t.after(()=>worker.close());
  const batch=f.batch('boundary',end,{type:'massPeak',mass:1000});
  const previous=f.store.data,pending=worker.prepare(f.store,[batch],8);f.ready(true);
  assert.equal(await pending,null);assert.equal(f.store.data,previous);assert.equal(worker.stats.conflicts,1);
  const retry=await worker.prepare(f.store,[batch],8);assert(retry);assert.equal(worker.stats.failures,0);
});
for(const Pool of [ArenaProgressShards,BatchedArenaProgressShards,IndependentProgress])
test(`${Pool.name} refuses partial clan inputs so canonical fallback retains progress`,async t=>{
  const f=fixture(t),pool=Pool===IndependentProgress?new Pool(2):new Pool({count:2});t.after(()=>pool.close());
  const batch=f.batch('earned',end-1,{type:'absorbed',victimProfileId:'other',lifeId:'other-life',gain:50,victimDefeated:true});
  assert.equal(await pool.prepare(f.store,[batch]),undefined);
  const result=f.store.prepareArenaBatches([batch]);
  assert.equal(result.snapshot.clans[f.id].dailyQuests.board.quests[0].progress,1);
  assert.equal(pool.failed,undefined);
});
