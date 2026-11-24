'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyze}=require('../../scripts/benchmarks/wire-sample-cost.cjs');
test('wire audit counts UTF-8 and separates nested attribution without double counting',()=>{
  const packet={type:'state',playersDelta:{removed:[],upsert:[{id:'я',name:'Игрок 🐉',parts:'AA=='}]},
    foodDelta:{removed:[],upsert:[['e1',1,2,{value:5}]],moves:'AA=='}};
  const r=analyze([packet]),size=value=>Buffer.byteLength(JSON.stringify(value));
  assert.equal(r.packetBytes,size(packet));
  assert.equal(r.valueBytes,Object.values(packet).reduce((sum,value)=>sum+size(value),0));
  assert.equal(r.valueBytes+r.keyAndSyntaxBytes,r.packetBytes);
  assert.equal(r.playerFields.name,size('Игрок 🐉'));
  assert.equal(r.fields.playersDelta,size(packet.playersDelta));
  assert.equal(r.playerUpdates,1);assert.equal(r.foodMetadataRows,1);
  assert(size(packet)>JSON.stringify(packet).length);
});
test('wire audit rejects unrelated messages and handles an empty sample',()=>{
  assert.throws(()=>analyze([{type:'boosterResult'}]));
  assert.equal(analyze([]).packetBytes,0);
});
