/* Offline packet-size diagnostic with real room physics and all booster types.
 * No sockets, saved profiles or inventory claims. Not a capacity benchmark. */
"use strict";
const { EventEmitter } = require("node:events");
const fs = require("node:fs"), path = require("node:path");
const { RoomFixture } = require("./resident-room-processes/room-fixture.cjs");
const wire = require("../../public/shared/arena-wire");
const frames = Number(process.env.PAYLOAD_FRAMES || 240);
if (!Number.isSafeInteger(frames) || frames < 1 || frames > 2400) throw Error("Invalid frame count");
const at = Date.UTC(2026, 10, 13, 12);
const profiles = Array.from({ length:35 }, (_, i) => ({ id:"p"+i, name:"Тест "+i,
  level:600, skinId:"default-1", appearance:{}, account:{vipUntil:at+86400000,premiumUntil:at+86400000} }));
const room = new RoomFixture("room-1", profiles, 1000, () => {}, "payload");
const traceFile = process.env.PAYLOAD_TRACE && path.resolve(process.env.PAYLOAD_TRACE);
if (traceFile && fs.existsSync(traceFile)) throw Error("Use a new trace file");
const trace = traceFile && { version:1, ownerIds:room.players.map(p=>p.id), frames:[] };
let captured;
if (trace) {
  const snapshot=room.arena.snapshot.bind(room.arena);
  room.arena.snapshot=(...args)=>(captured=snapshot(...args));
}
const packets = [], fields = {}, playerFields = {}, foodMetadata = {};
let bytes = 0, count = 0, births = 0, binaryMotionBytes = 0, maximum = 0;
const add = (target, key, value) => { const json=JSON.stringify(value); if(json!==undefined) target[key]=(target[key]||0)+Buffer.byteLength(json); };
for (let i=0; i<35; i++) {
  const ws = new EventEmitter();
  Object.assign(ws, { protocol:wire.PROTOCOL, readyState:1, bufferedAmount:0,
    send(data,options,done){packets.push(data);done?.();}, close(){this.emit("close");}, terminate(){this.emit("close");} });
  room.connect(ws,i);
}
for (let tick=1; tick<=frames; tick++) {
  for (const stream of room.clients) {
    const p=room.arena.players.get(stream.ws.playerId);
    stream.viewport={x:p.x,y:p.y,width:1800,height:1200};
    stream.acknowledge(stream.sequence);
  }
  room.tick(1000+tick*50);
  if (trace) trace.frames.push(structuredClone(captured));
  room.outbox.length=0; room.inFlight.clear();
  for (const raw of packets.splice(0)) {
    const packet=JSON.parse(raw), size=Buffer.byteLength(raw);
    bytes+=size;count++;maximum=Math.max(maximum,size);
    for(const [key,value] of Object.entries(packet))add(fields,key,value);
    for(const player of packet.playersDelta?.upsert||[])
      for(const [key,value] of Object.entries(player))add(playerFields,key,value);
    for(const row of packet.foodDelta?.upsert||[]) if(row.length>3) {
      births++;for(const [key,value] of Object.entries(row[3]||{}))add(foodMetadata,key,value);
    }
    if(packet.foodDelta?.moves)binaryMotionBytes+=Buffer.from(packet.foodDelta.moves,"base64").length;
  }
}
const sort = value => Object.fromEntries(Object.entries(value).sort((a,b)=>b[1]-a[1]));
if (trace) fs.writeFileSync(traceFile,JSON.stringify(trace),{flag:"wx"});
console.log(JSON.stringify({scope:"offline packet composition; no durability or network load",frames,players:35,packets:count,
  bytes,averagePacketBytes:bytes/count,maximumPacketBytes:maximum,fields:sort(fields),playerFields:sort(playerFields),
  foodMetadata:sort(foodMetadata),births,binaryMotionBytes,room:room.report()},null,2));
