"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {PeerInputs}=require('../../scripts/benchmarks/resident-room-processes/peer-inputs.cjs');

test('headless input projection matches the browser fields through removals, resets and HUD changes',()=>{
  const wire=require('../../public/shared/arena-wire');
  const {InputState,FIELDS}=require('../../scripts/benchmarks/resident-room-processes/input-state.cjs');
  const full=new wire.Decoder(),headless=new InputState();
  const frames=[
    {stateReset:true,playersDelta:{removed:[],upsert:[{id:'p',x:1,y:2,spawnSerial:1,parts:[['p1',1,2,100,10,0,0,0]]},{id:'q',x:3,y:4,departure:{remainingMs:10}}]},selfDelta:{id:'p',lifeSeconds:1}},
    {playersDelta:{removed:[],upsert:[{id:'p',x:12,parts:{ids:['p2'],rows:[[0,15,12,2,100,10]]}},{id:'q',unset:['departure']}]},selfDelta:{id:'p',dead:true}},
    {playersDelta:{removed:['q'],upsert:[{id:'p',spawnSerial:2}]},selfDelta:{id:'p',unset:['dead']}},
    {stateReset:true,playersDelta:{removed:[],upsert:[{id:'r',x:5,y:6,spawnSerial:1}]},selfDelta:null},
  ];
  for(const frame of frames){
    const expected=full.decode({...frame,type:'state'}).players.map(p=>Object.fromEntries(FIELDS.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]])));
    assert.deepEqual([...headless.decode(frame).values()],expected);
  }
});

test('socket input driver decodes departures, removals, HUD and packed parts like the browser',()=>{
  const inputs=new PeerInputs();
  try{
    const c=inputs.add({readyState:1,send(){}});
    inputs.receive(c,{type:'fixtureWelcome',playerId:'p',index:0,boosters:['rocket']},0);
    inputs.receive(c,{type:'state',stateReset:true,playersDelta:{removed:[],upsert:[
      {id:'p',x:10,y:20,departure:{until:100},parts:[['p1',10,20,50,8,0,0,0]]},
      {id:'target',x:11,y:21,dead:false},
    ]},selfDelta:{id:'p',spawnSerial:1,lifeSeconds:4}},0);
    inputs.receive(c,{type:'state',playersDelta:{removed:['target'],upsert:[
      {id:'p',unset:['departure'],parts:{ids:['p2'],rows:[[0,15,30,40,60,9]]}},
    ]},selfDelta:{id:'p',spawnSerial:2,unset:['lifeSeconds']}},1);
    assert.equal(c.players.has('target'),false);
    assert.equal(Object.hasOwn(c.players.get('p'),'departure'),false);
    assert.equal(Object.hasOwn(c.players.get('p'),'lifeSeconds'),false);
    assert.equal(c.players.get('p').spawnSerial,2);
    assert.deepEqual(c.players.get('p').parts,[{id:'p2',x:30,y:40,mass:60,radius:9}]);
  }finally{inputs.report();}
});
test('socket load keeps moving on wall time when the room sends no new tick, and retains an unknown booster outcome',()=>{
  const inputs=new PeerInputs(),sent=[];
  try{
    const c=inputs.add({readyState:1,send:data=>sent.push(JSON.parse(data))});
    inputs.receive(c,{type:'fixtureWelcome',playerId:'p',index:0,boosters:['rocket']},0);
    inputs.receive(c,{type:'state',players:[{id:'p',x:500,y:500,spawnSerial:1,dead:false}]},0);
    inputs.started=0;c.feedAt=250;c.splitAt=1000;c.boosterAt=5000;
    inputs.tick(5000);inputs.tick(10000);
    assert.equal(sent.filter(m=>m.type==='move').length,2);
    assert.equal(sent.filter(m=>m.type==='feed').length,2);
    assert.equal(sent.filter(m=>m.type==='split').length,2);
    const command=sent.find(m=>m.type==='booster');
    assert(command);assert.equal(sent.filter(m=>m.type==='booster').length,1);
    assert.equal(c.pending.size,1);
    inputs.receive(c,{type:'boosterResult',requestId:command.requestId,ok:true},10100);
    inputs.tick(10150);
    assert.equal(sent.filter(m=>m.type==='booster').length,2);
    assert.equal(inputs.success,1);
    assert.equal(inputs.successLatencies[0],5100);
  }finally{inputs.report();}
});
