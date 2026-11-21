'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {fork}=require('node:child_process'),{once}=require('node:events');
const {temporary}=require('../temp'),{RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const {recover}=require('../../src/server/profiles/profile-journal');
function fixture(t, options={}) {
  let cleanup;const dir=temporary({after:f=>cleanup=f},'room-outbox');
  const file=path.join(dir,'room.json'),boxes=[],children=[];
  t.after(async()=>{try{
    for(const c of children)if(c.exitCode===null&&c.signalCode===null){const exited=once(c,'exit');c.kill('SIGKILL');await exited;}
    for(const box of boxes)await box.close();
  }finally{cleanup();}});
  return {file,children,open:async(extra={})=>{const box=await RoomOutbox.open({file,roomId:'room-a',epoch:'epoch-a',...options,...extra});boxes.push(box);return box;}};
}
const ack=entry=>({roomId:entry.frame.roomId,epoch:entry.frame.epoch,sequence:entry.frame.sequence,digest:entry.digest});
test('room frame publication waits for fsync; caller mutation and concurrent advancement cannot leak',async t=>{
  const f=fixture(t),box=await f.open();let release,entered,published;
  const original=fs.fsync,gate=new Promise(r=>entered=r);
  const mocked=t.mock.method(fs,'fsync',(fd,cb)=>{entered();release=()=>original(fd,cb);});
  const progress=[{type:'massPeak',profileId:'profile-a',mass:50}];
  const pending=box.append({at:1,progress},entry=>{published=entry;});
  await gate;progress[0].mass=999;
  assert.equal(published,undefined);assert.equal(box.blocked,true);assert.deepEqual(box.list(),[]);
  await assert.rejects(box.append({at:2}),/cannot advance/);
  release();await pending;mocked.mock.restore();
  assert.equal(published.frame.progress[0].mass,50);published.frame.progress[0].mass=0;
  assert.equal(box.list()[0].frame.progress[0].mass,50);
  assert.equal(recover(f.file).data.roomFrames[1].frame.progress[0].mass,50);
  const sequences=box.pendingSequences();sequences.push(999);
  assert.deepEqual(box.pendingSequences(),[1]);
  const single=box.entry(1);single.frame.progress[0].mass=1234;
  assert.equal(box.entry(1).frame.progress[0].mass,50);
  assert.equal(box.entry(2),null);assert.throws(()=>box.entry(0),/Invalid/);
});
test('outbox capacity, contiguous ACKs, stale epoch fencing and durable end marker',async t=>{
  const f=fixture(t,{maxFrames:2}),box=await f.open();
  const first=await box.append({at:1}),second=await box.append({at:2});
  await assert.rejects(box.append({at:3}),/cannot advance/);
  assert.throws(()=>box.acknowledge(ack(second)),/gap/);
  assert.throws(()=>box.acknowledge({...ack(first),epoch:'stale'}),/Stale/);
  assert.throws(()=>box.acknowledge({...ack(first),digest:'bad'}),/conflict/);
  assert.equal(box.acknowledge(ack(first)),true);assert.equal(box.acknowledge(ack(first)),false);
  const last=await box.append({at:3,kind:'end'});assert.equal(box.blocked,true);
  await assert.rejects(box.append({at:4}),/cannot advance/);
  assert.deepEqual(box.list().map(e=>e.frame.sequence),[2,3]);
  const disk=recover(f.file).data;assert.equal(disk.ackSequence,1);assert.deepEqual(Object.keys(disk.roomFrames),['2','3']);
  box.acknowledge(ack(second));box.acknowledge(ack(last));await box.close();
  const reopened=await f.open();assert.equal(reopened.ended,true);assert.equal(reopened.sequence,3);assert.deepEqual(reopened.list(),[]);
});

test('published frames match recovered JSON values and every returned copy remains private',async t=>{
  const f=fixture(t),box=await f.open();let published;
  const progress=[{type:'future-event',profileId:'profile-a',optional:undefined,
    future:{list:[undefined,,1],nested:{value:'kept'},map:JSON.parse('{"__proto__":{"value":7}}')}}];
  const entry=await box.append({at:1,progress},value=>{published=value;});
  const disk=recover(f.file).data.roomFrames[1];
  assert.deepEqual(entry,disk);assert.deepEqual(published,disk);assert.deepEqual(box.list(),[disk]);
  entry.frame.progress[0].future.nested.value='return changed';
  published.frame.progress[0].future.list.push(999);
  const listed=box.list();listed[0].frame.progress[0].future.map.__proto__.value=99;
  assert.deepEqual(box.entry(1),disk);assert.equal({}.value,undefined);
});
test('failed fsync publishes nothing, removes failed append and fences the private simulation',async t=>{
  const f=fixture(t),box=await f.open();let published=0;
  const mock=t.mock.method(fs,'fsync',(_fd,cb)=>setImmediate(()=>cb(Error('disk failed'))));
  await assert.rejects(box.append({at:1},()=>published++),/disk failed/);mock.mock.restore();
  assert.equal(published,0);assert.equal(box.blocked,true);assert.equal(recover(f.file).data.sequence,0);
  await assert.rejects(box.append({at:2}),/cannot advance/);await box.close();
  assert.deepEqual((await f.open()).list(),[]);
});
test('publication error is terminal but the durable frame remains recoverable',async t=>{
  const f=fixture(t),box=await f.open();
  await assert.rejects(box.append({at:1},()=>{throw Error('transport stopped');}),/transport stopped/);
  assert.equal(box.blocked,true);await box.close();
  assert.equal((await f.open()).list()[0].frame.sequence,1);
});
function message(child,type){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('No child message: '+type));},10000);
  const receive=m=>{if(m.type===type){cleanup();resolve(m);}else if(m.type==='error'){cleanup();reject(Error(m.error));}};
  const died=()=>{cleanup();reject(Error('Child exited early'));};
  function cleanup(){clearTimeout(timer);child.off('message',receive);child.off('exit',died);}
  child.on('message',receive);child.on('exit',died);
});}
test('SIGKILL after durable frame before ACK recovers cast and progress; volatile ACK only causes replay',async t=>{
  const f=fixture(t);
  async function child(){
    const c=fork(path.join(__dirname,'../fixtures/room-outbox-crash.cjs'),[f.file],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
    f.children.push(c);await message(c,'ready');return c;
  }
  const c=await child(),committed=message(c,'durable');c.send('append');const {entry}=await committed;
  const killed=once(c,'exit');c.kill('SIGKILL');await killed;
  let box=await f.open();assert.deepEqual(box.list(),[entry]);assert.equal(box.list()[0].frame.applied[0].txId,'cast-a');await box.close();
  const second=await child(),acked=message(second,'acked');second.send({type:'ack',value:ack(entry)});await acked;
  const killedAgain=once(second,'exit');second.kill('SIGKILL');await killedAgain;
  box=await f.open();assert.deepEqual(box.list(),[entry]);box.acknowledge(ack(entry));await box.close();
  box=await f.open();assert.deepEqual(box.list(),[]);assert.equal(box.ackSequence,1);
});
test('second writer, wrong identity and corrupt complete record fail closed',async t=>{
  const f=fixture(t),box=await f.open();
  await assert.rejects(f.open(),/уже работает/);await box.append({at:1});await box.close();
  await assert.rejects(f.open({epoch:'other'}),/identity/);
  assert.equal(fs.existsSync(f.file+'.lock'),false);
  fs.appendFileSync(f.file+'.wal','not-a-valid-commit\n');
  await assert.rejects(f.open(),/checksum/);
  assert.equal(fs.existsSync(f.file+'.lock'),false);
});

test('recovery refuses a missing frame even when the snapshot is valid JSON',async t=>{
  const f=fixture(t),box=await f.open();await box.append({at:1});await box.close();
  const data=JSON.parse(fs.readFileSync(f.file));data.sequence=2;fs.writeFileSync(f.file,JSON.stringify(data));
  await assert.rejects(f.open(),/sequence gap/);
});
