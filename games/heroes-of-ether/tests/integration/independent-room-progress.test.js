"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {IndependentProgress}=require('../../scripts/benchmarks/resident-room-processes/independent-progress.cjs');
const {EventManager}=require('../../src/server/events/event-manager');
const at=Date.parse('2026-11-11T20:59:58Z');
function comparable(data){const copy=structuredClone(data);
  for(const p of Object.values(copy.profiles))for(const [i,x]of p.transactions.entries.entries())x.id='receipt-'+i;
  return copy;}
function fixture(t,options){
  const store=new ProfileStore({now:()=>at,incrementalSettlement:true}),serial=new ProfileStore({now:()=>at,incrementalSettlement:true});
  const pool=new IndependentProgress(3,options),users=[];
  t.after(async()=>{await pool.close();await store.close();await serial.close();});
  for(let i=0;i<6;i++){const a=store.open();users.push(a);store.startLife(a.profile.id,'life-'+i);}
  // Avoid randomized quest completion rewards in the equivalence oracle.
  for(const p of Object.values(store.data.profiles))p.quests.items.forEach((x,i)=>x.questId=['harvest','great_feast','hunter','feast'][i]);
  store.events=new EventManager({now:()=>at});serial.events=new EventManager({now:()=>at});
  serial.events.data=structuredClone(store.events.data);serial.data=structuredClone(store.data);
  const batches=round=>Array.from({length:3},(_,r)=>({id:`room:r${r}:epoch:${round}`,at:at+round*1000+r,
    progress:users.slice(r*2,r*2+2).flatMap((a,j)=>[
      {type:'massPeak',profileId:a.profile.id,mass:100+round},
      {type:'lifeTime',profileId:a.profile.id,lifeId:'life-'+(r*2+j),durationSeconds:round},
      {type:'absorbed',profileId:a.profile.id,victimProfileId:'victim-'+round,lifeId:'victim-life-'+round,
        victimPartId:'part-'+round,victimDefeated:true,gain:50}])}));
  return{store,serial,pool,users,batches};
}
function expected(serial,bs){let snapshot=serial.data;
  for(const b of bs){const d=serial.arenaProgressDraft(snapshot,b.id,b.progress,b.at);
    snapshot=serial.prepareSnapshot(d?.next||snapshot,b.at,undefined,snapshot);}
  serial.data=snapshot;return snapshot;}
test('independent room calculations preserve FIFO results through midnight and repeated ticks',async t=>{
  const f=fixture(t);
  for(let round=1;round<=8;round++){
    const bs=f.batches(round);
    while(bs.length){
      const before=structuredClone(f.store.data),original=f.store.data;
      const result=await f.pool.prepare(f.store,bs);
      assert.ok(result.changes.length>0);assert.deepEqual(original,before);
      const done=bs.splice(0,result.changes.length);
      assert.deepEqual(comparable(result.snapshot),comparable(expected(f.serial,done)));
      f.store.data=result.snapshot;
    }
  }
  assert.equal(f.pool.stats.failures,0);
});
test('an earlier global settlement and concurrent lobby write cannot be overwritten by later room calculations',async t=>{
  const f=fixture(t),bs=f.batches(1),secondKey=Object.keys(f.store.data.profiles)[2];
  for(const store of [f.store,f.serial]){
    const prepare=store.prepareSnapshot.bind(store);
    store.prepareSnapshot=(next,when,ctx,prev)=>{
      if(when===bs[0].at){const p=next.profiles[secondKey];next={...next,profiles:{...next.profiles,
        [secondKey]:{...p,wallet:{...p.wallet,coins:p.wallet.coins+37}}}};}
      return prepare(next,when,ctx,prev);
    };
  }
  const pending=f.pool.prepare(f.store,bs);
  f.store.transact(f.users[0].token,'independent-lobby-transaction','purchase',p=>{p.wallet.coins-=10;});
  f.serial.data=structuredClone(f.store.data);
  const result=await pending;
  assert.deepEqual(comparable(result.snapshot),comparable(expected(f.serial,bs)));
  assert.equal(f.pool.stats.recomputed,2);
});
test('overlapping profiles stop the speculative prefix and changed event configuration discards it',async t=>{
  const f=fixture(t),bs=f.batches(1);bs[1].progress[0].profileId=bs[0].progress[0].profileId;
  const first=await f.pool.prepare(f.store,bs);assert.equal(first.changes.length,1);
  const pending=f.pool.prepare(f.store,f.batches(2));f.store.events.data=structuredClone(f.store.events.data);
  assert.equal(await pending,null);assert.equal(f.pool.stats.conflicts,1);
});

