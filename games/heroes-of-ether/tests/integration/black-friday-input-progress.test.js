"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{once}=require('node:events');
const WebSocket=require('ws');
const fixture=require('../helpers/black-friday-fixture');
const B=require('../../src/server/events/black-friday');
const {Arena}=require('../../src/server/arena/arena-simulation');
const {createGameServer}=require('../../src/server/game-server');
const {freshProgress}=require('../../src/server/progression/experience-progression');

async function setup(t){
 const f=fixture(),arena=new Arena({etherCount:0});let mono=5000;
 f.store.transact(f.user.token,randomUUID(),'fixture-orders',p=>{
  p.level=25;p.progress=freshProgress(25);p.inventory.ice_cream=10;p.inventory.donut=10;p.quickSlots=['ice_cream','donut'];
  const specs=[['secret',0,9],['important',0,15],['common',0,9],['common',1,2]];
  p.blackFriday={runs:{[f.run.id]:{tokens:0,completedOrders:0,purchases:{},finalAt:null,days:{
   [B.day(f.now())]:{version:3,catalogVersion:2,earned:0,swaps:0,exchanges:{},
    lanes:{common:{done:0,issued:2},important:{done:0,issued:1},secret:{done:0,issued:1}},
    slots:specs.map(([tier,index,template])=>({tier,complete:false,current:{id:`${tier}:${index}:0`,revision:0,template,progress:0,assignedAt:f.now(),catalogVersion:2}}))}
  }}}};
 });
 const app=createGameServer({profiles:f.store,events:f.manager,arena,autoTick:false,now:()=>mono,wallNow:f.now,testBots:{enabled:false}});
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');t.after(()=>app.close());
 const url='ws://127.0.0.1:'+app.httpServer.address().port;
 async function connect(){const ws=new WebSocket(url,{headers:{Cookie:'sferorumiya_session='+f.user.token}}),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));
  const wait=async predicate=>{const signal=AbortSignal.timeout(4000);for(;;){const m=messages.find(predicate);if(m)return m;await once(ws,'message',{signal})}};
  const welcome=await wait(m=>m.type==='welcome');return{ws,messages,wait,p:arena.players.get(welcome.id)};
 }
 const advance=ms=>{mono+=ms;f.time(f.now()+ms)};
 const cast=async(c,id='ice_cream',command)=>{command ||= {type:'useBooster',boosterId:id,spawnSerial:c.p.spawnSerial,requestId:randomUUID()};const from=c.messages.length;c.ws.send(JSON.stringify(command));const signal=AbortSignal.timeout(4000);for(;;){const m=c.messages.slice(from).find(m=>m.type==='boosterResult'&&m.requestId===command.requestId);if(m)return{result:m,command};await once(c.ws,'message',{signal})}};
 return{...f,app,arena,advance,connect,cast,row:()=>f.view().orders.find(o=>o.metric==='boosterUses')};
}

test('successful input between ticks advances Black Friday once and publishes arena progress',async t=>{
 const f=await setup(t),c=await f.connect();f.app.tick();f.advance(50);
 const sent=await f.cast(c);assert.equal(sent.result.ok,true);assert.equal(f.row().progress,0);
 f.app.tick();assert.equal(f.row().progress,1,'manual cast must survive the next tick reset');
 f.advance(1100);f.app.tick();
 const hud=await c.wait(m=>m.type==='profile'&&(m.profilePatch||m.profile)?.arenaObjectives?.event?.progress===1);assert.ok(hud);
 const repeat=await f.cast(c,'ice_cream',sent.command);assert.equal(repeat.result.replay,true);
 f.advance(50);f.app.tick();assert.equal(f.row().progress,1);assert.equal(f.p().inventory.ice_cream,9);
});

test('immediate disconnect saves the last booster and the next arena entry continues its order',async t=>{
 const f=await setup(t);let c=await f.connect();f.app.tick();f.advance(50);
 assert.equal((await f.cast(c)).result.ok,true);
 const serverClosed=once([...f.app.wss.clients][0],'close');
 c.ws.close();await serverClosed;
 assert.equal(f.row().progress,1,'departure must drain the accepted input before ending life');
 f.advance(1000);c=await f.connect();f.app.tick();
 assert.equal(f.row().progress,1);f.advance(50);assert.equal((await f.cast(c)).result.ok,true);
 f.app.tick();assert.equal(f.row().progress,2);
});

test('advanced booster updates both orders; rejected cooldown and a failed progress write cannot lose or duplicate it',async t=>{
 const f=await setup(t),c=await f.connect();f.app.tick();f.advance(50);
 const first=await f.cast(c,'donut');assert.equal(first.result.ok,true);
 assert.equal((await f.cast(c,'donut')).result.ok,false);
 const save=f.store.save;
 f.store.save=()=>{throw Error('fixture disk failure');};
 f.app.tick();assert.equal(f.row().progress,0);
 f.store.save=save;f.advance(50);f.app.tick();
 assert.equal(f.row().progress,1);
 assert.equal(f.view().orders.find(o=>o.metric==='advancedUses').progress,1);
 f.advance(50);f.app.tick();assert.equal(f.row().progress,1);
 assert.equal(f.p().inventory.donut,9);
 assert.equal((await f.cast(c,'donut',first.command)).result.replay,true);
 f.advance(50);f.app.tick();assert.equal(f.row().progress,1);
});
