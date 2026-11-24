"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalKeys}=require('../../src/server/persistence/canonical-key-order');
const {canonical}=require('../../src/server/persistence/state-snapshot');
test('canonical key order matches persisted JSON across numeric boundaries and arbitrary Unicode keys',()=>{
  let seed=319301;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const fixed=['4294967295','4294967294','0','-0','01','1.0','1e0','10','2','-1','NaN','Infinity','9007199254740991','__proto__','constructor','é','é','😀','\ud800',''];
  for(let round=0;round<100;round++){
    const names=[...fixed,...Array.from({length:100},()=>next()%2?String(next()):'key'+next())];
    const value=Object.fromEntries(names.sort(()=>next()%3-1).map((key,i)=>[key,i]));
    Object.defineProperty(value,'hidden',{value:1});value[Symbol('ignored')]=2;
    const original=Reflect.ownKeys(value),actual=canonicalKeys(value),expected=Object.keys(canonical(value));
    assert.deepEqual(actual,expected);assert.deepEqual(Reflect.ownKeys(value),original);
    assert.equal(JSON.stringify(Object.fromEntries(actual.map(key=>[key,value[key]]))),JSON.stringify(canonical(value)));
  }
});
test('key ordering does not read values and covers empty, all-index and ordinary records',()=>{
  const value=Object.create(null);for(const key of ['10','2','z','a'])Object.defineProperty(value,key,{enumerable:true,get(){throw Error('value read');}});
  assert.deepEqual(canonicalKeys(value),['2','10','a','z']);
  assert.deepEqual(canonicalKeys({}),[]);assert.deepEqual(canonicalKeys({'10':0,'2':0}),['2','10']);
  assert.deepEqual(canonicalKeys({z:0,a:0}),['a','z']);
});
