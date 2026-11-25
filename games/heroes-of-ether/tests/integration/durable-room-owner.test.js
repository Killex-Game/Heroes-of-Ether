'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const {temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store');
const {RoomProfileLedger}=require('../../src/server/arena/resident/room-profile-ledger');
const {RoomFixture}=require('../../scripts/benchmarks/resident-room-processes/room-fixture.cjs');
const {DurableRoomOwner}=require('../../scripts/benchmarks/resident-room-processes/durable-room-owner.cjs');
const {DurableRoomCasts}=require('../../scripts/benchmarks/resident-room-processes/durable-room-casts.cjs');
const {SocketInputs}=require('../../scripts/benchmarks/resident-room-processes/socket-inputs.cjs');
const records=require('../../src/server/arena/resident/room-cast-records');
async function fixture(t,{wall=Date.parse('2026-11-25T09:00:00Z')}={}){
 let cleanup,now=wall;const dir=temporary({after:f=>cleanup=f},'durable-room-owner');
 const store=new ProfileStore({filePath:path.join(dir,'profiles.json'),journal:true,residentRoomExperiment:true,now:()=>now});
 const auth=store.open();store.transact(auth.token,randomUUID(),'fixture',p=>{
  p.level=600;p.progress=require('../../src/server/progression/experience-progression').freshProgress(600);p.inventory.meat=5;p.quickSlots=['meat'];
 });
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});await once(child,'spawn');
 const profile=store.find(auth.token),room=new RoomFixture('room-0',[profile],1000,()=>{throw Error('Legacy progress must not publish');},randomUUID());
 room.wallNow=()=>now;room.socketInputs=new SocketInputs(room);
 const sent=[],network=[],commands=[],ledger=new RoomProfileLedger(store);
 await ledger.claim({roomId:room.id,epoch:room.epoch,profileIds:[profile.id]},child);
 const owner=await DurableRoomOwner.open(room,path.join(dir,'room.json'),m=>sent.push(m));
 room.casts=new DurableRoomCasts(room,m=>commands.push(m));
 const p=room.players[0],ws={playerId:p.id,readyState:1,send:message=>network.push(JSON.parse(message))};
 room.connectionsByPlayer.set(p.id,{ws});room.clients.add({ws,publish:snapshot=>network.push({type:'state',mass:snapshot.players.find(x=>x.id===p.id)?.mass})});
 const flush=async at=>{const result=await owner.tick(at);if(result)owner.acknowledge(await ledger.accept(child,result));return result;};
 t.after(async()=>{try{await owner.close();await ledger.chain;const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;await store.close();}finally{cleanup();}});
 await flush(1000);network.length=0;sent.length=0;
 const command=()=>({type:'booster',requestId:randomUUID(),boosterId:'meat',spawnSerial:p.spawnSerial});
 async function reserve(input){room.socketInputs.receive(ws,input);await flush(1100);
  const m=commands.at(-1),tx=await ledger.reserve(child,auth.token,m);
  room.casts.receive({type:'residentReserved',roomId:room.id,epoch:room.epoch,requestId:input.requestId,txId:m.txId,reservation:tx});
  return tx;
 }
 return {store,auth,room,p,ws,owner,ledger,child,network,sent,commands,flush,command,reserve,setNow:value=>{now=value;}};
}
test('actual room buffers effects, snapshots and successful socket ACK until room fsync; ledger credit occurs once',async t=>{
 const f=await fixture(t),command=f.command(),tx=await f.reserve(command),before=f.store.find(f.auth.token).progress.boosterUses;
 f.network.length=0;let release,entered;const waiting=new Promise(r=>entered=r),original=fs.fsync;
 const mock=t.mock.method(fs,'fsync',(fd,callback)=>{entered();release=()=>original(fd,callback);});
 const pending=f.owner.tick(1200);await waiting;
 assert.equal(f.p.boosterUses.meat,1);assert.equal(f.owner.tick(1250),false);assert.deepEqual(f.network,[]);
 release();const entry=await pending;mock.mock.restore();
 assert(f.network.some(m=>m.type==='state'));assert(f.network.some(m=>m.type==='boosterResult'&&m.ok));
 assert.equal(f.store.find(f.auth.token).progress.boosterUses,before);
 f.owner.acknowledge(await f.ledger.accept(f.child,entry));
 assert.equal(records.read(f.store.find(f.auth.token),tx.txId).status,'APPLIED');
 assert.equal(f.store.find(f.auth.token).inventory.meat,4);assert.equal(f.store.find(f.auth.token).progress.boosterUses,before+1);
 f.room.socketInputs.receive(f.ws,command);await f.flush(1300);
 assert.equal(f.p.boosterUses.meat,1);assert.equal(f.commands.length,1);assert.equal(f.room.casts.metrics.replays,1);
 assert.equal(f.store.find(f.auth.token).progress.boosterUses,before+1);
});
test('a reserved cast whose life ends is refunded through a durable frame without applying to the next life',async t=>{
 const f=await fixture(t),tx=await f.reserve(f.command());
 f.room.pendingLives.push({type:'lifeEnded',profileId:f.p.profileId,lifeId:f.p.lifeId,
  durationSeconds:0,durationMs:150,food:0,clanFood:0,reason:'exit'});
 f.p.dead=true;f.room.arena.resetPlayer(f.p,1150);f.room.populate(f.p,0,1150);
 const entry=await f.flush(1200);assert.equal(entry.frame.applied.length,0);assert.equal(entry.frame.cancelled.length,1);
 const saved=f.store.find(f.auth.token);assert.equal(saved.inventory.meat,5);assert.equal(records.read(saved,tx.txId).status,'REFUNDED');
 assert.equal(f.p.boosterUses.meat||0,0);assert(f.network.some(m=>m.type==='boosterResult'&&!m.ok));
});
test('room disk failure exposes no applied effect or success and fences subsequent ticks',async t=>{
 const f=await fixture(t);await f.reserve(f.command());f.network.length=0;
 const mock=t.mock.method(fs,'fsync',(_fd,callback)=>setImmediate(()=>callback(Error('injected owner disk failure'))));
 await assert.rejects(f.owner.tick(1200),/injected owner disk failure/);mock.mock.restore();
 assert.deepEqual(f.network,[]);assert.equal(f.owner.tick(1300),false);assert(f.owner.gate.fault);
});
test('position-only room frames publish without manufacturing empty progress journal entries',async t=>{
 let cleanup;const dir=temporary({after:f=>cleanup=f},'durable-empty-frame');let publications=0;
 const room={id:'empty-room',epoch:randomUUID(),metrics:{ticks:0},outbox:[],wallNow:()=>1000,
  tick(){this.metrics.ticks++;this.frameOwner.defer(()=>publications++);}};
 const owner=await DurableRoomOwner.open(room,path.join(dir,'room.json'),()=>{throw Error('No economic frame expected');});
 t.after(async()=>{try{await owner.close();}finally{cleanup();}});
 const mock=t.mock.method(fs,'fsync',()=>{throw Error('Empty frame must not fsync');});
 for(let i=0;i<100;i++)assert.equal(await owner.tick(1000+i*50),null);
 mock.mock.restore();assert.equal(publications,100);assert.equal(owner.outbox.sequence,0);assert.equal(owner.gate.fault,null);
});

