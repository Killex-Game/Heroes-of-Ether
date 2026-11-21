"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { packState, unpackState } = require("../../src/server/arena/state-transfer");
const { ArenaStateWorkers } = require("../../src/server/arena/state-workers");
const { ArenaStateStream } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
function snapshot(tick) {
  return { type:"state", tick, world:{width:6000,height:4000}, players:Array.from({length:35},(_,i)=>({
    id:`p${i}`, name:`Игрок ${i}`, x:800+i*60, y:1000+tick, mass:15000, radius:150,
    viewRadius:500, mainPartId:`p${i}-0`, lifeElapsedMs:tick*50,
    parts:Array.from({length:16},(_,j)=>({id:`p${i}-${j}`,x:800+i*60+j*5+tick/7,y:1000+j*7,
      mass:937.5-tick/8,radius:28.124,mergeVersion:j%2,
      ...(j%3===0?{birth:{x:800,y:1000,parentId:`p${i}`,at:0}}:{}),mergeMs:Math.max(0,10000-tick*50),burnMs:0})),
    pet:{id:"manya",stock:{fire:5}},
  })), ether:[{id:"e",x:801,y:1000,radius:5,value:5,birth:{sourceId:"p0",x:1,y:2}}],
  hazards:[],projectiles:[],events:[],audioEvents:[],visualEvents:[] };
}
test("packed parts round-trip exact values, key order, births and unsupported rows without changing source",()=>{
  const state=snapshot(1);
  state.players[0].parts[0].x=-0;
  state.players[0].parts[1].future={value:"keep"};
  state.players[0].parts[2].mergeMs=NaN;
  const before=structuredClone(state), group=packState(state);
  assert.ok(group.partData);
  const copied=structuredClone(group,{transfer:[group.partData.values.buffer]});
  const actual=unpackState(copied);
  assert.deepEqual(actual,before);
  assert.equal(JSON.stringify(actual),JSON.stringify(before));
  assert.deepEqual(state,before);
  assert.equal(group.partData.values.byteLength,0);
});
test("small and unfamiliar snapshots retain ordinary transport",()=>{
  const state=snapshot(1);state.players.length=1;
  assert.equal(packState(state).snapshot,state);
  assert.equal(packState(state).partData,undefined);
  state.players=Array.from({length:70},(_,i)=>({id:String(i),parts:[{id:String(i),x:i,y:i,radius:1,mass:1}]}));
  assert.equal(packState(state).partData,undefined);
});
test("packed worker packets match direct stream byte for byte across split, removal, metadata and distinct cameras",async t=>{
  const prior=process.env.SFERORUMIA_PACKED_PARTS;process.env.SFERORUMIA_PACKED_PARTS="1";
  t.after(()=>{if(prior===undefined)delete process.env.SFERORUMIA_PACKED_PARTS;else process.env.SFERORUMIA_PACKED_PARTS=prior});
  const pool=new ArenaStateWorkers({maxWorkers:1});t.after(()=>pool.close());
  const clients=Array.from({length:35},(_,i)=>{
    const ws={playerId:`p${i}`,protocol:wire.PROTOCOL,readyState:1,bufferedAmount:0};
    const actual=[],expected=[];
    const stream=pool.createStream("a",ws,(_,data)=>actual.push(Buffer.from(data)));
    const direct=new ArenaStateStream({...ws},(_,data)=>expected.push(Buffer.from(data)),()=>0);
    return {stream,direct,actual,expected};
  });
  for(let tick=1;tick<=8;tick++){
    const state=snapshot(tick);
    if(tick>2) state.players[0].parts.splice(3,3);
    if(tick>4) {state.players.splice(12,1);state.ether=[]}
    if(tick===4) state.ether[0].birth.sourceId="p1";
    for(let i=0;i<clients.length;i++) for(const stream of [clients[i].stream,clients[i].direct]){
      stream.viewport={x:800+i*60,y:1000,width:900+(i%2)*200,height:700};
      stream.acknowledge(stream.sequence);stream.publish(state);
    }
    const deadline=Date.now()+5000;
    while(clients.some(c=>c.actual.length<tick)){
      assert.ok(Date.now()<deadline,"worker timeout");await delay(5);
    }
    for(const c of clients) assert.deepEqual(c.actual.at(-1),c.expected.at(-1));
  }
  assert.equal(pool.stats.failures,0);
});
