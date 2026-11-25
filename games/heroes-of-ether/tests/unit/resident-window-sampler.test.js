'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RoomWindowSampler,PeerWindowSampler,assessWindow}=require('../../scripts/benchmarks/resident-room-processes/window-sampler.cjs');
test('room windows use disjoint samples and actual accepted input deltas',()=>{
 const r={id:'r',metrics:{ticks:5,boosters:{candy:2}},times:[2],intervals:[50],socketInputs:{metrics:{accepted:{feed:4,split:1}}},casts:{ackLatencies:[10],applyLatencies:[12]},outbox:[]};
 const s=new RoomWindowSampler();assert.equal(s.sample(r,1000),null);
 r.metrics.ticks+=20;r.metrics.boosters.candy+=3;r.times.push(3,7);r.intervals.push(51,55);r.socketInputs.metrics.accepted.feed+=8;r.socketInputs.metrics.accepted.split+=2;r.casts.ackLatencies.push(30);r.casts.applyLatencies.push(35);
 const first=s.sample(r,2000);assert.equal(first.updatesHz,20);assert.equal(first.workMs.n,2);assert.equal(first.workMs.max,7);assert.deepEqual(first.accepted,{feed:8,split:2});assert.equal(first.boosters.candy,3);assert.equal(first.actionMs.max,30);
 assert.throws(()=>s.sample(r,1900),/clock/);r.metrics.ticks+=20;r.times.push(1);r.intervals.push(50);
 const second=s.sample(r,3000);assert.equal(second.updatesHz,20);assert.equal(second.workMs.max,1);assert.equal(second.actionMs.n,0);assert.deepEqual(second.accepted,{feed:0,split:0});
});
test('action replies cannot mask a state gap and a silent client is reported',()=>{
 const s=new PeerWindowSampler();s.register('a');s.register('b');const inputs={latencies:[],successLatencies:[]};s.begin(0,inputs,0);
 s.observe('a',{type:'state',stateSequence:1},50);s.observe('b',{type:'state',stateSequence:1},60);
 for(let at=100;at<1000;at+=20)s.observe('a',{type:'boosterResult',stateSequence:99},at);
 s.observe('a',{type:'state',stateSequence:2},1000);inputs.latencies.push(12);inputs.successLatencies.push(12);
 const w=s.sample(1100,inputs,0);assert.equal(w.states,3);assert.equal(w.gapMs.max,950);assert.equal(w.maxSilenceMs,1040);assert.equal(w.actionMs.n,1);
 s.observe('a',{type:'state',stateSequence:3},1150);const next=s.sample(1200,inputs,1);assert.equal(next.states,1);assert.equal(next.gapMs.max,150);assert.equal(next.actionMs.n,0);assert.equal(next.failures,1);
});
test('window assessment requires delivered states, accepted W/split and real booster effects',()=>{
 const good={rooms:[{id:'r',updatesHz:20,intervalMs:{p95:50},accepted:{feed:2,split:1},boosters:{candy:1}}],peers:[{states:100,gapMs:{p99:70},actionMs:{p95:50},maxSilenceMs:50,failures:0}],lobby:{latencyMs:{p95:50},errors:{}},errors:0};
 assert.equal(assessWindow(good).meetsTargets,true);const bad=structuredClone(good);bad.rooms[0].accepted={};bad.peers[0].maxSilenceMs=900;
 assert.deepEqual(assessWindow(bad).problems,['r:accepted-inputs','peer0:state-gap']);assert.equal(assessWindow({...good,rooms:[]}).meetsTargets,false);
});