test('pipelined repeated room batches preserve intermediate rewards and concurrent writes',async t=>{
  const f=fixture(t);
  const bs=[1,2,3,4].flatMap(round=>f.batches(round).map((b,i)=>({...b,at:at+100+round*20+i})));
  const pending=f.pool.prepare(f.store,bs);
  f.store.transact(f.users[0].token,'series-lobby-purchase','purchase',p=>{p.wallet.coins-=10;});
  f.serial.data=structuredClone(f.store.data);
  const result=await pending;
  assert.equal(result.changes.length,12);
  assert.deepEqual(comparable(result.snapshot),comparable(expected(f.serial,bs)));
  assert.ok(f.pool.stats.recomputed>=4);
  assert.equal(f.pool.stats.failures,0);
  f.store.data=result.snapshot;
  const more=f.batches(5).map((b,i)=>({...b,at:at+400+i}));
  const next=await f.pool.prepare(f.store,more);
  assert.deepEqual(comparable(next.snapshot),comparable(expected(f.serial,more)));
});

test('daily projection updates do not invalidate independent arena calculations or double-count totals',async t=>{
  const f=fixture(t);
  // Warm personal captures so only the daily derived row changes centrally.
  const warm=f.batches(1).map((b,i)=>({...b,at:at+10+i}));
  let result=await f.pool.prepare(f.store,warm);
  assert.deepEqual(comparable(result.snapshot),comparable(expected(f.serial,warm)));
  f.store.data=result.snapshot;
  const bs=[2,3,4,5].flatMap(round=>f.batches(round).map((b,i)=>({...b,at:at+100+round*20+i})));
  const before=f.pool.stats.recomputed;
  result=await f.pool.prepare(f.store,bs);
  assert.equal(result.changes.length,12);
  assert.deepEqual(comparable(result.snapshot),comparable(expected(f.serial,bs)));
  assert.equal(f.pool.stats.recomputed,before);
  assert.ok(f.pool.stats.mergedDaily>0);
  assert.equal(f.pool.stats.failures,0);
});

for(const maxBatchSize of [16,64,128])test(`bounded ${maxBatchSize}-step preparation preserves each FIFO settlement`,async t=>{
  const f=fixture(t,{maxBatchSize});
  // Long batches would finish the 30-kill quest and independently roll random
  // chest contents in each oracle. Use partial absorptions here; reward and
  // calendar conflicts are exercised by the dedicated tests above.
  const bs=Array.from({length:Math.ceil(maxBatchSize/3)+3},(_,i)=>i+1).flatMap(round=>f.batches(round).map((b,i)=>({...b,at:at+100+round*10+i,
    progress:b.progress.map(e=>e.type==='absorbed'?{...e,victimDefeated:false,gain:1}:e)})));
  while(bs.length){
    const previous=structuredClone(f.store.data),original=f.store.data;
    const result=await f.pool.prepare(f.store,bs);
    assert.equal(result.changes.length,Math.min(maxBatchSize,bs.length));
    assert.deepEqual(original,previous);
    const done=bs.splice(0,result.changes.length);
    assert.deepEqual(comparable(result.snapshot),comparable(expected(f.serial,done)));
    f.store.data=result.snapshot;
  }
  assert.equal(f.pool.stats.failures,0);
});
