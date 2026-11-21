"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation');
for(const limit of [8,12,16]) for(const mode of ['space','knuckles']) test(`${mode}: room cap ${limit}, mass conserved`,()=>{
 const arena=new Arena({etherCount:0}),p=arena.addPlayer(0,'p');arena.maxParts=limit;
 Object.assign(p,{mass:40000,radius:radiusForMass(40000),x:2000,y:2000,targetX:2500,targetY:2000,protectedUntil:0,lastMoveAt:5000});
 if(mode==='knuckles')arena.boosterEffects.splitToLimit(p,5000);
 else for(let sequence=1;sequence<=7;sequence++)arena.handleInput(p.id,{type:'split',sequence,spawnSerial:p.spawnSerial},5000);
 assert.equal(arena.bodies(p).length,limit);assert.equal(arena.bodies(p).reduce((s,b)=>s+b.mass,0),40000);
 arena.boosterEffects.splitToLimit(p,5001);assert.equal(arena.bodies(p).length,limit);
});
