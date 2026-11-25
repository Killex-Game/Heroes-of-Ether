'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fork}=require('node:child_process'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const {WebSocket}=require('ws'),{temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store');
const {DurableRoomCoordinator}=require('../../scripts/benchmarks/resident-room-processes/durable-room-coordinator.cjs');
const {roomProfile}=require('../../scripts/benchmarks/resident-room-processes/room-profile.cjs');
const {RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const records=require('../../src/server/arena/resident/room-cast-records');
function waitMessage(child,type,id){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{cleanup();reject(Error('Timed out '+type));},10000);
 const listener=m=>{if(m.type==='fault'){cleanup();reject(Error(m.message));}else if(m.type===type&&(id===undefined||m.id===id)){cleanup();resolve(m);}};
 const exit=code=>{cleanup();reject(Error('Child exited '+code));};
 function cleanup(){clearTimeout(timer);child.off('message',listener);child.off('exit',exit);}
 child.on('message',listener);child.on('exit',exit);
});}
for(const holdAppliedFrame of [false,true])test('real room crash preserves one WebSocket-confirmed effect; hold profile publication='+holdAppliedFrame,async t=>{
 let cleanup;const dir=temporary({after:f=>cleanup=f},'durable-owner-ipc'),wall=Date.parse('2026-11-25T09:00:00Z');
 const store=new ProfileStore({filePath:path.join(dir,'profiles.json'),journal:true,residentRoomExperiment:true,now:()=>wall});
 const auth=store.open();store.transact(auth.token,randomUUID(),'fixture',p=>{p.inventory.meat=3;p.quickSlots=['meat'];});
 const profile=store.find(auth.token),child=fork(path.join(__dirname,'../fixtures/durable-room-owner-child.cjs'),[],{stdio:['ignore','ignore','pipe','ipc'],serialization:'advanced',windowsHide:true});
 const coordinator=new DurableRoomCoordinator(store,new Map([[profile.id,auth.token]])),identity={roomId:'room-0',epoch:randomUUID()},file=path.join(dir,'room.json');
 let ws,box,latest;const decoder=new (require('../../public/shared/arena-wire').Decoder)();const replies=[];let stderr='';child.stderr.on('data',b=>stderr+=b);
 const held=[];
 child.on('message',m=>{if(m.type==='residentFrame'&&holdAppliedFrame&&m.entry.frame.applied.length){held.push(m);return;}
  if(['residentReserve','residentFrame'].includes(m.type))coordinator.receive(child,m);});
 t.after(async()=>{try{ws?.terminate();if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}await coordinator.idle();await box?.close();await store.close();}finally{cleanup();}});
 await coordinator.claim(child,{id:identity.roomId,epoch:identity.epoch,profiles:[profile]});
 const ready=waitMessage(child,'ready'),key=randomUUID();child.send({type:'init',...identity,profiles:[roomProfile(profile)],wall,file,key});
 const address=await ready;ws=new WebSocket('ws://127.0.0.1:'+address.port+'/?index=0&key='+key);
 ws.on('message',bytes=>{const m=JSON.parse(bytes);replies.push(m);if(m.type==='state'){latest=decoder.decode(m);if(Number.isSafeInteger(m.sequence))ws.send(JSON.stringify({type:'stateAck',sequence:m.sequence}));}});
 await once(ws,'open');
 let at=1000,sequence=0;
 async function tick(){const id=++sequence,done=waitMessage(child,'tickDone',id);child.send({type:'tick',at:at+=50,id});const result=await done;await coordinator.idle();
  const barrier=waitMessage(child,'barrierDone',id);child.send({type:'barrier',id});await barrier;return result;}
 await tick();for(let i=0;i<20&&!latest;i++)await new Promise(r=>setTimeout(r,5));
 const spawnSerial=latest.players[0].spawnSerial;assert(Number.isSafeInteger(spawnSerial));
 const usesBefore=store.find(auth.token).progress.boosterUses;
 const requestId=randomUUID();ws.send(JSON.stringify({type:'booster',requestId,boosterId:'meat',spawnSerial}));
 let state;for(let i=0;i<20&&!replies.some(m=>m.type==='boosterResult');i++){await new Promise(r=>setTimeout(r,5));state=await tick();}
 assert(replies.some(m=>m.type==='boosterResult'&&m.requestId===requestId&&m.ok),JSON.stringify(replies.filter(m=>m.type==='boosterResult'))+stderr);
 assert.equal(state.stats.applied,1);assert.equal(store.find(auth.token).inventory.meat,2);
 assert.equal(records.read(store.find(auth.token),profile.id+'_'+requestId).status,holdAppliedFrame?'RESERVED':'APPLIED');
 if(holdAppliedFrame){assert(held.length>0);assert.equal(store.find(auth.token).progress.boosterUses,usesBefore);}
 ws.send(JSON.stringify({type:'booster',requestId,boosterId:'meat',spawnSerial}));await new Promise(r=>setTimeout(r,10));await tick();
 assert.equal(store.find(auth.token).inventory.meat,2);
 const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;await coordinator.idle();
 await coordinator.ledger.fenceStopped(identity,child);box=await RoomOutbox.openExisting({...identity,file});
 await coordinator.ledger.recoverStopped(box,child);
 assert.equal(store.find(auth.token).inventory.meat,2);assert.equal(store.find(auth.token).progress.boosterUses,usesBefore+1);
 assert.equal(records.read(store.find(auth.token),profile.id+'_'+requestId).status,'APPLIED');
 assert.equal(store.data.residentRooms[identity.roomId].status,'CLOSED');
});
