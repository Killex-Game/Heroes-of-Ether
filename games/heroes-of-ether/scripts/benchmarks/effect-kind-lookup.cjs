'use strict';
const {performance}=require('perf_hooks'),{createHash}=require('crypto');
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation'),{BOOSTERS}=require('../../src/server/boosters/booster-catalog');
const baseline=process.argv.includes('--baseline'),empty=process.argv.includes('--empty');
if(baseline)Arena.prototype.hasEffect=function(p,kind,now){for(const id in p.effects)if(p.effects[id]>now&&BOOSTERS.get(id)?.kind===kind)return true;return false;};
let seed=723;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const arena=new Arena({etherCount:400,random,backgroundRandom:()=>0});
for(let i=0;i<60;i++){
 const p=arena.addPlayer(0,'p'+i);p.lifeId='life'+i;p.spawnSerial=i+1;p.mass=500+i*50;p.radius=radiusForMass(p.mass);p.level=30;p.name='p'+i;p.x=300+i%10*450;p.y=300+Math.floor(i/10)*450;
 if(i%3&&!empty){for(const id of BOOSTERS.keys())p.effects[id]=10000;for(const id of BOOSTERS.keys())if(!['freeze','speed','golden_shield','web','stone','clan_shield'].includes(id))delete p.effects[id];}
 if(i%2)p.parts=Array.from({length:4},(_,j)=>({id:'p'+i+'-'+j,mass:p.mass/4,radius:radiusForMass(p.mass/4),x:p.x+j*20,y:p.y+j*20,mergeVersion:0,mergeAt:20000,splitStartedAt:0}));
}
const digest=createHash('sha256');
for(let i=0;i<240;i++)digest.update(JSON.stringify(arena.snapshot(8000+i*25,[],i%20===0)));
const framesHash=digest.digest('hex');
for(let i=0;i<12000;i++)arena.snapshot(9000+i%100*25,[],i%20===0);
const samples=[];let frames=0;
for(let repeat=0;repeat<5;repeat++){const start=performance.now();for(let i=0;i<5000;i++){arena.snapshot(9000+i%100*25,[],i%20===0);frames++;}samples.push(performance.now()-start);}
console.log(JSON.stringify({baseline,fixture:'60 entities, 400 food, split parts, '+(empty?'empty effects':'mixed/churned effects and expiration'),frames,framesHash,samplesMs:samples,medianMs:[...samples].sort((a,b)=>a-b)[2]}));
