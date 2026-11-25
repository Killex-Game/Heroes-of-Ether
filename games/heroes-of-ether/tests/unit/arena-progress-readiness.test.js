'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ClanArenaProgressShards}=require('../../src/server/profiles/clan-arena-progress-shards');
test('calculator readiness loads each empty lane once without copying a profile or world',async t=>{
 const pool=new ClanArenaProgressShards({count:3});t.after(()=>pool.close());
 const first=pool.warm();assert.equal(pool.warm(),first);assert.equal(await first,true);
 assert.equal(pool.stats.jobs,0);assert.equal(pool.stats.contextTransfers,0);assert.equal(pool.stats.residentProfiles,0);assert.equal(pool.stats.residentClans,0);
 assert.equal(pool.stats.warmedLanes,3);assert(pool.stats.warmupMs>0);
 const workers=pool.lanes.map(lane=>lane.worker);
 assert.equal(await pool.warm(),true);assert.deepEqual(pool.lanes.map(lane=>lane.worker),workers);
 for(const lane of pool.lanes){assert.deepEqual(lane.base,{profiles:{},clans:{}});assert.equal(lane.pending,undefined);}
});
test('closing during startup releases readiness and prevents late activation',async()=>{
 const pool=new ClanArenaProgressShards({count:2}),ready=pool.warm();
 await pool.close();assert.equal(await ready,false);assert.equal(await pool.warm(),false);assert.equal(pool.stats.warmedLanes,0);
});
test('failed lane startup falls back without keeping unresolved readiness promises',async t=>{
 const pool=new ClanArenaProgressShards({count:2});t.after(()=>pool.close());
 const ready=pool.warm();pool.fail('injected-startup-failure');
 assert.equal(await ready,false);assert.equal(pool.stats.failures,1);assert.equal(pool.stats.warmedLanes,0);
 assert.equal(await pool.prepare({},[]),undefined);
});
test('warmup timeout is bounded and does not admit an unready lane',async t=>{
 const pool=new ClanArenaProgressShards({count:1,timeoutMs:100});t.after(()=>pool.close());
 const lane=pool.lane(0);
 // Keep the real resolver attached to the promise awaited by warm().
 lane.ready=new Promise(resolve=>{lane.resolveReady=resolve;});
 lane.worker.removeAllListeners('message');
 assert.equal(await pool.warm(),false);assert.equal(pool.stats.failureReason,'warmup-timeout');assert.equal(pool.stats.jobs,0);
});
