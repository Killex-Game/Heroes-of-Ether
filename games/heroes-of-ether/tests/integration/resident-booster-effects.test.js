'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const {temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store');
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation');
const {stepRoom}=require('../../src/server/arena/room-step');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
const {RoomProfileLedger}=require('../../src/server/arena/resident/room-profile-ledger');
const {RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const {RoomFrameGate}=require('../../src/server/arena/resident/room-frame-gate');
const records=require('../../src/server/arena/resident/room-cast-records');
async function fixture(t,id){
 let cleanup;const root=temporary({after:f=>cleanup=f},'resident-actual-booster'),wall=Date.parse('2026-11-15T06:00:00Z'),at=5000;
 const store=new ProfileStore({filePath:path.join(root,'profiles.json'),journal:true,residentRoomExperiment:true,now:()=>wall});
 let child,box,ledger;
 const stop=async()=>{if(child && child.exitCode===null && child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}};
 t.after(async()=>{try{await stop();await box?.close();await ledger?.chain;await store.close();}finally{cleanup();}});
 const auth=store.open(),other=store.open();
 store.transact(auth.token,randomUUID(),'fixture',p=>{
  p.level=600;p.progress=require('../../src/server/progression/experience-progression').freshProgress(600);
  p.inventory[id]=2;p.quickSlots=[id];p.account=require('../../src/server/accounts/account-benefits').fresh();
  p.account.vipUntil=p.account.premiumUntil=wall+86400000;
  if(id==='easter_egg')p.easter={runs:{},chests:[],trophies:[],batches:[{count:2,expiresAt:require('../../src/server/events/easter-hunt').expiresAt(wall)}]};
 });
 const arena=new Arena({etherCount:0}),p=arena.addPlayer(at,'actor'),target=arena.addPlayer(at,'target');
 for(const [body,profile,x] of [[p,store.find(auth.token),1000],[target,store.find(other.token),1450]]){
  Object.assign(body,{profileId:profile.id,level:600,x,y:1000,targetX:x,targetY:1000,protectedUntil:0,stopped:true,
   account:require('../../src/server/accounts/account-benefits').publicAccount(profile,wall)});
  store.startLife(profile.id,body.lifeId);
 }
 p.parts=[0,1].map(i=>({id:'actor-part-'+i,x:1000+i*80,y:1000,mass:1000,radius:radiusForMass(1000),vx:0,vy:0,mergeAt:at+30000}));
 p.mainPartId=p.parts[0].id;arena.syncParts(p);target.mass=1500;target.radius=radiusForMass(1500);
 child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});await once(child,'spawn');
 ledger=new RoomProfileLedger(store);const identity={roomId:'room',epoch:randomUUID()};
 await ledger.claim({...identity,profileIds:[p.profileId,target.profileId]},child);
 const file=path.join(root,'room.json');box=await RoomOutbox.open({...identity,file});const gate=new RoomFrameGate(box);
 const command={boosterId:id,spawnSerial:p.spawnSerial,targetId:target.id,targetSpawnSerial:target.spawnSerial,aimX:1450,aimY:1000};
 const tx=await ledger.reserve(child,auth.token,{...identity,profileId:p.profileId,lifeId:p.lifeId,boosterId:id,
  txId:p.profileId+'_'+randomUUID(),intent:JSON.stringify(command)});
 const room={id:'room',arena,bots:{events:[],update:()=>[],clearIfIdle:()=>[]}};
 function simulate(){
  arena.prepareBooster(p.id,command,at)();
  const mass=p.mass,result=stepRoom(room,at+50,wall,store,35);
  return {applied:[{txId:tx.txId,profileId:p.profileId,lifeId:p.lifeId,boosterId:id,mass}],
   progress:result.progress.filter(e=>e.profileId && e.type!=='boosterUsed')};
 }
 return {store,auth,p,arena,tx,ledger,identity,child,box,gate,simulate,wall,stop,file};
}
for(const booster of [...BOOSTERS.values()].filter(b=>b.ready))test('resident durable pipeline applies actual '+booster.id+' exactly once',async t=>{
 const f=await fixture(t,booster.id),before=f.store.find(f.auth.token).progress.boosterUses;
 assert.equal(f.store.find(f.auth.token).inventory[booster.id],1);
 let published=false;
 const entry=await f.gate.advance({at:f.wall},f.simulate,()=>{published=true;});
 assert.equal(published,true);assert.equal(f.p.boosterUses[booster.id],1);
 assert.equal(f.store.find(f.auth.token).progress.boosterUses,before,'Room publication is not a profile ACK');
 const ack=await f.ledger.accept(f.child,entry);f.box.acknowledge(ack);
 const saved=f.store.find(f.auth.token);
 assert.equal(saved.inventory[booster.id],1);assert.equal(saved.progress.boosterUses,before+1);
 assert.equal(records.read(saved,f.tx.txId).status,'APPLIED');
 const snapshot=f.store.data;assert.deepEqual(await f.ledger.accept(f.child,entry),ack);
 assert.strictEqual(f.store.data,snapshot);assert.equal(f.box.acknowledge(ack),false);
});
test('actual private mass effect with failed room fsync is never published and its reservation is refunded on recovery',async t=>{
 const f=await fixture(t,'meat'),before=f.store.find(f.auth.token).progress.boosterUses;
 let published=false;
 const failure=t.mock.method(fs,'fsync',(_fd,cb)=>setImmediate(()=>cb(Error('injected room disk failure'))));
 await assert.rejects(f.gate.advance({at:f.wall},f.simulate,()=>{published=true;}),/injected room disk failure/);
 failure.mock.restore();assert.equal(published,false);assert.equal(f.p.boosterUses.meat,1);
 await f.box.close();await f.stop();await f.ledger.fenceStopped(f.identity,f.child);
 const box=await RoomOutbox.openExisting({...f.identity,file:f.file});
 try{await f.ledger.recoverStopped(box,f.child);}finally{await box.close();}
 const saved=f.store.find(f.auth.token);
 assert.equal(saved.inventory.meat,2);assert.equal(saved.progress.boosterUses,before);
 assert.equal(records.read(saved,f.tx.txId).status,'REFUNDED');
});
