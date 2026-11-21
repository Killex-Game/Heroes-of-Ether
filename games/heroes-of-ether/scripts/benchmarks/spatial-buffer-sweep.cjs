'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {scene}=require('../../tests/helpers/hazard-replenishment-reference');
const before=process.argv[2];
function load(file,source){const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(source,file);return m.exports;}
const indexFile=require.resolve('../../src/server/arena/spatial-collision-index');
const arenaFile=require.resolve('../../src/server/arena/arena-simulation');
const currentIndex=require(indexFile),current=require(arenaFile);
const oldIndex=load(indexFile,fs.readFileSync(path.join(before,'spatial-index-before67.cjs'),'utf8'));
const cached=require.cache[indexFile];require.cache[indexFile]={exports:oldIndex};
const old=load(arenaFile,fs.readFileSync(path.join(before,'arena-before67.cjs'),'utf8'));require.cache[indexFile]=cached;
function summary(a){a.sort((x,y)=>x-y);return {median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],total:a.reduce((s,x)=>s+x,0)};}
for(const dense of [false,true])for(const operation of ['collectEther','resolveAbsorptions']){
 const times=[[],[]];
 for(let seed=1;seed<=100;seed++){
  const initial=scene(seed,35,dense).arena;for(const p of initial.players.values()){p.protectedUntil=0;initial.syncParts(p);}
  let state=seed;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const food=Array.from({length:1224},(_,i)=>({id:'e'+i,x:random()*initial.world.width,y:random()*initial.world.height,radius:5.5,value:i%17?2:100,...(i%3?{ejected:true,sourceId:'p'+i%35,sourcePickupAt:1000}:{})}));
  let expected;
  for(let j=0;j<2;j++){
   const k=(j+seed)%2,Version=k?current:old;
   const a=new Version.Arena({etherCount:0,spatialIndex:true,world:initial.world});
   a.players=structuredClone(initial.players);a.ether=structuredClone(food);
   const t=performance.now();const events=a[operation](2000);const elapsed=performance.now()-t;
   if(seed>10)times[k].push(elapsed);
   const result={events,players:a.players,ether:a.ether};
   if(expected)assert.deepEqual(result,expected);else expected=result;
  }
 }
 console.log(JSON.stringify({dense,operation,exact:true,before:summary(times[0]),after:summary(times[1])}));
}
