"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fork}=require('node:child_process'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const {temporary}=require('../temp');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {freshProgress}=require('../../src/server/progression/experience-progression');
const {recover}=require('../../src/server/profiles/profile-journal');
const receipts=require('../../src/server/profiles/operation-receipts');
const {RoomProgressSink}=require('../../scripts/benchmarks/resident-room-processes/progress-sink.cjs');
const {DurableCasts}=require('../../scripts/benchmarks/resident-room-processes/durable-casts.cjs');
function message(child,type){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('Child message timeout: '+type));},15000);
  function cleanup(){clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);}
  function onMessage(m){if(m.type===type){cleanup();resolve(m);}}
  function onExit(code){cleanup();reject(Error('Child exited: '+code));}
  child.on('message',onMessage);child.once('exit',onExit);
});}
test('SIGKILL after a durable debit preserves receipts and fences the old room; undelivered effect stays explicit',async t=>{
  const children=[],tokens=new Map(),ids=[];let casts,store;
  t.after(async()=>{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}
    await casts?.queue.running;await store?.close();
  });
  const filePath=path.join(temporary(t,'resident-crash'),'profiles.json');
  store=new ProfileStore({filePath,journal:true});
  for(let i=0;i<35;i++){
    const auth=store.open();ids.push(auth.profile.id);tokens.set(auth.profile.id,auth.token);
    store.transact(auth.token,randomUUID(),'crash-fixture',p=>{
      p.level=600;p.progress=freshProgress(600);p.inventory.meat=1;p.quickSlots=['meat'];
    });
  }
  const sink=new RoomProgressSink(store),roomId='crash-room';
  async function start(epoch){
    sink.claim(roomId,epoch,ids);
    const child=fork(path.join(__dirname,'../fixtures/resident-crash-child.cjs'),[],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
    children.push(child);sink.bind(roomId,epoch,child);
    const config={id:roomId,epoch,profiles:ids.map(id=>store.byId(id))};
    casts=new DurableCasts(store,sink,tokens);casts.claim(child,config);
    child.on('message',m=>{if(m.type.startsWith('cast'))casts.receive(child,m);});
    const ready=message(child,'ready');child.send({type:'init',roomId,epoch,profiles:config.profiles});
    const value=await ready;
    for(const p of value.lives)store.startLife(p.profileId,p.lifeId);
    return {child,lives:value.lives};
  }
  const first=await start('epoch-first'),requestId=randomUUID();
  let committed;
  const durable=new Promise(resolve=>{const send=casts.reply.bind(casts);casts.reply=(child,m)=>{
    if(m.type==='castCommit'){committed=m;resolve();}else send(child,m);
  };});
  first.child.send({type:'request',requestId});await durable;await casts.queue.running;
  assert.equal(store.byId(ids[0]).inventory.meat,0);
  assert.equal(casts.metrics.completed,1);
  assert.notEqual(receipts.read(store.byId(ids[0]),requestId),receipts.MISSING);
  // The ACK is deliberately not delivered: durable debit is not proof of an effect.
  assert(committed);assert.equal(casts.commandReplies.size,1);
  const killed=once(first.child,'exit');first.child.kill('SIGKILL');await killed;
  const persisted=Object.values(recover(filePath).data.profiles).find(p=>p.id===ids[0]);
  assert.equal(persisted.inventory.meat,0);assert.notEqual(receipts.read(persisted,requestId),receipts.MISSING);
  // This test coordinator has observed the old process exit. Close only the
  // confirmed life progress before issuing a new epoch. Production still needs
  // an automatic RECOVERING state and a policy for the undelivered effect.
  store.applyArenaProgress('recover-'+randomUUID(),ids.map(id=>({type:'lifeEnded',profileId:id,
    lifeId:store.byId(id).progress.session.id,durationSeconds:store.byId(id).progress.session.activitySeconds||0,
    reason:'recovered'})),store.now());
  sink.release(roomId,'epoch-first');
  const second=await start('epoch-second');
  assert.equal(second.lives.length,35);
  await assert.rejects(sink.commitFrom(first.child,{roomId,epoch:'epoch-first',sequence:1,at:Date.now(),progress:[]}),/Unowned/);
  const rejected=message(second.child,'observed');
  second.child.send({type:'request',requestId});
  const observed=await rejected;assert.equal(observed.applied,0);assert.equal(observed.rejected,1);
  assert.equal(store.byId(ids[0]).inventory.meat,0);
  assert.equal(recover(filePath).data.roomProgress[roomId].epoch,'epoch-second');
});
