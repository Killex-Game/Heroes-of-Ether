'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {RoomFixture}=require('./resident-room-processes/room-fixture.cjs');
const {createFixture}=require('./mongodb-room-fixture.cjs');
const wire=require('../../public/shared/arena-wire');
const {Encoder,Decoder}=require(process.env.MSGPACK_MODULE||'@msgpack/msgpack');
const profiles=Object.values(createFixture().data.profiles).slice(0,35);
const now=performance.now(),room=new RoomFixture('room-0',profiles,now,()=>{},'codec');
const samples=[],pending=[];
for(let i=0;i<35;i++){
 const peer=new EventEmitter();Object.assign(peer,{readyState:1,bufferedAmount:0,protocol:wire.PROTOCOL});
 peer.send=(raw,options,callback)=>{const text=String(raw),p=JSON.parse(text);if(samples.length<1200)samples.push({text,object:p});pending.push([peer,p.stateSequence]);callback?.();};
 peer.close=peer.terminate=()=>{};room.connect(peer,i);
}
process.env.ROOM_BENCH_VIEWS='camera';
for(let tick=0;tick<70;tick++){
 room.tick(now+tick*50);room.outbox.length=0;room.inFlight.clear();
 for(const [p,sequence] of pending.splice(0))p.emit('message',JSON.stringify({type:'stateAck',sequence}));
}
const encoder=new Encoder(),decoder=new Decoder();
let jsonBytes=0,msgBytes=0;for(const s of samples){s.msg=encoder.encode(s.object);jsonBytes+=Buffer.byteLength(s.text);msgBytes+=s.msg.length;assert.deepEqual(decoder.decode(s.msg),s.object);}
function measure(name,operation){const times=[];let checksum=0;
 for(let round=0;round<6;round++){const start=performance.now();for(const s of samples)checksum+=operation(s);if(round)times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);return{name,medianMs:times[2],p95Ms:times[4],checksum};}
const fields={},playerFields={};
for(const s of samples) {
 for(const [key,value] of Object.entries(s.object)) fields[key]=(fields[key]||0)+Buffer.byteLength(JSON.stringify(value));
 for(const row of s.object.playersDelta?.upsert||[])for(const [key,value]of Object.entries(row))playerFields[key]=(playerFields[key]||0)+Buffer.byteLength(JSON.stringify(value));
}
console.log(JSON.stringify({samples:samples.length,jsonBytes,msgBytes,saving:1-msgBytes/jsonBytes,fields,playerFields,exact:true,measurements:[
 measure('JSON encode',s=>Buffer.byteLength(JSON.stringify(s.object))),
 measure('MessagePack encode',s=>encoder.encode(s.object).length),
 measure('JSON parse',s=>JSON.parse(s.text).stateSequence),
 measure('MessagePack decode',s=>decoder.decode(s.msg).stateSequence)
]}));
