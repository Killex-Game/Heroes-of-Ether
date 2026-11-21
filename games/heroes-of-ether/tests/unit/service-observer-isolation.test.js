"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {temporary}=require('../temp'),{ServiceObserver}=require('../../src/server/runtime/service-observer');
const eventually=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}assert.ok(predicate());};
test('monitor source and metrics callback errors remain local; confirmed storage faults are preserved',async t=>{
  let broken=false,metricsBroken=false,latest,at=100;
  const observer=new ServiceObserver({directory:path.join(temporary(t,'monitor-isolation'),'monitoring'),now:()=>at,intervalMs:60000,
    source:()=>{if(broken)throw Error('source');return {faults:['LOCAL_JOURNAL_FAILED']};},onFailure:f=>latest=f,
    onMetrics:()=>{if(metricsBroken)throw Error('optional instrumentation');}});
  t.after(()=>observer.close());await eventually(()=>observer.value.at!==null);
  assert.deepEqual(latest,['LOCAL_JOURNAL_FAILED']);
  broken=true;assert.doesNotThrow(()=>observer.sample());assert.equal(observer.snapshot().logError,'MONITOR_SOURCE_UNAVAILABLE');assert.deepEqual(latest,['LOCAL_JOURNAL_FAILED']);
  broken=false;metricsBroken=true;assert.doesNotThrow(()=>observer.requestMetrics());await eventually(()=>!observer.sampling);
  assert.deepEqual(latest,['LOCAL_JOURNAL_FAILED']);
  metricsBroken=false;at+=20000;observer.sample();await eventually(()=>observer.value.at===at);
  assert.equal(observer.snapshot().logError,null);
});
test('terminated observer rejects graph journal work but keeps cheap fault detection and clean game shutdown',async t=>{
  let faults=[],latest;const observer=new ServiceObserver({directory:path.join(temporary(t,'monitor-dead-worker'),'monitoring'),intervalMs:60000,source:()=>({faults}),onFailure:f=>latest=f});
  t.after(()=>observer.close());await eventually(()=>observer.value.at!==null);
  await observer.worker.terminate();await eventually(()=>observer.workerUnavailable);
  faults=['ARENA_SAVE_FAILED'];assert.doesNotThrow(()=>observer.sample());assert.deepEqual(latest,faults);
  await assert.rejects(observer.journal('runtime'),/MONITOR_WORKER_FAILED/);
  faults=[];observer.sample();assert.deepEqual(latest,[]);
  await observer.close();assert.equal(observer.pending.size,0);
});
test('non-serializable diagnostic data and telemetry IPC failure cannot interrupt game processing',async t=>{
  const observer=new ServiceObserver({directory:path.join(temporary(t,'monitor-bad-payload'),'monitoring'),intervalMs:60000,source:()=>({faults:[],uncloneable(){}})});
  t.after(()=>observer.close());assert.equal(observer.snapshot().logError,'MONITOR_MESSAGE_FAILED');assert.equal(observer.sampling,false);
  observer.worker.postMessage=()=>{throw Error('transport unavailable');};
  assert.doesNotThrow(()=>observer.observe());await assert.rejects(observer.journal('runtime'),/MONITOR_MESSAGE_FAILED/);
  assert.equal(observer.pending.size,0);await observer.close();
});
