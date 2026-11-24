'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [baselineFile,output]=process.argv.slice(2);assert(baselineFile&&output&&global.gc,'Use --expose-gc, baseline module and new output file');
const baseline=require(path.resolve(baselineFile)).validateWorld,candidate=require('../../src/server/clans/clan-service').validateWorld;
function world(count){return{version:13,clans:{},profiles:Object.fromEntries(Array.from({length:count},(_,i)=>['key'+i,{id:'p'+i,name:'Player '+i,skinId:'moon-dragon',level:1,greatness:0,quickSlots:[],clanId:null}]))};}
function outcome(fn,value){try{fn(value);return null;}catch(e){return e.message;}}
let comparisons=0;
for(const mutate of [()=>{},w=>w.profiles.key1.id=w.profiles.key0.id,w=>w.profiles.key1.level=0,w=>w.profiles.key1.skinId='unknown',w=>w.profiles.key1.clanId='missing',w=>w.profiles.key1.quickSlots=['meat','meat'],w=>w.clans=null,w=>w.profiles.key1.name='']){
 const data=world(20);mutate(data);const expected=outcome(baseline,data),before=structuredClone(data);assert.equal(outcome(candidate,data),expected);assert.deepEqual(data,before);comparisons++;
}
const rows=[];
for(const count of [1280,10000,100000]){
 const data=world(count),repeats=count===100000?10:40;
 for(const mode of ['baseline','candidate','candidate','baseline']){
  const validate=mode==='baseline'?baseline:candidate;for(let i=0;i<3;i++)validate(data);global.gc();
  const cpu=process.cpuUsage(),start=performance.now();for(let i=0;i<repeats;i++)validate(data);
  const elapsedMs=performance.now()-start,used=process.cpuUsage(cpu);
  rows.push({count,repeats,mode,elapsedMs,cpuMs:(used.user+used.system)/1000,heapMiB:process.memoryUsage().heapUsed/1048576});
 }
}
const report={at:new Date().toISOString(),node:process.version,platform:process.platform,comparisons,rows,scope:'Full clan validator on synthetic profiles without clans; allocation-only component measurement, not game capacity or full-world copy elimination'};
fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
