'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {temporary}=require('../temp'),{RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const {planRoomRecovery}=require('../../src/server/arena/resident/room-recovery');
const identity={roomId:'room-a',epoch:'epoch-a'},profiles=['profile-a'];
const cast={txId:'cast-a',profileId:'profile-a',lifeId:'life-a',boosterId:'meat'};
const tx=(id='cast-a',status='RESERVED')=>({...identity,...cast,txId:id,status});
const cursor=(sequence=0,digest=null)=>({...identity,sequence,digest});
const ack=e=>cursor(e.frame.sequence,e.digest);
async function fixture(t){
 let cleanup;const root=temporary({after:f=>cleanup=f},'room-recovery'),file=path.join(root,'room.json'),boxes=[];
 const open=async recovery=>{const box=await RoomOutbox[recovery?'openExisting':'open']({...identity,file});boxes.push(box);return box;};
 t.after(async()=>{try{for(const box of boxes)await box.close();}finally{cleanup();}});
 return {file,open};
}
test('recovery distinguishes durable applied casts from reservations with no published effect',async t=>{
 const f=await fixture(t),writer=await f.open();
 const first=await writer.append({at:1,progress:[{type:'massPeak',profileId:'profile-a',mass:25}],applied:[cast]});
 const last=await writer.append({at:2,kind:'boundary'});await writer.close();
 const box=await f.open(true),plan=planRoomRecovery(box,cursor(),[tx(),tx('never-applied')],profiles);
 assert.deepEqual(plan.frames,[first,last]);assert.deepEqual(plan.outcomes,[{txId:'cast-a',status:'APPLIED'},{txId:'never-applied',status:'REFUNDED'}]);
 assert.deepEqual(plan.watermark,{sequence:2,digest:last.digest});
 // The plan is a detached value; inspecting/editing it cannot change recovery evidence.
 plan.frames[0].frame.progress[0].mass=999;assert.equal(box.list()[0].frame.progress[0].mass,25);
 await assert.rejects(box.append({at:3}),/cannot advance/);
});
test('receiver replay uses its durable prefix and never refunds a previously applied cast',async t=>{
 const f=await fixture(t),writer=await f.open();
 const first=await writer.append({at:1,applied:[cast]});
 const second=await writer.append({at:2,progress:[{type:'massPeak',profileId:'profile-a',mass:50}]});
 await writer.close();const box=await f.open(true);
 const plan=planRoomRecovery(box,ack(first),[tx('cast-a','APPLIED')],profiles);
 assert.deepEqual(plan.frames,[second]);assert.deepEqual(plan.outcomes,[]);
 assert.throws(()=>planRoomRecovery(box,ack(first),[tx()],profiles),/unresolved cast/);
 assert.throws(()=>planRoomRecovery(box,cursor(1,'wrong'),[tx('cast-a','APPLIED')],profiles),/checksum/);
});
test('missing journal cannot be treated as proof that reserved boosters should be returned',async t=>{
 const f=await fixture(t);await assert.rejects(f.open(true),/missing/);
 assert.equal(fs.existsSync(f.file),false);assert.equal(fs.existsSync(f.file+'.wal'),false);assert.equal(fs.existsSync(f.file+'.lock'),false);
 const writer=await f.open();await writer.close();const box=await f.open(true);
 assert.deepEqual(planRoomRecovery(box,cursor(),[tx()],profiles).outcomes,[{txId:'cast-a',status:'REFUNDED'}]);
});
test('recovery refuses another writer, epoch, incomplete receiver, foreign progress and cast conflicts',async t=>{
 const f=await fixture(t),writer=await f.open();
 assert.throws(()=>planRoomRecovery(writer,cursor(),[tx()],profiles),/existing room journal/);
 await assert.rejects(f.open(true),/уже работает/);
 const first=await writer.append({at:1,applied:[cast]});writer.acknowledge(ack(first));
 await writer.close();const box=await f.open(true);
 assert.throws(()=>planRoomRecovery(box,cursor(),[tx()],profiles),/watermark/);
 assert.throws(()=>planRoomRecovery(box,{...ack(first),epoch:'other'},[tx()],profiles),/epoch/);
 assert.throws(()=>planRoomRecovery(box,cursor(2,'future'),[tx()],profiles),/watermark/);
 assert.deepEqual(planRoomRecovery(box,ack(first),[tx('cast-a','APPLIED')],profiles).outcomes,[]);
});
test('cast identity, refund contradictions and foreign progress fail before a recovery plan is returned',async t=>{
 const f=await fixture(t),writer=await f.open();await writer.append({at:1,applied:[cast]});await writer.close();
 const box=await f.open(true);
 for(const records of [[],[tx('cast-a','REFUNDED')],[{...tx(),lifeId:'other'}],[{...tx(),boosterId:'shield'}]])
  assert.throws(()=>planRoomRecovery(box,cursor(),records,profiles),/Conflicting/);
 assert.throws(()=>planRoomRecovery(box,cursor(),[tx(),tx()],profiles),/Invalid/);
 assert.throws(()=>planRoomRecovery(box,cursor(),[{...tx(),epoch:'other'}],profiles),/Invalid/);
 const f2=await fixture(t),other=await f2.open();await other.append({at:1,progress:[{profileId:'outside',type:'massPeak'}]});await other.close();
 assert.throws(()=>planRoomRecovery(other,cursor(),[],profiles),/existing/);
 const recovered=await f2.open(true);assert.throws(()=>planRoomRecovery(recovered,cursor(),[],profiles),/Unowned/);
});
