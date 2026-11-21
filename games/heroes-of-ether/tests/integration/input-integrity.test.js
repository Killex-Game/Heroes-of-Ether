"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {once}=require('node:events'),{randomUUID}=require('node:crypto'),WebSocket=require('ws');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {createGameServer}=require('../../src/server/game-server');
const {Arena,speedForMass}=require('../../src/server/arena/arena-simulation');
const {recover}=require('../../src/server/profiles/profile-journal');
const {REASON,DURATION_MS}=require('../../src/server/arena/input-integrity');
async function fixture(t,journal=false){
  let at=5000;const wall=Date.now(),dir=journal?fs.mkdtempSync(path.join(os.tmpdir(),'integrity-ws-')):null,filePath=dir?path.join(dir,'profiles.json'):null;
  const profiles=new ProfileStore({filePath,journal,incrementalSettlement:true,now:()=>wall}),auth=profiles.open();
  profiles.transact(auth.token,randomUUID(),'integrity-test-setup',p=>{p.quickSlots=['sphere'];p.inventory.sphere=10;});
  const app=createGameServer({profiles,now:()=>at,wallNow:()=>wall,autoTick:false,arena:new Arena({etherCount:0}),testBots:{enabled:false}});
  let ws;
  t.after(async()=>{ws?.terminate();await app.close();if(dir)fs.rmSync(dir,{recursive:true,force:true});});
  app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');
  const url='http://127.0.0.1:'+app.httpServer.address().port;
  ws=new WebSocket(url,{headers:{Cookie:'sferorumiya_session='+auth.token}});const packets=[];
  ws.on('message',data=>packets.push(JSON.parse(data)));await once(ws,'open');
  const wait=async predicate=>{for(let n=0;n<300;n++){const found=packets.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,10));}throw Error('Missing packet: '+JSON.stringify(packets.map(p=>p.type)));};
  const welcome=await wait(p=>p.type==='welcome');await wait(p=>p.type==='profile');
  return{app,profiles,auth,ws,packets,wait,wall,filePath,url,player:()=>app.arena.players.get(welcome.id),set:time=>at=time};
}
for(const payload of [{type:'move',x:500,y:500,speed:999},{type:'useBooster',boosterId:'sphere',shieldReadyAt:{sphere:0}},
  {type:'useBooster',boosterId:'ice_cream',mass:999999},{type:'feed',sequence:1,x:1500,y:500,mass:999}])
test('authenticated '+payload.type+' '+Object.keys(payload).at(-1)+' tampering is rejected and ban survives WAL recovery before disconnect', {timeout:10000},async t=>{
  const f=await fixture(t,true),before=structuredClone(f.profiles.find(f.auth.token));
  f.ws.send(JSON.stringify({...payload,spawnSerial:f.player().spawnSerial,requestId:randomUUID()}));
  const banned=await f.wait(p=>p.type==='accountBanned');assert.equal(banned.reason,REASON);assert.equal(banned.until,f.wall+DURATION_MS);
  const stored=Object.values(recover(f.filePath).data.profiles).find(p=>p.id===f.auth.profile.id);
  assert.equal(stored.moderation.ban.reason,REASON);assert.equal(stored.moderation.ban.until,banned.until);
  assert.deepEqual(stored.wallet,before.wallet);assert.deepEqual(stored.inventory,before.inventory);
  const r=await fetch(f.url+'/api/profile',{headers:{Cookie:'sferorumiya_session='+f.auth.token}});
  assert.equal(r.status,403);assert.equal(f.profiles.data.administration.audit.filter(e=>e.actorId==='system:integrity').length,1);
});
test('real WS shields repeat immediately, retries are free, broken shield can be recast without a ban', {timeout:10000},async t=>{
  const f=await fixture(t,true),spawnSerial=f.player().spawnSerial;
  const first={type:'useBooster',boosterId:'sphere',spawnSerial,requestId:randomUUID()};
  f.ws.send(JSON.stringify(first));assert.equal((await f.wait(p=>p.type==='boosterResult'&&p.requestId===first.requestId)).ok,true);
  assert.equal(f.profiles.find(f.auth.token).inventory.sphere,9);
  f.set(5100);const early={...first,requestId:randomUUID()};f.ws.send(JSON.stringify(early));
  const accepted=await f.wait(p=>p.type==='boosterResult'&&p.requestId===early.requestId);assert.equal(accepted.ok,true);
  f.ws.send(JSON.stringify(first));await new Promise(r=>setTimeout(r,25));assert.equal(f.profiles.find(f.auth.token).inventory.sphere,8);
  delete f.player().effects.sphere; // Same authoritative mutation as a hit from an awl.
  const replacement={...first,requestId:randomUUID()};f.ws.send(JSON.stringify(replacement));
  assert.equal((await f.wait(p=>p.type==='boosterResult'&&p.requestId===replacement.requestId)).ok,true);
  assert.equal(f.profiles.find(f.auth.token).inventory.sphere,7);assert.equal(f.profiles.find(f.auth.token).moderation?.ban||null,null);
});
test('one or a thousand direction commands per server tick have identical authoritative speed',()=>{
  const make=()=>{const a=new Arena({etherCount:0}),p=a.addPlayer(0,'moving');Object.assign(p,{x:1000,y:1000,targetX:1000,targetY:1000,protectedUntil:0});return{a,p};};
  const normal=make(),burst=make();
  for(let tick=1;tick<=20;tick++){
    for(const [f,count]of [[normal,1],[burst,1000]]){
      for(let i=0;i<count;i++)f.a.handleInput(f.p.id,{type:'move',x:9000,y:1000,spawnSerial:f.p.spawnSerial},tick*50);
      f.a.step(tick*50);
    }
    assert.equal(burst.p.x,normal.p.x);assert.equal(burst.p.y,normal.p.y);assert.equal(burst.p.mass,normal.p.mass);
  }
  assert(Math.abs(normal.p.x-1000-speedForMass(normal.p.mass))<1e-6);
});
test('Kill observes actual WS bursts while preserving server use limits and manual review only',{timeout:20000},async t=>{
  const f=await fixture(t,false);let sequence=0;
  for(let step=0;step<920;step++){
    f.set(5100+step*50);f.app.tick();
    if(step%20!==0)continue;
    const ids=[];
    for(let k=0;k<12;k++){
      const requestId=randomUUID();ids.push(requestId);
      f.ws.send(JSON.stringify({type:'useBooster',boosterId:k%2?'candy':'ice_cream',requestId,spawnSerial:f.player().spawnSerial}));sequence++;
    }
    await f.wait(p=>p.type==='boosterResult'&&p.requestId===ids.at(-1));
  }
  for(let n=0;n<50&&!f.profiles.byId(f.auth.profile.id).kill;n++)await new Promise(r=>setTimeout(r,5));
  const p=f.profiles.byId(f.auth.profile.id);assert.equal(p.kill?.status,'new');assert(!p.moderation?.ban);assert(sequence>500);
  assert(f.packets.some(p=>p.type==='boosterResult'&&!p.ok));
});
