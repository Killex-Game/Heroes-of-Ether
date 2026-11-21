/* Deterministic presentation-only replay. No listeners, profiles or game data.
 * Optional BASELINE_STREAM points at a saved state-stream.js for byte comparison.
 * Hashing is outside the timed region; no browser rendering or socket I/O here. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const { createHash } = require("node:crypto"), { performance } = require("node:perf_hooks");
const wire = require("../../public/shared/arena-wire");
const filename = require.resolve("../../src/server/arena/state-stream");
const current = require(filename).ArenaStateStream;
const { RoomFoodEncoder } = require(filename);
let baseline = current;
let BaselineFoodEncoder = RoomFoodEncoder;
if (process.env.BASELINE_STREAM || process.env.BASELINE_VISIBILITY) {
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  if (process.env.BASELINE_VISIBILITY) mod.require = id => id === "./visibility"
    ? require(path.resolve(process.env.BASELINE_VISIBILITY)) : originalRequire(id);
  mod._compile(fs.readFileSync(process.env.BASELINE_STREAM || filename, "utf8"), filename);
  baseline = mod.exports.ArenaStateStream;
  BaselineFoodEncoder = mod.exports.RoomFoodEncoder || RoomFoodEncoder;
}
const rooms = Number(process.env.REPLAY_ROOMS || 10), frames = Number(process.env.REPLAY_FRAMES || 80);
const trace = process.env.REPLAY_TRACE ? JSON.parse(fs.readFileSync(process.env.REPLAY_TRACE,"utf8")) : null;
if (trace && (trace.version !== 1 || trace.ownerIds?.length !== 35 || !Array.isArray(trace.frames)))
  throw Error("Invalid room snapshot trace");
const masses = [20, 50, 150, 1000, 5000, 25000, 40000, 75000, 120000, 480000];
function scene(tick, room, staticFood) {
  if (trace) return structuredClone(trace.frames[tick-1]);
  const players = Array.from({length:35}, (_,i) => {
    const mass = masses[i % masses.length], count = Math.max(1, Math.min(16, Math.ceil(mass / 5000)));
    const x = 400 + i % 7 * 700 + tick * 2, y = 400 + Math.floor(i / 7) * 650;
    const parts = Array.from({length: count + Number(i === 0 && tick % 15 > 5)}, (_,j) => ({
      id: `p${i}c${j}`, x:x+(j%4)*50, y:y+Math.floor(j/4)*50+tick,
      mass:mass/count, radius:16+Math.sqrt(mass/count)*2.5,
      mergeVersion:1, mergeMs:Math.max(0,30000-tick*50), burnMs:i%3?0:1000-tick,
      ...(tick % 15 === 6 ? {birth:{x,y,at:tick*50}} : {}),
    }));
    return { id:`p${i}`, name:`Тест ${room}-${i}`, x,y,mass,radius:parts[0].radius,parts,
      viewRadius:400, mainPartId:parts[0].id, spawnSerial:1, skinId:"default-1",
      outfit:{hat:"",bow:""}, clanPrefix:"TEST", clanId:`clan-${room}`, level:600,
      account:{vip:true,premium:true}, color:"#d6aaff", arenaFrame:"premium",
      lifeSeconds:Math.floor(tick/20), lifeElapsedMs:tick*50, canFeed:true, canSplit:count<16,
      boosterUses:{meat:tick%24}, boosterLimit:30, boosterCooldownMs:0,
      shieldCooldowns:{clan_shield:30000-tick*50}, boosterCooldowns:{}, massLimit:30000,
      accessoryAbilities:[{id:"easter_egg",count:3,source:"hat"}],
      effects:[{id:"clan_shield",remainingMs:30000-tick*50}],
      pet:{id:"manya",level:5,active:true,vitality:98,stock:{fire:11},cooldowns:{}},
      turbo:{active:false,remainingMs:180000,sequence:0},
    };
  });
  const ether = staticFood.filter((_,i)=>i%60!==tick%60);
  for(let i=0;i<Number(process.env.REPLAY_DROPS || 500);i++) ether.push({id:"e"+(300+i).toString(36),x:(i*37+tick*8)%6000,
    y:(i*61+tick*2)%4000,radius:7.5,value:5,artValue:5,ejected:true});
  return {type:"state",tick,world:{width:6120,height:4080},players,ether,
    projectiles:Array.from({length:60},(_,i)=>({id:"shot"+i,x:(i*101+tick*5)%6000,
      y:(i*71+tick*3)%4000,boosterId:i%2?"knuckles":"poison",radius:10,ownerId:`p${i%35}`})),
    hazards:Array.from({length:40},(_,i)=>({id:"hazard"+i,x:i*137,y:i*91,radius:24})),
    events:[{type:"split",playerId:"p0",tick}],audioEvents:[],visualEvents:[],
    ...(tick%20===1?{leaderboard:players.slice(0,10).map(p=>({id:p.id,mass:p.mass}))}:{}),
  };
}
function run(Stream, name, frameCount = frames, FoodEncoder = RoomFoodEncoder) {
  if (trace && frameCount > trace.frames.length) throw Error("Trace is shorter than replay/warmup");
  const hash=createHash("sha256"), durations=[], times=[];
  const groups=Array.from({length:rooms},(_,room)=>{
    const foodEncoder = new FoodEncoder();
    return {
    food:Array.from({length:Number(process.env.REPLAY_FOOD || 300)},(_,i)=>Object.freeze({id:"f"+i,x:i*17%6000,y:i*11%4000,radius:5,value:1})),
    peers:Array.from({length:35},(_,i)=>{
      const ws={playerId:trace ? trace.ownerIds[i] : `p${i}`,protocol:wire.PROTOCOL,readyState:1,bufferedAmount:0};
      const packets=[];
      const stream=new Stream(ws,(_,data)=>packets.push(data),()=>times[0],foodEncoder);
      return {ws,stream,packets};
    }),
    };
  });
  let bytes=0,packets=0;
  for(let tick=1;tick<=frameCount;tick++) {
    times[0]=tick*50;
    const states=groups.map((g,i)=>{
      const state = scene(tick,i,g.food);
      return process.env.REPLAY_CLONE === "1" ? structuredClone(state) : state;
    });
    const traceViews = trace && states.map(state=>new Map(state.players.map(p=>[p.id,
      {x:p.x,y:p.y,width:1800,height:1200}])));
    const at=performance.now();
    for(let r=0;r<groups.length;r++) for(let i=0;i<35;i++) {
      const p=groups[r].peers[i];
      // Shared views, unique views, full map and slow peers all occur.
      const same=i%3===0;
      p.stream.viewport=trace ? (traceViews[r].get(p.ws.playerId) || p.stream.viewport) :
        i===34?null:{x:same?2000:600+i%7*700,y:same?1800:500+Math.floor(i/7)*650,
        width:2400,height:1600};
      p.ws.bufferedAmount=i%11===0&&tick%13<3?100000:0;
      if(tick%5!==0) p.stream.acknowledge(p.stream.sequence);
      p.stream.publish(states[r]);
    }
    durations.push(performance.now()-at);
    for(const g of groups) for(const p of g.peers) for(const packet of p.packets.splice(0)) {
      hash.update(packet);bytes+=Buffer.byteLength(packet);packets++;
    }
  }
  const sorted=[...durations].sort((a,b)=>a-b);
  return {name,rooms,players:rooms*35,frames:frameCount,ms:durations.reduce((a,b)=>a+b,0),
    p95:sorted[Math.floor(sorted.length*.95)],bytes,packets,hash:hash.digest("hex")};
}
const warmup = Number(process.env.REPLAY_WARMUP || 12);
const order = process.env.REPLAY_ORDER || "BAAB";
if (!Number.isSafeInteger(warmup) || warmup < 1 || !/^[AB]{2,16}$/.test(order) || !order.includes("A") || !order.includes("B"))
  throw Error("Invalid replay warmup/order");
run(baseline,"warmup",warmup,BaselineFoodEncoder); run(current,"warmup",warmup);
const results = [...order].map(variant => variant === "B"
  ? run(baseline,"before",frames,BaselineFoodEncoder) : run(current,"after"));
if(results.some(r=>r.hash!==results[0].hash||r.packets!==results[0].packets)) throw Error("Wire output differs");
console.log(JSON.stringify({identical:true,results}));
