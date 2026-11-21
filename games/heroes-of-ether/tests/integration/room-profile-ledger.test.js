'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
const {temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store');
const {recover}=require('../../src/server/profiles/profile-journal');
const {RoomProfileLedger}=require('../../src/server/arena/resident/room-profile-ledger');
const {RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const records=require('../../src/server/arena/resident/room-cast-records');
async function fixture(t, ledgerOptions, memberCount=1){
 let cleanup;const root=temporary({after:f=>cleanup=f},'room-profile-ledger'),filePath=path.join(root,'profiles.json');
 let at=Date.parse('2026-11-15T06:00:00Z');
 const store=new ProfileStore({filePath,journal:true,residentRoomExperiment:true,now:()=>at});
 const auth=store.open(),id=auth.profile.id,lifeId=randomUUID();
 store.transact(auth.token,randomUUID(),'fixture',p=>{p.inventory.meat=5;p.quickSlots=['meat'];});
 store.startLife(id,lifeId);
 const additional=[];
 for(let i=1;i<memberCount;i++){
  const auth=store.open(),id=auth.profile.id,lifeId=randomUUID();
  store.transact(auth.token,randomUUID(),'fixture',p=>{p.inventory.meat=5;p.quickSlots=['meat'];});
  store.startLife(id,lifeId);additional.push({auth,id,lifeId});
 }
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
 await once(child,'spawn');
 const ledger=new RoomProfileLedger(store,ledgerOptions),identity={roomId:'room-a',epoch:'epoch-a'};
 await ledger.claim({...identity,profileIds:[id,...additional.map(p=>p.id)]},child);
 const boxes=[],file=path.join(root,'room.json');
 const open=async(recovery=false)=>{const b=await RoomOutbox[recovery?'openExisting':'open']({...identity,file});boxes.push(b);return b;};
 const stop=async()=>{if(child.exitCode!==null || child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGKILL');await done;};
 const input=(extra={})=>({...identity,lifeId,boosterId:'meat',txId:id+'_'+randomUUID(),intent:'meat-at-cursor',...extra});
 const cast=tx=>({txId:tx.txId,profileId:id,lifeId,boosterId:tx.boosterId,mass:75});
 t.after(async()=>{try{await stop();for(const box of boxes)await box.close();await ledger.chain;await store.close();}finally{cleanup();}});
 return {root,filePath,store,auth,id,lifeId,child,ledger,identity,open,stop,input,cast,additional,at:()=>at,setAt:value=>{at=value;}};
}
test('one frame resolves several profiles and outcomes atomically; invalid tail and failed fsync retain all reservations',async t=>{
 const f=await fixture(t,undefined,2),other=f.additional[0];
 const a=await f.ledger.reserve(f.child,f.auth.token,f.input());
 const b=await f.ledger.reserve(f.child,f.auth.token,f.input());
 const input=()=>f.input({txId:other.id+'_'+randomUUID(),lifeId:other.lifeId});
 const c=await f.ledger.reserve(f.child,other.auth.token,input());
 const d=await f.ledger.reserve(f.child,other.auth.token,input());
 const cast=tx=>({...f.cast(tx),profileId:tx.profileId,lifeId:tx.lifeId});
 const before=f.store.data,saved=structuredClone(before);
 function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}}
 freeze(before);
 const box=await f.open(),entry=await box.append({at:f.at(),applied:[a,c,d].map(cast),cancelled:[cast(b)]});
 const invalid=structuredClone(entry);invalid.frame.applied.push({...cast(a),txId:f.id+'_'+randomUUID()});
 invalid.digest=createHash('sha256').update(JSON.stringify(invalid.frame)).digest('hex');
 await assert.rejects(f.ledger.accept(f.child,invalid),/reservation/);
 assert.equal(f.store.data,before);assert.deepEqual(before,saved);
 const failure=t.mock.method(fs,'fsync',(fd,callback)=>callback(Error('multi-profile write failure')));
 await assert.rejects(f.ledger.accept(f.child,entry),/multi-profile write failure/);failure.mock.restore();
 assert.equal(f.store.data,before);assert.deepEqual(before,saved);
 const ack=await f.ledger.accept(f.child,entry);box.acknowledge(ack);
 const own=f.store.byId(f.id),second=f.store.byId(other.id);
 assert.equal(own.inventory.meat,4);assert.equal(own.progress.boosterUses,1);
 assert.equal(second.inventory.meat,3);assert.equal(second.progress.boosterUses,2);
 for(const tx of [a,c,d])assert.equal(records.read(f.store.byId(tx.profileId),tx.txId).status,'APPLIED');
 assert.equal(records.read(own,b.txId).status,'REFUNDED');
 const committed=structuredClone(f.store.data);
 assert.deepEqual(await f.ledger.accept(f.child,entry),ack);
 assert.deepEqual(f.store.data,committed);
 const restored=recover(f.filePath);
 assert.equal(restored.revision,f.store.journal.revision);
 assert.deepEqual(restored.data,{...committed,_journalRevision:restored.revision});
 assert.deepEqual(before,saved);
});
for(const maxBuildMs of [1,8,16,32])test(`resident reserve, application and frame watermark stay durable with ${maxBuildMs}ms scheduling budget`,async t=>{
 const f=await fixture(t,{maxBuildMs}),before=structuredClone(f.store.find(f.auth.token)),input=f.input();
 const tx=await f.ledger.reserve(f.child,f.auth.token,input);
 assert.equal(tx.status,'RESERVED');assert.equal(f.store.find(f.auth.token).inventory.meat,4);
 assert.equal(f.store.find(f.auth.token).progress.boosterUses,before.progress.boosterUses);
 assert.equal(f.store.find(f.auth.token).progress.maxMass,before.progress.maxMass);
 assert.equal(Object.values(recover(f.filePath).data.profiles)[0].inventory.meat,4);
 assert.deepEqual(await f.ledger.reserve(f.child,f.auth.token,input),tx);
 await assert.rejects(f.ledger.reserve(f.child,f.auth.token,{...input,intent:'different-target'}),/Conflicting/);
 const box=await f.open(),entry=await box.append({at:f.at(),applied:[f.cast(tx)],progress:[{type:'massPeak',profileId:f.id,mass:100}]});
 const ack=await f.ledger.accept(f.child,entry);box.acknowledge(ack);
 const p=f.store.find(f.auth.token);assert.equal(p.progress.boosterUses,before.progress.boosterUses+1);
 assert.equal(p.progress.maxMass,100);assert.equal(p.inventory.meat,4);assert.equal(records.read(p,tx.txId).status,'APPLIED');
 assert.deepEqual(p.residentCasts,{});assert.deepEqual(await f.ledger.accept(f.child,entry),ack);
 assert.equal(f.store.find(f.auth.token).progress.boosterUses,before.progress.boosterUses+1);
 const saved=recover(f.filePath).data;assert.equal(saved.residentRooms['room-a'].sequence,1);
 assert.equal(records.read(Object.values(saved.profiles)[0],tx.txId).status,'APPLIED');
});

test('invalid ledger budgets fail before installing a settlement hook',async t=>{
 const f=await fixture(t),hook=f.store.clanQuestSettlementReady;
 for(const maxBuildMs of [0,-1,33,NaN,Infinity,'16'])
  assert.throws(()=>new RoomProfileLedger(f.store,{maxBuildMs}),/build budget/);
 assert.equal(f.store.clanQuestSettlementReady,hook);
});

test('serialized frame keeps canonical hash, durable outcome, replay and private input semantics',async t=>{
 const f=await fixture(t),tx=await f.ledger.reserve(f.child,f.auth.token,f.input()),box=await f.open();
 const entry=await box.append({at:f.at(),applied:[f.cast(tx)],progress:[{type:'massPeak',profileId:f.id,mass:321}]});
 const bytes=box.serializedEntry(1),before=f.store.data;
 const altered=JSON.parse(bytes);altered.frame.progress[0].mass=999;
 await assert.rejects(f.ledger.acceptSerialized(f.child,JSON.stringify(altered)),/envelope/);
 await assert.rejects(f.ledger.acceptSerialized({},bytes),/unowned/);
 await assert.rejects(f.ledger.acceptSerialized(f.child,'{'),/Invalid serialized/);
 await assert.rejects(f.ledger.acceptSerialized(f.child,'x'.repeat(2*1024*1024+129)),/byte budget/);
 await assert.rejects(f.ledger.acceptSerialized(f.child,JSON.stringify({extra:'я'.repeat(1100000)})),/byte budget/);
 assert.equal(f.store.data,before);assert.equal(f.ledger.serializedBytes,0);
 const result=await f.ledger.acceptSerialized(f.child,bytes);
 assert.deepEqual(result.profileIds,[f.id]);assert.equal(f.ledger.serializedBytes,0);
 assert.deepEqual(await f.ledger.accept(f.child,entry),result.ack);
 assert.deepEqual(await f.ledger.acceptSerialized(f.child,bytes),result);
 assert.equal(f.store.byId(f.id).progress.maxMass,321);assert.equal(f.store.byId(f.id).progress.boosterUses,1);
 assert.equal(f.store.byId(f.id).inventory.meat,4);
 box.acknowledge(result.ack);
 assert.equal(records.read(Object.values(recover(f.filePath).data.profiles)[0],tx.txId).status,'APPLIED');
});

test('serialized application rejects failed durability and retries the same prefix without lost reservation',async t=>{
 const f=await fixture(t),tx=await f.ledger.reserve(f.child,f.auth.token,f.input()),box=await f.open();
 await box.append({at:f.at(),applied:[f.cast(tx)]});const bytes=box.serializedEntry(1),before=f.store.data;
 const mock=t.mock.method(fs,'fsync',(fd,callback)=>callback(Error('serialized disk failure')));
 await assert.rejects(f.ledger.acceptSerialized(f.child,bytes),/serialized disk failure/);mock.mock.restore();
 assert.equal(f.store.data,before);assert.equal(f.ledger.serializedBytes,0);
 assert.equal(records.read(f.store.byId(f.id),tx.txId).status,'RESERVED');
 const {ack}=await f.ledger.acceptSerialized(f.child,bytes);box.acknowledge(ack);
 assert.equal(f.store.byId(f.id).progress.boosterUses,1);
 await box.close();await f.stop();await f.ledger.fenceStopped(f.identity,f.child);
 await f.ledger.recoverStopped(await f.open(true),f.child);
 assert.equal(f.store.byId(f.id).progress.boosterUses,1);assert.equal(f.store.byId(f.id).inventory.meat,4);
});
test('fenced recovery atomically keeps applied progress and refunds only an unapplied reservation',async t=>{
 const f=await fixture(t),before=f.store.find(f.auth.token).progress.boosterUses;
 const applied=await f.ledger.reserve(f.child,f.auth.token,f.input()),unused=await f.ledger.reserve(f.child,f.auth.token,f.input());
 const box=await f.open();await box.append({at:f.at(),applied:[f.cast(applied)],progress:[{type:'massPeak',profileId:f.id,mass:250}]});
 await assert.rejects(f.ledger.fenceStopped(f.identity,f.child),/still alive/);
 await box.close();await f.stop();await f.ledger.fenceStopped(f.identity,f.child);
 const evidence=await f.open(true),closed=await f.ledger.recoverStopped(evidence,f.child);
 assert.equal(closed.status,'CLOSED');assert.equal(closed.sequence,1);
 const p=f.store.find(f.auth.token);assert.equal(p.inventory.meat,4);assert.equal(p.progress.boosterUses,before+1);assert.equal(p.progress.maxMass,250);
 assert.equal(records.read(p,applied.txId).status,'APPLIED');assert.equal(records.read(p,unused.txId).status,'REFUNDED');
 assert.deepEqual(p.residentCasts,{});
 const restored=recover(f.filePath).data;assert.equal(restored.residentRooms['room-a'].status,'CLOSED');
 assert.equal(Object.values(restored.profiles)[0].inventory.meat,4);
 await assert.rejects(f.ledger.reserve(f.child,f.auth.token,f.input()),/Stale/);
 assert.deepEqual(await f.ledger.recoverStopped(evidence,f.child),closed);
});
test('normal game refuses experimental worlds; explicit experimental reload preserves outstanding reservation',async t=>{
 const f=await fixture(t),tx=await f.ledger.reserve(f.child,f.auth.token,f.input());
 assert.throws(()=>new ProfileStore({filePath:f.filePath}),/формат/);
 const read=new ProfileStore({filePath:f.filePath,residentRoomExperiment:true,now:f.at});
 assert.equal(records.read(read.byId(f.id),tx.txId).status,'RESERVED');
 assert.equal(read.byId(f.id).inventory.meat,4);await read.close();
});
test('frame gaps, foreign owners, changed request and duplicate success events are rejected without mutation',async t=>{
 const f=await fixture(t),tx=await f.ledger.reserve(f.child,f.auth.token,f.input()),box=await f.open();
 const entry=await box.append({at:f.at(),applied:[f.cast(tx)]}),before=f.store.data;
 await assert.rejects(f.ledger.accept({},entry),/unowned/);
 await assert.rejects(f.ledger.accept(f.child,{...entry,frame:{...entry.frame,sequence:2}}),/envelope/);
 assert.strictEqual(f.store.data,before);
 const bad=await box.append({at:f.at(),progress:[{type:'boosterUsed',profileId:f.id}]});
 await f.ledger.accept(f.child,entry);
 await assert.rejects(f.ledger.accept(f.child,bad),/duplicate booster/);
 assert.equal(f.store.data.residentRooms['room-a'].sequence,1);
});
test('failed fsync neither publishes reservation nor credits progress, and identical retry succeeds',async t=>{
 const f=await fixture(t),input=f.input(),before=f.store.data;
 const flush=fs.fsync;let fail=true;
 const mock=t.mock.method(fs,'fsync',(fd,callback)=>fail?callback(Error('disk unavailable')):flush(fd,callback));
 await assert.rejects(f.ledger.reserve(f.child,f.auth.token,input),/disk unavailable/);
 assert.strictEqual(f.store.data,before);assert.equal(records.read(f.store.byId(f.id),input.txId),null);
 fail=false;await f.ledger.reserve(f.child,f.auth.token,input);mock.mock.restore();
 assert.equal(f.store.byId(f.id).inventory.meat,4);
});

test('a racing lobby wallet commit rebuilds reservation without double debit or lost balance',async t=>{
 const f=await fixture(t),input=f.input(),before=f.store.byId(f.id).wallet.coins,flush=fs.fsync;
 let finish,hold=true;
 const mock=t.mock.method(fs,'fsync',(fd,callback)=>{if(hold)finish=()=>flush(fd,callback);else flush(fd,callback);});
 const writing=f.ledger.reserve(f.child,f.auth.token,input);
 while(!finish)await new Promise(r=>setImmediate(r));
 f.store.transact(f.auth.token,randomUUID(),'lobby-credit',p=>{p.wallet.coins+=17;});
 hold=false;finish();await writing;mock.mock.restore();
 assert.equal(f.store.byId(f.id).wallet.coins,before+17);assert.equal(f.store.byId(f.id).inventory.meat,4);
 assert.equal(records.read(f.store.byId(f.id),input.txId).status,'RESERVED');
});

test('failed application fsync keeps reservation and cursor together, then retry credits once',async t=>{
 const f=await fixture(t),tx=await f.ledger.reserve(f.child,f.auth.token,f.input()),box=await f.open();
 const entry=await box.append({at:f.at(),applied:[f.cast(tx)]}),before=f.store.data,flush=fs.fsync;
 const mock=t.mock.method(fs,'fsync',(fd,callback)=>callback(Error('application disk failure')));
 await assert.rejects(f.ledger.accept(f.child,entry),/application disk failure/);mock.mock.restore();
 assert.strictEqual(f.store.data,before);assert.equal(records.read(f.store.byId(f.id),tx.txId).status,'RESERVED');
 assert.equal(recover(f.filePath).data.residentRooms['room-a'].sequence,0);
 await f.ledger.accept(f.child,entry);assert.equal(records.read(f.store.byId(f.id),tx.txId).status,'APPLIED');
 assert.equal(f.store.byId(f.id).inventory.meat,4);
});

test('unapplied seasonal booster returns to its original lot and cannot renew an expired lifetime',async t=>{
 for(const expired of [false,true]) {
  const f=await fixture(t),deadline=require('../../src/server/events/easter-hunt').expiresAt(f.at());
  f.store.transact(f.auth.token,randomUUID(),'seasonal-fixture',p=>{
    p.inventory.easter_egg=2;p.easter={runs:{},chests:[],trophies:[],batches:[{count:2,expiresAt:deadline}]};p.quickSlots=['easter_egg'];
  });
  const tx=await f.ledger.reserve(f.child,f.auth.token,f.input({boosterId:'easter_egg'}));
  assert.equal(tx.expiresAt,deadline);assert.equal(f.store.byId(f.id).inventory.easter_egg,1);
  const box=await f.open();await box.close();await f.stop();await f.ledger.fenceStopped(f.identity,f.child);
  if(expired)f.setAt(deadline+1);
  await f.ledger.recoverStopped(await f.open(true),f.child);
  const p=f.store.byId(f.id);assert.equal(p.inventory.easter_egg,expired?0:2);
  assert.deepEqual(p.easter.batches,expired?[]:[{count:2,expiresAt:deadline}]);
  assert.equal(records.read(p,tx.txId).status,'REFUNDED');assert.equal(records.read(p,tx.txId).expiresAt,deadline);
 }
});

test('reservation pressure rejects before debit and replay remains available at the limit',async t=>{
 const f=await fixture(t);f.store.transact(f.auth.token,randomUUID(),'inventory-fixture',p=>{p.inventory.meat=20;});
 const inputs=Array.from({length:8},()=>f.input());
 await Promise.all(inputs.map(input=>f.ledger.reserve(f.child,f.auth.token,input)));
 assert.equal(f.store.byId(f.id).inventory.meat,12);
 await assert.rejects(f.ledger.reserve(f.child,f.auth.token,f.input()),/full/);
 await f.ledger.reserve(f.child,f.auth.token,inputs[0]);assert.equal(f.store.byId(f.id).inventory.meat,12);
});

test('coordinator restart binds only exclusive recovery evidence and returns unresolved hold once',async t=>{
 const f=await fixture(t),tx=await f.ledger.reserve(f.child,f.auth.token,f.input()),writer=await f.open();
 await writer.close();await f.stop();await f.store.close();
 const store=new ProfileStore({filePath:f.filePath,journal:true,residentRoomExperiment:true,now:f.at});
 try {
  const ledger=new RoomProfileLedger(store),evidence=await f.open(true);
  await ledger.bindRecovery(evidence);await ledger.recoverStopped(evidence,evidence);
  assert.equal(store.byId(f.id).inventory.meat,5);assert.equal(records.read(store.byId(f.id),tx.txId).status,'REFUNDED');
  await ledger.recoverStopped(evidence,evidence);assert.equal(store.byId(f.id).inventory.meat,5);
  await assert.rejects(ledger.accept(evidence,{frame:{...f.identity,sequence:1}}),/Stale/);
 }finally{await store.close();}
});

test('SIGKILL across reserve/apply/receiver boundaries recovers both WALs without lost credit or duplicate use',async t=>{
 for(const mode of ['reserved','applied','received']) {
  let cleanup;const root=temporary({after:f=>cleanup=f},'resident-crash-'+mode);
  let store,box;
  try {
   const child=spawn(process.execPath,[path.resolve(__dirname,'../fixtures/room-profile-ledger-crash.cjs'),root,mode],
    {stdio:['ignore','ignore','pipe'],windowsHide:true});let stderr='';child.stderr.on('data',b=>stderr+=b);
   const [code,signal]=await once(child,'exit');assert.ok(code!==0 || signal,stderr);
   const saved=JSON.parse(fs.readFileSync(path.join(root,'fixture.json'),'utf8'));
   store=new ProfileStore({filePath:path.join(root,'profiles.json'),journal:true,residentRoomExperiment:true,now:()=>saved.at});
   const ledger=new RoomProfileLedger(store);box=await RoomOutbox.openExisting({...saved.identity,file:path.join(root,'room.json')});
   await ledger.bindRecovery(box);await ledger.recoverStopped(box,box);await ledger.recoverStopped(box,box);
   const p=store.byId(saved.profileId);assert.equal(p.inventory.meat,mode==='reserved'?5:4);
   assert.equal(p.progress.boosterUses,mode==='reserved'?0:1);assert.equal(p.progress.maxMass,mode==='reserved'?0:450);
   assert.equal(records.read(p,saved.txId).status,mode==='reserved'?'REFUNDED':'APPLIED');
   assert.equal(store.data.residentRooms[saved.identity.roomId].status,'CLOSED');
  }finally{await box?.close();await store?.close();cleanup();}
 }
});

test('an older unacknowledged frame replays by its own digest after a newer frame, without re-credit',async t=>{
 const f=await fixture(t),box=await f.open();
 const first=await box.append({at:f.at(),progress:[{type:'massPeak',profileId:f.id,mass:90}]}),a=await f.ledger.accept(f.child,first);
 const second=await box.append({at:f.at()+1,progress:[{type:'massPeak',profileId:f.id,mass:150}]}),b=await f.ledger.accept(f.child,second);
 assert.deepEqual(await f.ledger.accept(f.child,first),a);box.acknowledge(a);box.acknowledge(b);
 assert.equal(f.store.byId(f.id).progress.maxMass,150);
});

test('durable cancellation refunds a changed target without claiming a successful use, including crash replay',async t=>{
 const f=await fixture(t),tx=await f.ledger.reserve(f.child,f.auth.token,f.input()),box=await f.open();
 const frame=await box.append({at:f.at(),cancelled:[f.cast(tx)]});
 const ack=await f.ledger.accept(f.child,frame);assert.equal(f.store.byId(f.id).inventory.meat,5);
 assert.equal(f.store.byId(f.id).progress.boosterUses,0);assert.equal(records.read(f.store.byId(f.id),tx.txId).status,'REFUNDED');
 assert.deepEqual(await f.ledger.accept(f.child,frame),ack);await box.close();await f.stop();
 await f.ledger.fenceStopped(f.identity,f.child);await f.ledger.recoverStopped(await f.open(true),f.child);
 assert.equal(f.store.byId(f.id).inventory.meat,5);
});

test('recovery refunds a durable cancellation not yet received by the profile ledger exactly once',async t=>{
 const f=await fixture(t),tx=await f.ledger.reserve(f.child,f.auth.token,f.input()),box=await f.open();
 await box.append({at:f.at(),cancelled:[f.cast(tx)]});await box.close();await f.stop();
 await f.ledger.fenceStopped(f.identity,f.child);const evidence=await f.open(true);
 await f.ledger.recoverStopped(evidence,f.child);await f.ledger.recoverStopped(evidence,f.child);
 assert.equal(f.store.byId(f.id).inventory.meat,5);assert.equal(f.store.byId(f.id).progress.boosterUses,0);
});
