"use strict";
// Same seeded physics and controls on both implementations. Offline only:
// this does not measure persistence, WebSockets, rendering or total capacity.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'../..');let uuidSerial=0;
const originalUuid=crypto.randomUUID;
crypto.randomUUID=()=>`00000000-0000-4000-8000-${(++uuidSerial).toString(16).padStart(12,'0')}`;
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation');
const checkpoint=require('./experimental-step-workers/step-state');
const {BOOSTERS,BoosterError}=require('../../src/server/boosters/booster-catalog');
const file=root+'/src/server/arena/projectile-combat.js';
const baselineSource=process.env.BASELINE_COMBAT_SOURCE ? fs.readFileSync(process.env.BASELINE_COMBAT_SOURCE,'utf8') : cp.execFileSync('git',['show','17d64554cabb143a581ed7a8fdc21128e9aa73b4:games/heroes-of-ether/src/server/arena/projectile-combat.js'],{cwd:root,encoding:'utf8'});
const baselineModule=new Module(file,module);baselineModule.filename=file;baselineModule.paths=Module._nodeModulePaths(path.dirname(file));baselineModule._compile(baselineSource,file);
const BaselineCombat=baselineModule.exports.Combat;
function random(seed){return()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);}
function scene(){const arena=new Arena({etherCount:0,random:random(42),world:{width:6000,height:5000}});
 for(let i=0;i<30;i++){const p=arena.addPlayer(0,'p'+i);Object.assign(p,{level:600,protectedUntil:0,stopped:true});p.parts=Array.from({length:8},(_,j)=>({id:p.id+':'+j,mass:400,radius:radiusForMass(400),x:500+i%6*750+j%4*50,y:500+Math.floor(i/6)*750+Math.floor(j/4)*50,vx:0,vy:0}));arena.syncParts(p);}
 return arena;}
const ids=['hook','cake','candy','vortex','glove','clan_shield','sphere','donut','freeze','mine','harpoon','knuckles','mega_poison','easter_egg','colorful_shield','ice_cream','warheads','web','poison','rocket','speed','lock','fire_sword','axe','meat','golden_shield','sponge','fire','awl','stone'];
assert(ids.every(id=>BOOSTERS.has(id)));
const initial=structuredClone(checkpoint.capture(scene())),initialSerial=uuidSerial;
function run(indexed,ticks){uuidSerial=initialSerial;const arena=checkpoint.restore(structuredClone(initial),random(74));if(!indexed)Object.setPrototypeOf(arena.combat,BaselineCombat.prototype);
 let stepMs=0,casts=0,rejected=0;const at=performance.now();
 for(let t=0;t<ticks;t++){const now=5000+t*50;
  if(t%10===0)for(const [i,p]of [...arena.players.values()].entries()){if(p.dead)continue;const target=arena.players.get('p'+((i+1)%30)),body=arena.mainBody(target||p),boosterId=ids[(i+Math.floor(t/10))%ids.length];try{const apply=arena.prepareBooster(p.id,{boosterId,spawnSerial:p.spawnSerial,aimX:body.x,aimY:body.y},now);if(apply){apply();casts++;}}catch(e){if(!(e instanceof BoosterError))throw e;rejected++;}}
  const before=performance.now();arena.combat.update(now);stepMs+=performance.now()-before;
 }
 const final=checkpoint.capture(arena);return {indexed,ticks,casts,rejected,combatMs:stepMs,totalMs:performance.now()-at,uuidSerial,final};}
try{
 const ticks=Number(process.argv[2]||600);assert(Number.isInteger(ticks)&&ticks>0&&ticks<=5000);
 for(const flag of [false,true,true,false])run(flag,ticks);
 const results=[],first=run(false,ticks);results.push(first);
 for(const flag of [true,true,false,true,false,false,true]){const next=run(flag,ticks);assert(require('node:util').isDeepStrictEqual(next.final,first.final),'Identical controls must produce identical physics');assert.equal(next.uuidSerial,first.uuidSerial);assert.equal(next.casts,first.casts);assert.equal(next.rejected,first.rejected);results.push(next);}
 console.log(JSON.stringify({scope:'Offline deterministic combat replay; final states and UUID consumption equal; no CCU claim',baselineSha256:crypto.createHash('sha256').update(baselineSource).digest('hex'),candidateSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),exact:true,results:results.map(({final,...r})=>r)}));
}finally{crypto.randomUUID=originalUuid;}
