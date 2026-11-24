"use strict";
// Identical queries with/without the candidate broad phase. No server, data,
// networking or economy; report this as a combat microbenchmark only.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation');
function scene(){
 const a=new Arena({etherCount:0,random:()=>.5,world:{width:10000,height:10000}});
 for(let i=0;i<30;i++){const p=a.addPlayer(0,'p'+i);p.protectedUntil=0;p.parts=Array.from({length:16},(_,j)=>({id:'p'+i+':'+j,mass:400,radius:radiusForMass(400),x:200+(i%6)*1300+(j%4)*60,y:200+Math.floor(i/6)*1300+Math.floor(j/4)*60,vx:0,vy:0}));a.syncParts(p);}
 return a;
}
let seed=27812;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const queries=Array.from({length:500},()=>{const x=random()*8000,y=random()*7000;return[x,y,x+random()*20,y+random()*20];});
function run(indexed,ticks=600){const arena=scene(),combat=arena.combat,shot={boosterId:'freeze',ownerId:'p0',landed:true};let hits=0,checksum=0;const start=performance.now();
 for(let tick=0;tick<ticks;tick++){combat.hitBounds=new Map();combat.hitCandidates=null;combat.indexHits=indexed;
  for(const q of queries){const result=combat.hit(shot,...q,6000);if(result){hits++;checksum+=Number(result.player.id.slice(1))+result.t;}}
 }
 return{indexed,ticks,queries:ticks*queries.length,ms:performance.now()-start,hits,checksum};
}
run(false,25);run(true,25);const results=[false,true,true,false].map(flag=>run(flag));
for(const row of results){assert.equal(row.hits,results[0].hits);assert.equal(row.checksum,results[0].checksum);}
console.log(JSON.stringify({exact:true,scope:'combat query microbenchmark only',results}));
