"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ArenaBoosterQueue}=require('../../src/server/profiles/arena-booster-queue');
function gate(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture(){
  const store={data:{owners:[]},now:()=>1000,refreshCompetition(){},prepareSnapshot:x=>x,
    journal:{stage:async()=>({durable:true})},writeSnapshot(next,proof){assert.ok(proof.durable);this.data=next;return true;}};
  const queue=new ArenaBoosterQueue(store),finished=[],failed=[],aborted=[];
  const command=(owner,valid)=>({owner,prepare(batch){batch.next={owners:[...batch.next.owners,owner]};
    return{valid,abort:()=>aborted.push(owner),finish:()=>finished.push(owner)};},fail:e=>failed.push(e.message)});
  return{store,queue,finished,failed,aborted,command};
}
test('IPC reservation cannot publish a spend or effect before all validations return',async()=>{
  const f=fixture(),a=gate(),b=gate(),entered=gate();let count=0;
  f.queue.use(f.command('a',()=>{if(++count===2)entered.resolve();return a.promise;}));
  f.queue.use(f.command('b',()=>{if(++count===2)entered.resolve();return b.promise;}));
  await entered.promise;a.resolve(true);await new Promise(setImmediate);
  assert.deepEqual(f.store.data.owners,[]);assert.deepEqual(f.finished,[]);
  b.resolve(true);await f.queue.running;
  assert.deepEqual(f.finished,['a','b']);assert.deepEqual(f.aborted,[]);
});
test('a competing writer during an IPC reply releases reservations and rebuilds from its new balance',async()=>{
  const f=fixture(),wait=gate(),entered=gate();let calls=0;
  f.queue.use(f.command('a',()=>{if(++calls===1){entered.resolve();return wait.promise;}return Promise.resolve(true);}));
  await entered.promise;f.store.data={owners:['lobby']};wait.resolve(true);await f.queue.running;
  assert.deepEqual(f.store.data.owners,['lobby','a']);assert.deepEqual(f.finished,['a']);
  assert.deepEqual(f.aborted,['a']);assert.equal(f.queue.restages.profile,1);
});
test('failed IPC waits for late replies then releases every reservation without a spend',async()=>{
  const f=fixture(),late=gate(),entered=gate();
  f.queue.use(f.command('a',()=>Promise.reject(Error('room disconnected'))));
  f.queue.use(f.command('b',()=>{entered.resolve();return late.promise;}));
  await entered.promise;await new Promise(setImmediate);assert.deepEqual(f.aborted,[]);
  late.resolve(true);await f.queue.running;
  assert.deepEqual(f.aborted,['a','b']);assert.deepEqual(f.store.data.owners,[]);
  assert.deepEqual(f.finished,[]);assert.equal(f.failed.length,2);
});
