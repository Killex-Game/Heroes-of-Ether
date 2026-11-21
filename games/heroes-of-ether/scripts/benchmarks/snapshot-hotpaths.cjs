/* Isolated deterministic snapshots/economy scans. No sockets or saved profiles.
 * Run with a test-only baseline loader to compare identical output and cost. */
"use strict";
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const history = require("../../src/server/profiles/transaction-history");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const activity = require("../../src/server/progression/activity-achievements");
const { ArenaStateStream } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
let seed = 12345;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const arena = new Arena({ random, backgroundRandom: () => 0, etherCount: 400 });
// Exercise W/poison food too: dynamic rows must retain birth and field order.
for (let i = 0; i < arena.ether.length; i++) {
  if (i % 3 === 0) continue;
  Object.assign(arena.ether[i], {ejected:true, artValue:5});
  if (i % 2) arena.ether[i].birth = {x:arena.ether[i].x-12,y:arena.ether[i].y+7};
}
const masses = [20, 50, 150, 1000, 5000, 25000, 40000, 75000, 120000, 480000];
for (let i = 0; i < 35; i++) {
  const p = arena.addPlayer(0, "player-" + i), mass = masses[i % masses.length];
  Object.assign(p, { mass, radius:radiusForMass(mass), x:500+i%7*600, y:500+Math.floor(i/7)*600,
    color:"#bbaaee", lifeId:"life-"+i, spawnSerial:i+1,
    outfit:{hat:i%2?"rabbit_ears":"wizard_hat",bow:"carrot_bow"} });
  const count = Math.min(16, Math.max(1, Math.ceil(mass / 5000)));
  if(count>1) p.parts = Array.from({length:count},(_,j)=>({
    id:`part-${i}-${j}`, mass:mass/count, radius:radiusForMass(mass/count),
    x:p.x+j%4*40,y:p.y+Math.floor(j/4)*40, mergeVersion:j%2, mergeAt:30000,
    splitStartedAt:j%2?1000:0, ...(j%2?{birth:{x:p.x,y:p.y}}:{}),
  }));
  p.shieldReadyAt = {clan_shield:1700,golden_shield:3000};
  p.boosterItemReadyAt = {meat:900,fire:2500};
  p.instantEffects = {meat:1800};
  p.swordBurns = i%2?[]:[{partId:`part-${i}-0`,until:1800},{partId:`part-${i}-0`,until:2800}];
}
function snapshots(iterations, verify) {
  const hash=createHash("sha256"), rawHash=createHash("sha256");
  let milliseconds=0, at=0, bytes=0;
  const peers=Array.from({length:35},(_,i)=>new ArenaStateStream(
    {playerId:"player-"+i,protocol:wire.PROTOCOL,readyState:1,bufferedAmount:0},
    (_,data)=>{rawHash.update(data);bytes+=Buffer.byteLength(data);},()=>at));
  for(let tick=0;tick<iterations;tick++) {
    at=950+tick%60*50;
    const start=performance.now(), frame=arena.snapshot(at,[],tick%20===0);
    milliseconds+=performance.now()-start;
    if(verify) {
      hash.update(JSON.stringify(frame));
      for(const peer of peers) {peer.acknowledge(peer.sequence);peer.publish(frame);}
    }
  }
  return {milliseconds,hash:hash.digest('hex'),wireHash:rawHash.digest('hex'),bytes};
}
const at=Date.UTC(2026,10,6,12), store=new ProfileStore({filePath:null,now:()=>at});
const auth=store.open(), template=store.find(auth.token);
const world={profiles:{}};
for(let i=0;i<350;i++) {
  const p=structuredClone(template); p.id="fixture-"+i;
  p.transactions={version:1,startedAt:at,opening:history.snapshot(p),entries:[]};
  world.profiles[p.id]=p;
}
function economy(iterations) {
  const start=performance.now();let result=world;
  for(let i=0;i<iterations;i++) result=history.syncWorld(result,at);
  assert.deepEqual(result,world);
  return performance.now()-start;
}
function achievements(iterations) {
  const p=structuredClone(template); const start=performance.now();
  for(let i=0;i<iterations;i++) activity.awardExtra(p,at);
  return {milliseconds:performance.now()-start,values:p.activity.values,claimed:p.activity.claimed,greatness:p.greatness};
}
snapshots(300,false); economy(100); achievements(1000);
const snapshotsTimed=snapshots(2400,false), equivalence=snapshots(120,true);
console.log(JSON.stringify({snapshotsTimed,equivalence,economyMs:economy(3000),achievements:achievements(40000)}));
