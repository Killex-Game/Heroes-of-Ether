'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {workerPolicy}=require('../../scripts/benchmarks/capacity-worker-policy.cjs');
const {ArenaStateWorkers}=require('../../src/server/arena/state-workers');
const {ArenaStateStream}=require('../../src/server/arena/state-stream');
const wire=require('../../public/shared/arena-wire');
test('configured capacity workers handle a fourth room with exact states and no main-thread overflow',async t=>{
 const config=require('../../config/arena-state-workers.json'),env=workerPolicy(config);
 assert.equal(config.maxWorkers,3);assert.equal(config.maxRooms,5);
 const pool=new ArenaStateWorkers({maxWorkers:Number(env.LOAD_STATE_WORKERS),maxRooms:Number(env.LOAD_STATE_WORKER_ROOMS),now:()=>0});
 t.after(()=>pool.close());const actual=[],expected=[];
 for(let i=0;i<4;i++){
  const ws={playerId:'p'+i,protocol:wire.PROTOCOL,readyState:1,bufferedAmount:0};
  const state={type:'state',tick:1,world:{width:6000,height:4000},players:[{id:ws.playerId,x:100+i,y:200,mass:100,radius:20}],ether:[],projectiles:[],hazards:[],events:[],audioEvents:[],visualEvents:[]};
  const stream=pool.createStream('room-'+i,ws,(_,data)=>actual[i]=JSON.parse(data));
  new ArenaStateStream(ws,(_,data)=>expected[i]=JSON.parse(data),()=>0).publish(state);
  stream.publish(state);
 }
 pool.flush();const deadline=Date.now()+5000;
 while(actual.filter(Boolean).length<4){assert(Date.now()<deadline,'all four worker states arrive');await delay(5);}
 assert.equal(pool.lanes.length,3);assert.equal(pool.rooms.size,4);assert.equal(pool.stats.overflowStreams,0);
 for(let i=0;i<4;i++)assert.deepEqual(new wire.Decoder().decode(actual[i]),new wire.Decoder().decode(expected[i]));
});
test('capacity policy rejects invalid configuration and preserves explicitly disabled workers',()=>{
 assert.deepEqual(workerPolicy({enabled:false,maxWorkers:3,maxRooms:5}),{LOAD_STATE_WORKERS:'0',LOAD_STATE_WORKER_ROOMS:'5'});
 for(const config of [{enabled:true,maxWorkers:0,maxRooms:5},{enabled:true,maxWorkers:9,maxRooms:5},{enabled:true,maxWorkers:3,maxRooms:0},{enabled:'yes',maxWorkers:3,maxRooms:5}])assert.throws(()=>workerPolicy(config));
});
