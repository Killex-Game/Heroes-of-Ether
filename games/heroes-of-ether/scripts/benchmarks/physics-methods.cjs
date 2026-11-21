"use strict";
// Deterministic offline method comparison; no sockets, storage or production data.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
let serial=0,wall=1800000000000;
crypto.randomUUID=()=> 'fixture-'+(++serial);
Date.now=()=>wall;
const {RoomFixture}=require('./resident-room-processes/room-fixture.cjs');
const {Arena}=require('../../src/server/arena/arena-simulation');
const methods=(process.env.PHYSICS_METHODS||'moveFeed').split(',');
if(methods.some(name=>name==='constructor'||typeof Arena.prototype[name]!=='function'))throw Error('Invalid method');
const seeds=Number(process.env.PHYSICS_SEEDS||6),ticks=Number(process.env.PHYSICS_TICKS||240);
if(!Number.isSafeInteger(seeds)||seeds<1||seeds>30||!Number.isSafeInteger(ticks)||ticks<60||ticks>2400)throw Error('Invalid replay size');
function candidate(){
  const filename=require.resolve('../../src/server/arena/arena-simulation');
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(fs.readFileSync(process.env.CANDIDATE_ARENA,'utf8'),filename);
  return loaded.exports.Arena.prototype;
}
const baseline=methods.map(name=>Arena.prototype[name]),updated=candidate();
const variants={B:baseline,A:methods.map(name=>updated[name])};
function run(variant,seed){
  serial=0;wall=1800000000000;
  methods.forEach((name,i)=>Arena.prototype[name]=variants[variant][i]);
  const profiles=Array.from({length:35},(_,i)=>({id:'p'+i,name:'Игрок '+i,level:600,skinId:'moon-dragon',appearance:{},
    account:{vipUntil:wall+86400000,premiumUntil:wall+86400000}}));
  const room=new RoomFixture('room-'+seed,profiles,1000,()=>{},'fixture');
  const hash=crypto.createHash('sha256');let ms=0;
  for(let tick=1;tick<=ticks;tick++){
    const at=1000+tick*50;wall=1800000000000+tick*50;
    const start=performance.now();room.tick(at);if(tick>40)ms+=performance.now()-start;
    hash.update(JSON.stringify({snapshot:room.arena.snapshot(at),progress:room.outbox,
      shots:room.arena.combat.shots,hazards:room.arena.hazards.items,food:room.arena.ether,players:[...room.arena.players.values()]}));
    room.outbox.length=0;room.inFlight.clear();
  }
  return {variant,seed,ms,hash:hash.digest('hex'),boosters:Object.keys(room.metrics.boosters).length};
}
const results=[];
for(let seed=1;seed<=seeds;seed++){
  const rows=[...'BAAB'].map(variant=>run(variant,seed));
  for(const row of rows)assert.equal(row.hash,rows[0].hash,'Simulation/progress diverged, seed '+seed);
  results.push(...rows);
}
console.log(JSON.stringify({scope:'offline deterministic physics, not network capacity',exact:true,methods,ticks,results},null,2));
