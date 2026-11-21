'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {DurableRoom}=require('../../scripts/benchmarks/durable-resident/room.cjs');
const {roomProfile}=require('../../scripts/benchmarks/resident-room-processes/room-profile.cjs');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'room-reservation-latency-'));
 const store=new ProfileStore(),auth=store.open();
 store.transact(auth.token,randomUUID(),'fixture',p=>{p.level=600;p.progress=require('../../src/server/progression/experience-progression').freshProgress(600);p.inventory.meat=3;p.quickSlots=['meat'];});
 const sent=[],room=await DurableRoom.open({id:'latency-room',epoch:'latency-epoch',profiles:[roomProfile(store.byId(auth.profile.id))]},dir,m=>sent.push(m));
 t.after(async()=>{await room.close();await store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let at=performance.now();
 const tick=async()=>{room.tick(at+=50);await room.pending;
  for(const sequence of room.outbox.pendingSequences()){
   const e=room.outbox.entry(sequence);room.receiveAck({roomId:room.id,epoch:room.epoch,sequence,digest:e.digest,profiles:[]});
  }
 };
 await tick();const p=room.fixture.players[0];
 const command={boosterId:'meat',spawnSerial:p.spawnSerial,requestId:randomUUID(),aimX:p.x+100,aimY:p.y};
 room.request(p,command);await tick();
 const reserve=sent.find(m=>m.type==='reserve');assert(reserve);
 const respond=()=>room.receiveReservation({...reserve,type:'reservation',tx:{...reserve.input,profileId:p.profileId,status:'RESERVED'}});
 return {room,p,tick,respond,command};
}
test('Delayed profile reservation does not freeze room ticks; the effect waits for its durable reservation',async t=>{
 const f=await fixture(t),ticks=f.room.stats.ticks;
 for(let i=0;i<5;i++)await f.tick();
 assert.equal(f.room.stats.ticks,ticks+5);assert.equal(f.room.stats.applied,0);assert.equal(f.room.waiting.size,1);
 f.respond();await f.tick();assert.equal(f.room.stats.applied,1);assert.equal(f.room.waiting.size,0);
 f.respond();await f.tick();assert.equal(f.room.stats.applied,1);
});
test('A reservation returning after a life change is cancelled without applying its effect',async t=>{
 const f=await fixture(t);f.room.fixture.arena.resetPlayer(f.p,performance.now());
 f.respond();await f.tick();assert.equal(f.room.stats.applied,0);assert.equal(f.room.stats.cancelled,1);
 assert.equal(f.room.lastPublished.frame.cancelled.length,1);assert.equal(f.room.waiting.size,0);
});
