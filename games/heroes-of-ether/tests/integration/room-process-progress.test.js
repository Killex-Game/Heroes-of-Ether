"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ProfileStore } = require('../../src/server/profiles/profile-store');
const { recover } = require('../../src/server/profiles/profile-journal');
const { RoomProgressSink } = require('../../scripts/benchmarks/resident-room-processes/progress-sink.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-progress-'));
  const filePath = path.join(dir, 'profiles.json'), store = new ProfileStore({ filePath, journal: true });
  if(process.env.TEST_ROOM_PROGRESS_WORKERS)store.arenaPreparer=new (require('../../src/server/profiles/arena-progress-preparer').ArenaProgressPreparer)({parallelism:2});
  if(process.env.TEST_ROOM_INDEPENDENT_PROGRESS)store.arenaPreparer=new (require('../../scripts/benchmarks/resident-room-processes/independent-progress.cjs').IndependentProgress)(2);
  t.after(async () => { await store.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const a = store.open(), b = store.open(), at = Date.now();
  store.startLife(a.profile.id, 'life-a'); store.startLife(b.profile.id, 'life-b');
  const sink = new RoomProgressSink(store);
  sink.claim('a', 'epoch-a', [a.profile.id]); sink.claim('b', 'epoch-b', [b.profile.id]);
  const batch = (room, sequence, gain = 35) => ({ roomId:room, epoch:'epoch-' + room, sequence, at,
    progress:[{type:'absorbed',profileId:(room === 'a' ? a : b).profile.id,
      victimProfileId:'victim-' + sequence, lifeId:'life-' + room,gain}] });
  return { store, sink, batch, a, b, filePath };
}
test('interleaved rooms commit separate cursors; lost ACK and restart cannot double rewards', async t => {
  const f=fixture(t), one=f.batch('a',1), two=f.batch('b',1);
  await f.sink.commit(one); await f.sink.commit(two);
  const before=structuredClone(f.store.data);
  await f.sink.commit(one); assert.deepEqual(f.store.data,before);
  const restored = recover(f.filePath).data;
  assert.deepEqual(restored.roomProgress, f.store.data.roomProgress);
  assert.equal(Object.values(restored.profiles).find(p=>p.id===f.a.profile.id).progress.absorbedMass,35);
  const reloaded = new ProfileStore(); reloaded.data=structuredClone(restored);
  const sink=new RoomProgressSink(reloaded);sink.claim('a','epoch-a',[f.a.profile.id]);
  await sink.commit(one);assert.equal(reloaded.byId(f.a.profile.id).progress.absorbedMass,35);
  await assert.rejects(sink.commit({...one,sequence:3}),/gap/);
  await assert.rejects(sink.commit({...one,progress:[{...one.progress[0],gain:50}]}),/Conflicting/);
  sink.release('a','epoch-a');sink.claim('a','epoch-new',[f.a.profile.id]);
  await assert.rejects(sink.commit(one),/Invalid/);
});

test('older conflicting replays fail; evicted receipts never permit another reward after restart', async t=>{
  const f=fixture(t), first=f.batch('a',1);
  await f.sink.commit(first); await f.sink.commit(f.batch('a',2));
  const before=f.store.byId(f.a.profile.id).progress.absorbedMass;
  await assert.rejects(f.sink.commit({...first,progress:[{...first.progress[0],gain:999}]}),{code:'REPLAY_CONFLICT'});
  assert.equal(f.store.byId(f.a.profile.id).progress.absorbedMass,before);
  for(let sequence=3;sequence<=66;sequence++)await f.sink.commit(f.batch('a',sequence));
  const saved=recover(f.filePath).data;
  const receiptWindow = saved.roomProgress.a.receiptSlots
    ? Object.values(saved.roomProgress.a.receiptSlots) : saved.roomProgress.a.receipts;
  assert.equal(receiptWindow.length,64);
  assert.deepEqual(receiptWindow.map(receipt=>receipt.sequence).sort((a,b)=>a-b),
    Array.from({length:64},(_,i)=>i+3));
  const restored=new ProfileStore();restored.data=saved;
  const sink=new RoomProgressSink(restored);sink.claim('a','epoch-a',[f.a.profile.id]);
  const expected=restored.byId(f.a.profile.id).progress.absorbedMass;
  await assert.rejects(sink.commit(first),{code:'RESULT_EXPIRED'});
  await sink.commit(f.batch('a',65));
  await assert.rejects(sink.commit(f.batch('a',65,999)),{code:'REPLAY_CONFLICT'});
  assert.equal(restored.byId(f.a.profile.id).progress.absorbedMass,expected);
  assert.equal(restored.data.roomProgress.a.sequence,66);
});
test('no ACK before fsync; failed disk and racing lobby transaction safely replay', async t => {
  const f=fixture(t), first=f.batch('a',1), base=f.store.byId(f.a.profile.id).progress.absorbedMass;
  const original=fs.fsync;let finish;
  const mocked=t.mock.method(fs,'fsync',(fd,cb)=>{finish=error=>error?cb(error):original(fd,cb);});
  const waitFlush=async()=>{for(let i=0;i<200&&!finish;i++)await new Promise(r=>setTimeout(r,5));assert.ok(finish);};
  let done=false, writing=f.sink.commit(first).then(v=>{done=true;return v;});
  await waitFlush();assert.equal(done,false);assert.equal(f.store.byId(f.a.profile.id).progress.absorbedMass,base);
  finish(Error('disk unavailable'));await assert.rejects(writing,/disk unavailable/);
  assert.equal(f.store.data.roomProgress.a.sequence,0);
  finish=null;writing=f.sink.commit(first);await waitFlush();
  f.store.transact(f.a.token,require('node:crypto').randomUUID(),'lobby',p=>{p.wallet.coins+=17;});
  finish();finish=null;await waitFlush();finish();await writing;
  mocked.mock.restore();
  assert.equal(f.store.byId(f.a.profile.id).wallet.coins,117);
  assert.equal(f.store.byId(f.a.profile.id).progress.absorbedMass,base+35);
  assert.equal(recover(f.filePath).data.roomProgress.a.sequence,1);
});
test('a room cannot submit progress for another room profile',async t=>{
  const f=fixture(t),b=f.batch('a',1);
  b.progress[0].profileId=f.b.profile.id;
  await assert.rejects(f.sink.commit(b),/Invalid/);
  assert.equal(f.store.data.roomProgress.a.sequence,0);
});

test('overlapping live rosters cannot acquire the same profile and a new epoch rejects old progress',async t=>{
  const f=fixture(t),before=structuredClone(f.store.data);
  assert.throws(()=>f.sink.claim('other','epoch-other',[f.a.profile.id]),/already owned/);
  assert.deepEqual(f.store.data,before);
  f.sink.release('a','epoch-a');
  f.sink.claim('a','epoch-next',[f.a.profile.id]);
  await assert.rejects(f.sink.commit(f.batch('a',1)),/Invalid/);
  await assert.rejects(f.sink.commit({...f.batch('a',1),epoch:'epoch-future'}),/Invalid/);
  assert.equal(recover(f.filePath).data.roomProgress.a.epoch,'epoch-next');
});

test('knowing a room ID and epoch does not authorize another child IPC channel',async t=>{
  const f=fixture(t),a={},b={};
  f.sink.bind('a','epoch-a',a);f.sink.bind('b','epoch-b',b);
  assert.throws(()=>f.sink.bind('a','epoch-a',b),/binding/);
  await assert.rejects(f.sink.commitFrom(b,f.batch('a',1)),/Unowned/);
  assert.equal(f.store.data.roomProgress.a.sequence,0);
  await f.sink.commitFrom(a,f.batch('a',1));
  assert.equal(recover(f.filePath).data.roomProgress.a.sequence,1);
});

test('exclusively transferred IPC buffers retain ownership checks, durable cursors and replay protection', async t => {
  const f=fixture(t), original=f.batch('a',1), transferred=structuredClone(original);
  const promise=f.sink.commitTransferred(transferred);
  // The original sender's buffer is independent after IPC deserialization.
  original.progress[0].gain=999;
  await promise;
  assert.equal(f.store.byId(f.a.profile.id).progress.absorbedMass,35);
  await f.sink.commitTransferred(f.batch('a',1));
  assert.equal(f.store.byId(f.a.profile.id).progress.absorbedMass,35);
  await assert.rejects(f.sink.commitTransferred(f.batch('a',1,99)),/Conflicting/);
  const invalid=f.batch('a',2);invalid.progress[0].profileId=f.b.profile.id;
  await assert.rejects(f.sink.commitTransferred(invalid),/Invalid/);
  assert.equal(recover(f.filePath).data.roomProgress.a.sequence,1);
});

test('pending retries share the durable outcome and cannot fill the writer queue', async t => {
  const f = fixture(t), batch = f.batch('a', 1);
  const original = fs.fsync;
  let finish;
  const mocked = t.mock.method(fs, 'fsync', (fd, cb) => { finish = error => error ? cb(error) : original(fd, cb); });
  const first = f.sink.commit(batch);
  for (let i = 0; i < 1100; i++) assert.equal(f.sink.commit(batch), first);
  assert.equal(f.sink.queue.length, 1);
  assert.equal(f.sink.pending.size, 1);
  await assert.rejects(f.sink.commit({ ...batch, progress: [{ ...batch.progress[0], gain: 99 }] }), /Conflicting pending/);
  let acknowledged = false;
  const outcome = first.then(() => { acknowledged = true; }, error => { throw error; });
  for (let i = 0; i < 200 && !finish; i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(finish);
  assert.equal(acknowledged, false);
  // All retries fail together; the next retry is allowed to write again.
  finish(Error('disk retry'));
  await assert.rejects(outcome, /disk retry/);
  assert.equal(f.sink.pending.size, 0);
  mocked.mock.restore();
  await f.sink.commit(batch);
  assert.equal(f.store.byId(f.a.profile.id).progress.absorbedMass, 35);
  assert.equal(recover(f.filePath).data.roomProgress.a.sequence, 1);
  assert.equal(f.sink.metrics.coalesced, 1100);
});

test('pipelined progress keeps room order and reuses a durable write without losing interleaved rewards',async t=>{
  const f=fixture(t),requests=[];
  for(let i=1;i<=4;i++)for(const room of ['a','b'])requests.push(f.sink.commit(f.batch(room,i)));
  await Promise.all(requests);
  assert.equal(f.store.byId(f.a.profile.id).progress.absorbedMass,140);
  assert.equal(f.store.byId(f.b.profile.id).progress.absorbedMass,140);
  const saved=recover(f.filePath).data;
  assert.equal(saved.roomProgress.a.sequence,4);
  assert.equal(saved.roomProgress.b.sequence,4);
  assert.equal(f.sink.metrics.batches,8);
  // Retransmitting the entire acknowledged window is harmless.
  for(let i=1;i<=4;i++)for(const room of ['a','b'])await f.sink.commit(f.batch(room,i));
  assert.equal(f.store.byId(f.a.profile.id).progress.absorbedMass,140);
  assert.equal(f.store.byId(f.b.profile.id).progress.absorbedMass,140);
});
