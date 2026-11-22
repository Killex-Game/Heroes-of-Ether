"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {documentSize}=require('../../src/server/persistence/snapshot-size');
test('version-1 fragment sizing matches the preserved 2000-case independent reference',()=>{
let seed=19373;const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
const atoms=[null,true,false,0,-0,2147483647,2147483648,-2147483649,1.25,NaN,Infinity,'текст😀','é',undefined];
const keys=['z','a','10','2','__proto__','constructor','🧪','é','a.b'];
const tree=depth=>depth<=0?atoms[Math.floor(random()*atoms.length)]:random()<.3?Array.from({length:4},()=>tree(depth-1)):Object.fromEntries(keys.filter(()=>random()<.6).map(k=>[k,tree(depth-1)]));
const values=Array.from({length:2000},()=>({value:tree(3)}));
assert.equal(createHash('sha256').update(JSON.stringify(values.map(documentSize))).digest('hex'),'08a23745952b48a7fc9993b785acad5de726c0c7a679ad6104971adbb2e50555');
});
