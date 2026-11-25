'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {progressBackend}=require('../../scripts/benchmarks/capacity-progress-backend.cjs');
const {assessCapacity}=require('../../scripts/benchmarks/capacity-assessment.cjs');
test('capacity keeps canonical progress by default and requires an explicit addressed clan calculation experiment',()=>{
  assert.deepEqual(progressBackend(),{name:'canonical',profileWorker:false,environment:{}});
  assert.deepEqual(progressBackend('clan-shards-3'),{name:'clan-shards-3',profileWorker:true,environment:{LOAD_PROFILE_CLAN_SHARDS:'3'}});
  for(const value of ['',null,{},'full-world','clan-shards-99'])assert.throws(()=>progressBackend(value),/Unsupported/);
});
test('capacity never accepts a failed or inactive requested progress replica as a successful experiment',()=>{
  for(const worker of [null,{jobs:0,failures:0},{jobs:10,failures:1}]){
    const report=assessCapacity([{phase:'combined',elapsed:60000,profileWorker:worker}],{profileWorker:true,mixedMinutes:1,phaseSeconds:60});
    assert(report.phases[0].issues.includes('profile-worker-not-active'));
  }
});
