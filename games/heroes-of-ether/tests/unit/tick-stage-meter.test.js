'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMeter}=require('../../scripts/benchmarks/tick-stage-meter.cjs');
test('diagnostic stages separate nested wall time and preserve return/throw behavior',()=>{
  let now=0;const meter=createMeter(()=>now);
  const object={value:7,inner(){now+=3;return this.value;},outer(){now+=2;const r=this.inner();now+=5;return r;},failure(){now+=4;throw Error('expected');}};
  meter.wrap(object,'inner','inner');meter.wrap(object,'outer','outer');meter.wrap(object,'failure','failure');
  assert.equal(object.outer(),7);assert.throws(()=>object.failure(),/expected/);
  assert.deepEqual(meter.snapshot(),{inner:{calls:1,inclusiveMs:3,exclusiveMs:3,maxMs:3},outer:{calls:1,inclusiveMs:10,exclusiveMs:7,maxMs:10},failure:{calls:1,inclusiveMs:4,exclusiveMs:4,maxMs:4}});
  const prior=meter.snapshot();meter.reset();assert.deepEqual(meter.snapshot(),{});assert.equal(prior.outer.inclusiveMs,10);
});
