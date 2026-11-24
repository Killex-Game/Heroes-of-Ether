"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{record,combine}=require("../../scripts/benchmarks/state-gap-context.cjs");
const client=()=>({last:100,serial:1,roomId:"room-1",indexInRoom:0,requests:new Map(),ws:{bufferedAmount:0},gaps:[50],longGaps:[]});
test("long state gaps retain their original metric and distinguish a life boundary without filtering it",()=>{
 const c=client();record(c,200,1,2);assert.equal(c.longGaps.length,0);
 record(c,500,1,3);assert.equal(c.longGaps[0].gapMs,400);assert.equal(c.longGaps[0].spansLifeEnd,false);
 c.lastLifeEndAt=350;c.serial=2;c.requests.set("pending",{});record(c,700,1,4);
 assert.deepEqual(c.gaps,[50]);assert.equal(c.last,100);
 const row=c.longGaps[0];assert(row.spawnChanged&&row.spansLifeEnd);assert.equal(row.lifeEndAgoMs,350);assert.equal(row.pendingActions,1);
 c.lastLifeEndAt=50;record(c,800,2,5);assert.equal(c.longGaps[0].spansLifeEnd,false);
});
test("per-client and combined context are bounded and leave caller samples unchanged",()=>{
 const c=client();for(let i=0;i<100;i++)record(c,500+i,1,i);
 assert.equal(c.longGaps.length,8);assert.equal(c.longGaps[0].gapMs,499);
 const before=structuredClone(c.longGaps),result=combine(Array.from({length:30},()=>({longestStateGaps:c.longGaps})));
 assert.equal(result.length,32);assert.deepEqual(c.longGaps,before);
 c.last=null;record(c,1000,1,100);assert.deepEqual(c.longGaps,before);
});
