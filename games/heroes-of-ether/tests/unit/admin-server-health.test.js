"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{assess,timings}=require("../../public/ui/admin/server-health");
const sample=()=>({ticks:1200,windowMs:60000,targetTickMs:50,updatesHz:20,tickWorkMs:{p95:10},tickIntervalMs:{p95:50},eventLoop:{samples:100,p95Ms:20},persistence:{arenaBatches:0,queuedActions:0,paused:false,pendingWalBytes:10,maxWalBytes:1000},memoryMiB:{resident:1000,limit:4096}});
test("health colors use tick budget, distinguish missing data, and restore after recovery",()=>{
 const v=sample();assert.deepEqual(assess(v).slice(1).map(s=>s.level),Array(7).fill("normal"));
 v.updatesHz=18;v.tickWorkMs.p95=20;v.tickIntervalMs.p95=75;v.eventLoop.p95Ms=50;v.persistence.queuedActions=20;v.memoryMiB.resident=3072;v.persistence.pendingWalBytes=500;
 assert.ok(assess(v).slice(1).every(s=>s.level==="warning"));
 v.updatesHz=14;v.tickWorkMs.p95=50;v.tickIntervalMs.p95=100;v.eventLoop.p95Ms=100;v.persistence.paused=true;v.memoryMiB.resident=4000;v.persistence.pendingWalBytes=800;
 assert.ok(assess(v).slice(1).every(s=>s.level==="critical"));
 v.ticks=0;v.eventLoop=null;v.memoryMiB.limit=null;v.persistence.maxWalBytes=null;assert.equal(assess(v)[1].level,"unknown");assert.equal(assess(v)[4].level,"unknown");assert.equal(assess(v)[6].level,"unknown");assert.equal(assess(v)[7].level,"unknown");
 assert.ok(assess(sample()).slice(1).every(s=>s.level==="normal"));
});
test("timing context separates base intervals without changing health thresholds",()=>{
 const v=sample();v.tickIntervalMs.p95=51.27;v.eventLoop={samples:100,resolutionMs:20,p95Ms:21.2};
 const t=timings(v);assert.equal(t.target,50);assert.equal(t.resolution,20);assert(Math.abs(t.intervalExcess-1.27)<1e-9);assert(Math.abs(t.loopExcess-1.2)<1e-9);
 v.tickIntervalMs.p95=49;v.eventLoop.p95Ms=19;assert.equal(timings(v).intervalExcess,0);assert.equal(timings(v).loopExcess,0);
 v.eventLoop.p95Ms=50;assert.equal(assess(v)[4].level,'warning');assert.equal(timings(v).loopExcess,30);
 v.eventLoop.samples=0;assert.equal(timings(v).loopExcess,null);delete v.targetTickMs;assert.equal(timings(v).intervalExcess,null);
 assert.deepEqual(timings({}),{target:null,resolution:null,intervalExcess:null,loopExcess:null});
});
