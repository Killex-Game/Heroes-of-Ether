/* Identical deterministic snapshots, alternating protocol order. Transport
 * encoding and browser-compatible decoding timed separately; canonical state
 * hashing is outside those timings. No game data, sockets, database or writes. */
"use strict";
const {createHash}=require('node:crypto'),assert=require('node:assert/strict');
const wire=require('../../public/shared/arena-wire');
const {ArenaStateStream,RoomFoodEncoder}=require('../../src/server/arena/state-stream');
const rooms=Number(process.env.REPLAY_ROOMS||1),frames=Number(process.env.REPLAY_FRAMES||600);
if(!Number.isInteger(rooms)||rooms<1||rooms>10||!Number.isInteger(frames)||frames<10||frames>36000)throw Error('Invalid replay size');
const masses = [20, 50, 150, 1000, 5000, 25000, 40000, 75000, 120000, 480000];
function scene(tick, room, staticFood) {
  
  const players = Array.from({length:30}, (_,i) => {
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
      y:(i*71+tick*3)%4000,boosterId:i%2?"knuckles":"poison",radius:10,ownerId:`p${i%30}`})),
    hazards:Array.from({length:40},(_,i)=>({id:"hazard"+i,x:i*137,y:i*91,radius:24})),
    events:[{type:"split",playerId:"p0",tick}],audioEvents:[],visualEvents:[],
    ...(tick%20===1?{leaderboard:players.slice(0,10).map(p=>({id:p.id,mass:p.mass}))}:{}),
  };
}

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function run(protocol,frameCount=frames){
 const hash=createHash('sha256'),encodeTimes=[],decodeTimes=[];let at=0,bytes=0,packets=0;
 const groups=Array.from({length:rooms},(_,r)=>{const foodEncoder=new RoomFoodEncoder();return {
 food:Array.from({length:300},(_,i)=>Object.freeze({id:'f'+i,x:i*17%6000,y:i*11%4000,radius:5,value:1})),
 peers:Array.from({length:30},(_,i)=>{const ws={playerId:'p'+i,protocol,readyState:1,bufferedAmount:0},out=[],decoder=new wire.Decoder();
 return {ws,out,decoder,stream:new ArenaStateStream(ws,(_,data)=>out.push(data),()=>at,foodEncoder)};})};});
 for(let tick=1;tick<=frameCount;tick++){
  at=tick*50;const states=groups.map((g,r)=>scene(tick,r,g.food));
  // Exercise hot countdowns without changing their precision, and preserve
  // unknown effect and player extension fields through additions/removals.
  for(const state of states)for(const [i,p] of state.players.entries()){
   p.effects.push({id:'speed',remainingMs:60000.123456789-tick*50});
   if(tick%30<15)p.futureExtension={value:tick,nested:['кириллица',null]};
   if(tick%7===0)p.effects.push({id:'new_effect',remainingMs:5.55,extension:true});
   p.instantEffects=tick%5?[{id:'meat',remainingMs:345.123-tick%50}]:[];
  }
  const start=performance.now();
  for(let r=0;r<groups.length;r++)for(let i=0;i<30;i++){
   const p=groups[r].peers[i],same=i%3===0;
   p.stream.viewport=i===29?null:{x:same?2000:600+i%7*700,y:same?1800:500+Math.floor(i/7)*650,width:2400,height:1600};
   p.ws.bufferedAmount=i%11===0&&tick%13<3?100000:0;
   if(tick%5!==0)p.stream.acknowledge(p.stream.sequence);
   p.stream.publish(states[r]);
  }
  encodeTimes.push(performance.now()-start);
  for(const g of groups)for(const p of g.peers)for(const packet of p.out.splice(0)){
   bytes+=Buffer.byteLength(packet);packets++;const decodeAt=performance.now();
   const state=p.decoder.decode(JSON.parse(packet));decodeTimes.push(performance.now()-decodeAt);
   delete state.foodDelta;delete state.playersDelta;
   hash.update(JSON.stringify(canonical({...state,food:[...p.decoder.food.values()]})));
  }
 }
 const stats=rows=>{const sorted=[...rows].sort((a,b)=>a-b);return {totalMs:rows.reduce((a,b)=>a+b,0),p95Ms:sorted[Math.floor(sorted.length*.95)],p99Ms:sorted[Math.floor(sorted.length*.99)]};};
 return {protocol,rooms,players:rooms*30,frames:frameCount,packets,bytes,decodedHash:hash.digest('hex'),encode:stats(encodeTimes),decode:stats(decodeTimes)};
}
const order=process.env.REPLAY_ORDER||'BAAB';if(!/^[AB]{2,8}$/.test(order)||!order.includes('A')||!order.includes('B'))throw Error('Invalid order');
run(wire.PROTOCOL,10);run(wire.PLAYER_SCHEMA_PROTOCOL,10);
const results=[...order].map(v=>{const result=run(v==='A'?wire.PLAYER_SCHEMA_PROTOCOL:wire.PROTOCOL);process.stderr.write(JSON.stringify({done:v,...result})+'\n');return result;});
for(const r of results){assert.equal(r.decodedHash,results[0].decodedHash);assert.equal(r.packets,results[0].packets);}
const a=results.find(r=>r.protocol===wire.PLAYER_SCHEMA_PROTOCOL),b=results.find(r=>r.protocol===wire.PROTOCOL);
console.log(JSON.stringify({scope:'Encoding/decoding replay, not whole-game capacity or browser FPS',exactDecodedStates:true,byteReduction:1-a.bytes/b.bytes,results},null,2));
