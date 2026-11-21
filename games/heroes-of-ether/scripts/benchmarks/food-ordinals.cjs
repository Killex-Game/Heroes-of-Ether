'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const file=require.resolve('../../src/server/arena/arena-simulation');
const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
mod._compile(fs.readFileSync(process.env.BASELINE_ARENA,'utf8'),file);
const before=mod.exports.Arena.prototype.collectEther;
const {scene}=require('../../tests/helpers/hazard-replenishment-reference');
const after=require(file).Arena.prototype.collectEther;
for(const dense of [false,true]){
 const totals=[0,0],samples=[[],[]];
 for(let seed=1;seed<=70;seed++){
  const original=scene(seed,35,dense).arena;let state=seed;
  const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  for(const p of original.players.values()){p.protectedUntil=0;original.syncParts(p);}
  const food=Array.from({length:6000},(_,i)=>({id:`e${i}`,x:random()*original.world.width,y:random()*original.world.height,radius:5.5,value:i%17?2:100,...(i%3?{ejected:true,sourceId:`p${i%35}`,sourcePickupAt:1000}:{})}));
  let expected;
  for(let j=0;j<2;j++){
   const k=(j+seed)%2,a=scene(seed,35,dense).arena;a.players=structuredClone(original.players);a.ether=structuredClone(food);
   const at=performance.now();[before,after][k].call(a,2000);const ms=performance.now()-at;
   if(seed>10){totals[k]+=ms;samples[k].push(ms);}
   const result={players:a.players,food:a.ether};if(expected)assert.deepEqual(result,expected);else expected=result;
  }
 }
 console.log(JSON.stringify({dense,exact:true,variants:totals.map((ms,i)=>({name:i?'after':'before',ms,p95:samples[i].sort((a,b)=>a-b)[57]}))}));
}