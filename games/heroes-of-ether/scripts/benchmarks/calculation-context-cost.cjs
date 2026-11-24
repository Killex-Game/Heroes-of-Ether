'use strict';
const assert=require('node:assert/strict'),v8=require('node:v8');
const {randomUUID}=require('node:crypto'),{ProfileStore}=require('../../src/server/profiles/profile-store');
const {ClanArenaProgressShards}=require('../../src/server/profiles/clan-arena-progress-shards');
const {EventManager}=require('../../src/server/events/event-manager'),E=require('../../src/server/events/easter-hunt');
(async()=>{
 let at=Date.parse('2026-11-24T08:00:00Z');const events=new EventManager({now:()=>at});
 for(let n=0;n<64;n++){
  events.apply('fixture','start',{eventId:E.manifest.id,revision:events.data.revision,requestId:randomUUID()});at+=30000;
  events.apply('fixture','stop',{runId:events.active().id,revision:events.data.revision,requestId:randomUUID()});at+=30000;
 }
 events.apply('fixture','start',{eventId:E.manifest.id,revision:events.data.revision,requestId:randomUUID()});
 const seed=new ProfileStore({now:()=>at,clanDailyQuests:true,incrementalSettlement:true});seed.events=events;
 const users=Array.from({length:30},()=>seed.open());for(const [i,u]of users.entries())seed.startLife(u.profile.id,'context-life-'+i);
 const baseline=structuredClone(seed.data),results=[];let expected;
 for(const profile of Object.values(baseline.profiles))profile.quests.items.forEach((quest,index)=>{
  quest.questId=['harvest','great_feast','hunter','feast'][index];
 });
 for(const alwaysSend of [true,false,false,true]){
  const store=new ProfileStore({now:()=>at,clanDailyQuests:true,incrementalSettlement:true});store.events=events;store.data=baseline;
  const pool=new ClanArenaProgressShards({count:3}),submit=pool.submit.bind(pool),originalLane=pool.lane.bind(pool),seen=new WeakSet();
  let payloadBytes=0;
  pool.lane=index=>{const lane=originalLane(index);if(!seen.has(lane.worker)){
   seen.add(lane.worker);const post=lane.worker.postMessage.bind(lane.worker);
   lane.worker.postMessage=message=>{if(message.context&&!payloadBytes)payloadBytes=v8.serialize(message.context).byteLength;return post(message);};
  }return lane;};
  if(alwaysSend)pool.submit=(...args)=>{pool.lane(args[0]).context=undefined;return submit(...args);};
  let ms=0;
  for(let n=0;n<220;n++){
   const batch={id:'context-batch-'+n,at:at+n*50,progress:users.map(u=>({profileId:u.profile.id,type:'massPeak',mass:10000+n}))};
   const start=performance.now(),result=await pool.prepare(store,[batch]);assert(result?.snapshot);
   store.data=result.snapshot;if(n>=20)ms+=performance.now()-start;
  }
  if(expected)assert.deepEqual(store.data,expected);else expected=store.data;
  assert.equal(pool.stats.failures,0);assert.equal(pool.stats.conflicts,0);
  results.push({variant:alwaysSend?'repeat-context':'changed-context-only',ms,warmupBatches:20,measuredBatches:200,jobs:pool.stats.jobs,
   contextTransfers:pool.stats.contextTransfers,serializedContextBytes:payloadBytes*pool.stats.contextTransfers,contextBytes:payloadBytes});
  await pool.close();await store.close();
 }
 await seed.close();
 console.log(JSON.stringify({exact:true,scope:'Actual calculation worker threads with identical 30-profile batches and 64 archived events; old transfer policy is forced through the same code. Context byte counts exclude message envelopes and are not network traffic. No disk/PG/FPS/capacity claim.',results}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
