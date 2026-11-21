"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {performance}=require('node:perf_hooks');
const current=require('../../src/server/profiles/immutable-table-delta');
const file=require.resolve('../../src/server/profiles/immutable-table-delta');
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(process.env.BASELINE_TABLE_DELTA,'utf8'),file);
const variants=[old.exports,current],history=[Object.fromEntries(Array.from({length:1280},(_,i)=>['p'+i,{id:'p'+i,n:0}]))];
for(let i=1;i<=400;i++){
 const parent=history[i-1],next={...parent},keys=[];
 for(let j=0;j<35;j++){const key='p'+(i*13+j)%1280;keys.push(key);next[key]={id:key,n:i};}
 for(const v of variants)v.remember(next,parent,keys);
 history.push(next);
}
const pairs=[];
for(let i=20;i<history.length;i++)for(const depth of [1,4,16])pairs.push([history[i-depth],history[i]]);
for(const [before,after] of pairs)assert.deepEqual(current.changedKeys(before,after),old.exports.changedKeys(before,after));
const results=[];
for(const repeats of [1,6])for(const k of [0,1,1,0]){
 const v=variants[k];let count=0;const at=performance.now();
 for(let round=0;round<8;round++)for(const [before,after] of pairs)
   for(let j=0;j<repeats;j++)count+=v.changedKeys(before,after).length;
 results.push({variant:k?'after':'before',repeats,calls:pairs.length*repeats*8,count,ms:performance.now()-at});
}
console.log(JSON.stringify({exact:true,results}));
