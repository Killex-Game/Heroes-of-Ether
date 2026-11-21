"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {recover}=require('../../src/server/profiles/profile-journal');
const {RoomFixture}=require('../../scripts/benchmarks/resident-room-processes/room-fixture.cjs');
const {RoomProgressSink}=require('../../scripts/benchmarks/resident-room-processes/progress-sink.cjs');
const {DurableCasts}=require('../../scripts/benchmarks/resident-room-processes/durable-casts.cjs');
async function until(check){for(let i=0;i<500;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('Fixture timeout');}
function fixture(t,booster='meat',lateValidation=false){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resident-casts-')),filePath=path.join(dir,'profiles.json');
  const store=new ProfileStore({filePath,journal:true}),auth=store.open();
  store.transact(auth.token,randomUUID(),'fixture',p=>{p.level=600;
    p.progress=require('../../src/server/progression/experience-progression').freshProgress(600);
    p.inventory[booster]=3;p.quickSlots=[booster];});
  let room,casts;
  const child={connected:true,send:m=>setImmediate(()=>room.casts.receive(m))};
  room=new RoomFixture('room-0',[store.byId(auth.profile.id)],performance.now(),()=>{},'epoch-test',
    m=>setImmediate(()=>casts.receive(child,m)));
  const p=room.players[0];store.startLife(p.profileId,p.lifeId);
  const sink=new RoomProgressSink(store);sink.claim(room.id,room.epoch,[p.profileId]);
  casts=new DurableCasts(store,sink,new Map([[p.profileId,auth.token]]),{lateValidation});
  casts.claim(child,{id:room.id,epoch:room.epoch,profiles:[store.byId(p.profileId)]});
  t.after(async()=>{await casts.queue.running;await store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const command=()=>({boosterId:booster,spawnSerial:p.spawnSerial,requestId:randomUUID(),aimX:p.x+100,aimY:p.y});
  return{store,room,casts,p,child,filePath,command,auth};
}
test('resident cast spends durably before the room effect; replay never spends or applies twice',async t=>{
  const f=fixture(t),m=f.command(),mass=f.p.mass;f.room.casts.request(f.p,m);
  await until(()=>f.room.casts.metrics.applied===1);
  assert.equal(f.store.byId(f.p.profileId).inventory.meat,2);assert.ok(f.p.mass>mass);
  const saved=Object.values(recover(f.filePath).data.profiles).find(p=>p.id===f.p.profileId);
  assert.equal(saved.inventory.meat,2);assert.equal(saved.progress.maxMass,f.p.mass);
  const after=f.p.mass;
  // Replay the same transport envelope, without reconstructing a new input.
  f.casts.receive(f.child,{type:'castRequest',roomId:f.room.id,epoch:f.room.epoch,profileId:f.p.profileId,
    playerId:f.p.id,lifeId:f.p.lifeId,command:m,predictedMass:mass});
  await until(()=>f.room.casts.metrics.replays===1);
  assert.equal(f.p.mass,after);assert.equal(f.store.byId(f.p.profileId).inventory.meat,2);
});

test('non-mass resident casts keep room physics running while disk is staged',async t=>{
  const f=fixture(t,'rocket',true),stage=f.store.journal.stage.bind(f.store.journal);let release;
  t.mock.method(f.store.journal,'stage',async next=>{const proof=await stage(next);await new Promise(r=>release=r);return proof;});
  f.room.casts.request(f.p,f.command());await until(()=>release);
  assert.equal(f.room.casts.locked,false);
  assert.equal(f.store.byId(f.p.profileId).inventory.rocket,3);
  f.room.tickNo=3;f.room.tick(performance.now()+50);assert.equal(f.room.metrics.ticks,1);
  release();await until(()=>f.room.casts.metrics.applied===1);
  assert.equal(f.store.byId(f.p.profileId).inventory.rocket,2);
  assert.equal(f.room.casts.locked,false);
  assert.equal(Object.values(recover(f.filePath).data.profiles).find(p=>p.id===f.p.profileId).inventory.rocket,2);
});

test('late validation rejects a life which ended during staging without spending',async t=>{
  const f=fixture(t,'rocket',true),stage=f.store.journal.stage.bind(f.store.journal);let release;
  t.mock.method(f.store.journal,'stage',async next=>{const proof=await stage(next);await new Promise(r=>release=r);return proof;});
  f.room.casts.request(f.p,f.command());await until(()=>release);
  f.room.arena.resetPlayer(f.p,performance.now());release();
  await until(()=>f.room.casts.metrics.rejected===1);
  assert.equal(f.room.casts.metrics.applied,0);assert.equal(f.room.casts.locked,false);
  assert.equal(f.store.byId(f.p.profileId).inventory.rocket,3);
  assert.equal(Object.values(recover(f.filePath).data.profiles).find(p=>p.id===f.p.profileId).inventory.rocket,3);
});

test('durable casts retain unchanged nested histories without mutating the prior profile',async t=>{
  const f=fixture(t),before=f.store.byId(f.p.profileId),saved=structuredClone(before);
  f.room.casts.request(f.p,f.command());await until(()=>f.room.casts.metrics.applied===1);
  const after=f.store.byId(f.p.profileId);
  assert.deepEqual(before,saved);
  assert.equal(after.quests.pending,before.quests.pending);
  assert.equal(after.transactions,before.transactions);
  assert.equal(after.honors,before.honors);
  assert.notEqual(after.inventory,before.inventory);
  assert.equal(after.receipts,before.receipts);
  assert.notEqual(after.arenaReceipts,before.arenaReceipts);
  assert.deepEqual(Object.values(recover(f.filePath).data.profiles).find(p=>p.id===f.p.profileId),after);
});
test('failed fsync rejects the resident cast, preserving stock and mass',async t=>{
  const f=fixture(t),mass=f.p.mass;t.mock.method(f.store.journal,'stage',async()=>{throw Error('disk failed');});
  f.room.casts.request(f.p,f.command());await until(()=>f.room.casts.metrics.rejected===1);
  assert.equal(f.p.mass,mass);assert.equal(f.store.byId(f.p.profileId).inventory.meat,3);
  assert.equal(f.room.casts.locks.size,0);
});
test('a life ending before its reservation rejects without touching the next life',async t=>{
  const f=fixture(t),send=f.child.send;let release;
  f.child.send=m=>{if(m.type==='castValidate')release=()=>send(m);else send(m);};
  f.room.casts.request(f.p,f.command());await until(()=>release);
  f.room.arena.resetPlayer(f.p,performance.now());const mass=f.p.mass;release();
  await until(()=>f.room.casts.metrics.rejected===1);
  assert.equal(f.p.mass,mass);assert.equal(f.store.byId(f.p.profileId).inventory.meat,3);
  assert.equal(f.room.casts.locks.size,0);
});
test('room physics does not cross a reserved durable boundary',async t=>{
  const f=fixture(t),stage=f.store.journal.stage.bind(f.store.journal);let release;
  t.mock.method(f.store.journal,'stage',async next=>{const proof=await stage(next);await new Promise(r=>{release=r;});return proof;});
  f.room.casts.request(f.p,f.command());await until(()=>release);
  const mass=f.p.mass,serial=f.p.spawnSerial;
  assert.equal(f.room.casts.locked,true);f.room.tick(performance.now()+10000);
  assert.equal(f.room.metrics.ticks,0);assert.equal(f.p.mass,mass);assert.equal(f.p.spawnSerial,serial);
  assert.equal(f.store.byId(f.p.profileId).inventory.meat,3);
  release();await until(()=>f.room.casts.metrics.applied===1);
  assert.equal(f.room.casts.locked,false);assert.equal(f.store.byId(f.p.profileId).inventory.meat,2);
});
test('old epochs and another child cannot submit a cast for an owned room',async t=>{
  const f=fixture(t),m={type:'castRequest',roomId:f.room.id,epoch:f.room.epoch,profileId:f.p.profileId,
    playerId:f.p.id,lifeId:f.p.lifeId,command:f.command(),predictedMass:f.p.mass};
  assert.throws(()=>f.casts.receive({},m),/Unowned/);
  assert.throws(()=>f.casts.receive(f.child,{...m,epoch:'old'}),/Unowned/);
  assert.throws(()=>f.casts.receive(f.child,{...m,playerId:'another'}),/Unowned/);
  assert.throws(()=>f.casts.claim({}, {id:f.room.id,epoch:f.room.epoch,profiles:[f.store.byId(f.p.profileId)]}),/owner claim/);
  assert.throws(()=>f.casts.claim(f.child, {id:'unknown',epoch:f.room.epoch,profiles:[f.store.byId(f.p.profileId)]}),/owner claim/);
});

test('HTTP lobby purchases and resident casts share one durable action queue',async t=>{
  const f=fixture(t),lobby=f.store.open();
  const app=require('../../src/server/game-server').createGameServer({profiles:f.store,autoTick:false,
    externalBoosterQueue:f.casts.queue,testBots:{enabled:false,lobbyEnabled:false}});
  app.httpServer.listen(0,'127.0.0.1');await require('node:events').once(app.httpServer,'listening');
  const base='http://127.0.0.1:'+app.httpServer.address().port;
  const original=f.store.journal.stage.bind(f.store.journal);let release,first=true,active=0,peak=0;
  t.mock.method(f.store.journal,'stage',async next=>{
    active++;peak=Math.max(peak,active);
    try{const staged=await original(next);if(first){first=false;await new Promise(r=>release=r);}return staged;}
    finally{active--;}
  });
  const initial=f.store.find(lobby.token).wallet.coins;
  try{
    f.room.casts.request(f.p,f.command());await until(()=>release);
    const request=fetch(base+'/api/shop/buy',{method:'POST',headers:{Origin:base,
      Cookie:'sferorumiya_session='+lobby.token,'Content-Type':'application/json'},
      body:JSON.stringify({boosterId:'candy',requestId:randomUUID()})});
    await until(()=>f.casts.queue.waiting.length>0);
    assert.equal(f.store.find(lobby.token).wallet.coins,initial);
    release();const response=await request;assert.equal(response.status,200);
    await until(()=>f.room.casts.metrics.applied===1);
    assert.equal(peak,1);assert.equal(f.store.find(lobby.token).wallet.coins,initial-10);
    const saved=recover(f.filePath).data;
    assert.equal(Object.values(saved.profiles).find(p=>p.id===lobby.profile.id).wallet.coins,initial-10);
    assert.equal(f.room.lookup.get(f.p.profileId).quests,undefined);
    assert.equal(f.room.lookup.get(f.p.profileId).wallet,undefined);
  }finally{release?.();await app.close();}
});


test('lost commit ACK retries the original intent and applies once; a late ACK cannot apply again',async t=>{
  const f=fixture(t),send=f.child.send,m=f.command(),mass=f.p.mass;let lost;
  f.child.send=message=>{
    if(message.type==='castCommit'&&!lost){lost=message;return;}
    send(message);
  };
  f.room.casts.request(f.p,m);
  await until(()=>lost);
  assert.equal(f.store.byId(f.p.profileId).inventory.meat,2);
  assert.equal(f.p.mass,mass);assert.equal(f.room.casts.locked,true);
  const intent=f.room.casts.requests.get(m.requestId).intent;
  f.room.casts.retryPending(performance.now()+501);
  assert.equal(f.room.casts.requests.get(m.requestId).intent,intent);
  await until(()=>f.room.casts.metrics.applied===1);
  const after=f.p.mass;send(lost);
  await until(()=>f.room.casts.metrics.replays===1);
  assert.equal(f.p.mass,after);assert.equal(f.store.byId(f.p.profileId).inventory.meat,2);
  assert.equal(f.room.casts.requests.size,0);assert.equal(f.room.casts.locks.size,0);
  await until(()=>f.casts.commandReplies.size===0);
  assert.equal(Object.values(recover(f.filePath).data.profiles).find(p=>p.id===f.p.profileId).inventory.meat,2);
});

test('ten copies during fsync share one outcome and a changed command ID payload is rejected',async t=>{
  const f=fixture(t),stage=f.store.journal.stage.bind(f.store.journal);let release;
  t.mock.method(f.store.journal,'stage',async next=>{const proof=await stage(next);await new Promise(r=>release=r);return proof;});
  const m=f.command();f.room.casts.request(f.p,m);await until(()=>release);
  const intent=f.room.casts.requests.get(m.requestId).intent;
  for(let i=0;i<10;i++)f.casts.receive(f.child,structuredClone(intent));
  assert.throws(()=>f.casts.receive(f.child,{...intent,command:{...intent.command,boosterId:'rocket'}}),/Conflicting pending/);
  assert.equal(f.casts.metrics.submitted,1);assert.equal(f.store.byId(f.p.profileId).inventory.meat,3);
  release();await until(()=>f.room.casts.metrics.applied===1);
  assert.equal(f.store.byId(f.p.profileId).inventory.meat,2);assert.equal(f.casts.metrics.completed,1);
});

test('ten distinct clicks with one booster spend and apply exactly once',async t=>{
  const f=fixture(t);
  f.store.transact(f.auth.token,randomUUID(),'one-booster-fixture',p=>{p.inventory.meat=1;});
  for(let i=0;i<10;i++)f.room.casts.request(f.p,f.command());
  await until(()=>f.room.casts.requests.size===0);
  await f.casts.queue.running;
  assert.equal(f.room.casts.metrics.applied,1);
  assert.equal(f.room.casts.metrics.rejected,9);
  assert.equal(f.store.byId(f.p.profileId).inventory.meat,0);
  assert.equal(f.room.casts.locks.size,0);
  const saved=Object.values(recover(f.filePath).data.profiles).find(p=>p.id===f.p.profileId);
  assert.equal(saved.inventory.meat,0);
  assert.equal(saved.progress.boosterUses,1);
});

test('delayed ACK leaves the effect pending for 500ms without creating a new debit',async t=>{
  const f=fixture(t),send=f.child.send,mass=f.p.mass;let delayed;
  f.child.send=message=>{if(message.type==='castCommit')delayed=message;else send(message);};
  f.room.casts.request(f.p,f.command());await until(()=>delayed);
  await new Promise(resolve=>setTimeout(resolve,500));
  f.room.casts.retryPending(performance.now()+1);
  assert.equal(f.p.mass,mass);assert.equal(f.room.casts.requests.size,1);
  assert.equal(f.store.byId(f.p.profileId).inventory.meat,2);
  send(delayed);await until(()=>f.room.casts.metrics.applied===1);
  assert.equal(f.room.casts.requests.size,0);assert.equal(f.room.casts.locked,false);
});


test('resident lobby services retain the explicitly active event manager',async t=>{
  const f=fixture(t),lobby=f.store.open();
  const EventManager=require('../../src/server/events/event-manager').EventManager;
  const at=Math.floor(Date.now()/60000)*60000;
  const events=new EventManager({now:()=>at});
  events.apply('fixture','start',{requestId:randomUUID(),revision:events.data.revision,
    eventId:require('../../src/server/events/black-friday').manifest.id});
  f.store.events=events;
  const root=path.dirname(f.filePath);
  const services=await require('../../scripts/benchmarks/resident-room-processes/services.cjs').startServices(f.store,root,[lobby.token],f.casts.queue);
  try{assert.equal(f.store.events,events);assert.ok(f.store.events.active(at));}
  finally{await services.close();}
});

test('real socket inputs cannot split or feed a body held at its durable cast boundary',async t=>{
  const f=fixture(t),stage=f.store.journal.stage.bind(f.store.journal);let release;
  f.room.socketInputs=new (require('../../scripts/benchmarks/resident-room-processes/socket-inputs.cjs').SocketInputs)(f.room);
  t.mock.method(f.store.journal,'stage',async next=>{const proof=await stage(next);await new Promise(r=>release=r);return proof;});
  f.room.casts.request(f.p,f.command());await until(()=>release);
  const ws={playerId:f.p.id},before=structuredClone(f.room.arena.bodies(f.p));
  for(const [i,type]of ['feed','split'].entries())f.room.socketInputs.receive(ws,{type,spawnSerial:f.p.spawnSerial,sequence:i+1,x:f.p.x+100,y:f.p.y});
  f.room.tick(performance.now()+50);
  assert.equal(f.room.socketInputs.actions.length,2);
  assert.deepEqual(f.room.arena.bodies(f.p),before);
  release();await until(()=>f.room.casts.metrics.applied===1);
  f.room.tick(performance.now()+100);
  assert.equal(f.room.socketInputs.actions.length,0);
  assert.equal(f.store.byId(f.p.profileId).inventory.meat,2);
});
