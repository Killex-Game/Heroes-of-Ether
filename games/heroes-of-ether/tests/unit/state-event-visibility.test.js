"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ArenaStateStream, STATE_PROTOCOL } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
const body = (id, x, radius = 20) => ({id,x,y:500,radius,mass:100,parts:[{id:id+"-part",x,y:500,radius,mass:100}]});
const absorbed = id => ({type:"absorbed",victimId:id,victimPartId:id+"-part",victimX:500,victimY:500,tick:2,
  victimProfileId:"private-profile",gain:100});
const state = (tick, players, events = [], extra = {}) => ({type:"state",tick,
  world:{width:10000,height:10000},players,ether:[],projectiles:[],hazards:[],events,
  audioEvents:[],visualEvents:[],...extra});
function peer(protocol = wire.PROTOCOL) {
  const ws={protocol,readyState:1,bufferedAmount:0,playerId:"self"},packets=[];
  const stream = new ArenaStateStream(ws,(_,data)=>packets.push(JSON.parse(data)),()=>1000);
  stream.viewport={x:500,y:500,width:500,height:500};
  return {ws,stream,packets};
}
test("presentation termination includes current and previously transmitted victims, not unseen players",()=>{
  const {stream,packets}=peer();
  stream.publish(state(1,[body("self",500),body("old",600),body("far",7000)]));
  stream.acknowledge(1);
  const source=state(2,[body("self",500),body("new",700),body("far",7000)],
    [absorbed("old"),absorbed("new"),absorbed("far"),{type:"absorbed",tick:2},{type:"unknown",id:"keep"}],
    {audioEvents:[{type:"shield",playerId:"far"}],visualEvents:[{type:"contact",playerId:"far"}]});
  const saved=structuredClone(source);
  stream.publish(source);
  assert.deepEqual(packets[1].events.map(e=>e.victimId||e.id||e.type),["old","new","absorbed","keep"]);
  assert.equal(packets[1].events[0].victimProfileId,undefined);
  assert.deepEqual(packets[1].audioEvents,source.audioEvents);
  assert.deepEqual(packets[1].visualEvents,source.visualEvents);
  assert.deepEqual(source,saved);
});
test("large edge-overlapping bodies are included even when their centres are outside the camera",()=>{
  const {stream,packets}=peer();
  stream.publish(state(1,[body("giant",1400,1000),body("far",7000)], [absorbed("giant"),absorbed("far")]));
  assert.deepEqual(packets[0].events.map(e=>e.victimId),["giant"]);
});
test("stalled peers retain known victims across coalescing and use the actual next camera",()=>{
  const {stream,ws,packets}=peer();
  stream.publish(state(1,[body("old",600),body("new",6500)]));stream.acknowledge(1);
  ws.bufferedAmount=1000000;
  stream.publish(state(2,[body("new",6500)],[absorbed("old"),absorbed("hidden")]));
  stream.viewport={x:6500,y:500,width:500,height:500};
  stream.publish(state(3,[body("new",6500)],[absorbed("new")]));
  ws.bufferedAmount=0;stream.flush();
  assert.equal(packets.length,2);assert.equal(packets[1].tick,3);
  assert.deepEqual(packets[1].events.map(e=>e.victimId),["old","new"]);
});
test("identical current selections with different prior views never share an incorrect event list",()=>{
  const a=peer(),b=peer(); b.stream.viewport={x:6500,y:500,width:500,height:500};
  const first=state(1,[body("left",500),body("right",6500)]);
  for(const p of [a,b]){p.stream.publish(first);p.stream.acknowledge(1);p.stream.viewport={x:3500,y:500,width:500,height:500};}
  const next=state(2,[],[absorbed("left"),absorbed("right")]);
  for(const p of [a,b])p.stream.publish(next);
  assert.deepEqual(a.packets[1].events.map(e=>e.victimId),["left"]);
  assert.deepEqual(b.packets[1].events.map(e=>e.victimId),["right"]);
});
test("whole-room and legacy streams keep their original event contract",()=>{
  for(const protocol of [STATE_PROTOCOL,wire.ENTITY_PROTOCOL,wire.PROTOCOL]){
    const {stream,packets}=peer(protocol);
    if(protocol===wire.PROTOCOL)stream.viewport=null;
    stream.publish(state(1,[],[absorbed("far")]));
    assert.equal(packets[0].events.length,1);
    if(protocol!==wire.PROTOCOL)assert.equal(packets[0].events[0].gain,100);
  }
});