test('owner journals the completed pre-cutoff state before consuming post-cutoff inputs',async t=>{
 const end=Date.parse('2026-11-25T19:00:00Z'),f=await fixture(t,{wall:end-1000});
 // Complete an ordinary real room tick shortly before the cutoff. It may be
 // position-only: that state must still be anchored before its boundary sample.
 f.setNow(end-25);await f.flush(1100);f.p.clanFoodCount=7;
 const ticks=f.room.metrics.ticks,sequence=f.owner.outbox.sequence;
 f.sent.length=0;f.network.length=0;f.setNow(end);
 const boundary=await f.owner.tick(1200);
 assert.equal(f.room.metrics.ticks,ticks);assert.deepEqual(f.network,[]);
 assert.equal(boundary.frame.kind,'boundary');assert.equal(boundary.frame.at,end-25);
 assert.equal(boundary.frame.boundaryAt,end);
 assert.deepEqual(boundary.frame.progress,[{type:'clanFoodSample',profileId:f.p.profileId,lifeId:f.p.lifeId,clanFood:7}]);
 const entries=f.sent.map(m=>m.entry);
 assert(entries.length>=1&&entries.length<=2);
 for(let i=0;i<entries.length;i++){
  assert.equal(entries[i].frame.sequence,sequence+i+1);
  f.owner.acknowledge(await f.ledger.accept(f.child,entries[i]));
 }
 assert.equal(f.store.data.residentRooms[f.room.id].at,end-25);
 // A post-cutoff watermark must be durable even if its physical tick emits
 // no progress, so settlement cannot wait indefinitely for the next reward.
 f.room.tick=()=>{f.room.metrics.ticks++;};f.setNow(end+1);
 const post=await f.flush(1250);assert.equal(post.frame.kind,'tick');assert.equal(post.frame.at,end+1);
 assert.equal(f.store.data.residentRooms[f.room.id].at,end+1);
 assert.equal(await f.owner.tick(1300),null);assert.equal(f.owner.outbox.sequence,post.frame.sequence);
});

test('clock discontinuity fails before room mutation or a public response',async t=>{
 const f=await fixture(t);const ticks=f.room.metrics.ticks;f.network.length=0;
 f.setNow(Date.parse('2026-11-27T09:00:00Z'));
 await assert.rejects(f.owner.tick(1200),/multiple quest windows/);
 assert.equal(f.room.metrics.ticks,ticks);assert.deepEqual(f.network,[]);
 assert(f.owner.gate.fault);assert.equal(f.owner.tick(1300),false);
});

test('boundary write failure fences the room before post-cutoff simulation or publication',async t=>{
 const end=Date.parse('2026-11-25T19:00:00Z'),f=await fixture(t,{wall:end-1000});
 const ticks=f.room.metrics.ticks;f.network.length=0;f.setNow(end);
 const mock=t.mock.method(fs,'fsync',(_fd,callback)=>setImmediate(()=>callback(Error('boundary disk failure'))));
 await assert.rejects(f.owner.tick(1200),/boundary disk failure/);mock.mock.restore();
 assert.equal(f.room.metrics.ticks,ticks);assert.deepEqual(f.network,[]);
 assert.equal(f.owner.tick(1300),false);assert(f.owner.gate.fault);
});

test('backwards clock fails even after an ephemeral frame with no journal write',async t=>{
 const f=await fixture(t),wall=Date.parse('2026-11-25T09:00:00Z');
 f.room.tick=()=>{f.room.metrics.ticks++;};f.setNow(wall+100);await f.owner.tick(1200);
 const ticks=f.room.metrics.ticks;f.setNow(wall+50);
 await assert.rejects(f.owner.tick(1250),/clock moved backwards/);
 assert.equal(f.room.metrics.ticks,ticks);assert(f.owner.gate.fault);
});
