"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ArenaBoosterQueue } = require("../../src/server/profiles/arena-booster-queue");
test("larger batches preserve owner/target dependencies and the configured bound", () => {
  for (const maxBatchSize of [1, 32, 128, 256]) {
    const queue = new ArenaBoosterQueue({}, { maxBatchSize });
    const commands = Array.from({ length: 350 }, (_, n) => ({ owner: "p" + n, seq: 0 }));
    commands.splice(5, 0, { owner: "p0", target: "p12", seq: 1 });
    commands.push({ owner: "p12", target: "p1", seq: 1 });
    queue.waiting = [...commands];
    const delivered = [], turns = new Map();
    let turn = 0;
    while (queue.waiting.length) {
      const batch = queue.takeBatch(), occupied = new Set();
      assert.ok(batch.length && batch.length <= maxBatchSize);
      for (const c of batch) {
        assert.ok(!occupied.has(c.owner) && !occupied.has(c.target));
        occupied.add(c.owner); if (c.target) occupied.add(c.target);
        turns.set(c, turn); delivered.push(c);
      }
      turn++;
    }
    assert.equal(new Set(delivered).size, commands.length);
    // The second owner's command cannot jump an earlier conflicting target.
    assert.ok(turns.get(commands[0]) < turns.get(commands[5]));
    assert.ok(turns.get(commands[5]) < turns.get(commands.find(c => c.owner === "p12" && c.seq === 0)));
  }
});
test("128 independent effects wait for the one durable commit and publish exactly once", async () => {
  let release, writes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const store = {
    data: { count: 0 }, now: () => 1000, refreshCompetition() {}, prepareSnapshot: x => x,
    journal: { stage: async () => { await gate; return { durable: true }; } },
    writeSnapshot(next, staged) { assert.equal(staged.durable, true); writes++; this.data = next; return true; },
  };
  const queue = new ArenaBoosterQueue(store, { maxBatchSize: 128 });
  const finished = [], errors = [];
  for (let n = 0; n < 128; n++) queue.use({ owner: "p" + n,
    prepare(batch) { batch.next = { count: batch.next.count + 1 }; return {
      finish() { assert.equal(store.data.count, 128); finished.push(n); },
    }; }, fail: e => errors.push(e) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.data.count, 0); assert.equal(finished.length, 0);
  release(); await queue.running;
  assert.equal(writes, 1); assert.equal(new Set(finished).size, 128); assert.deepEqual(errors, []);
});
test("unsupported batch bounds are rejected", () => {
  for (const maxBatchSize of [0, 257, 3.5, NaN])
    assert.throws(() => new ArenaBoosterQueue({}, { maxBatchSize }), RangeError);
});

test("global admission counts staged operations and rejects before preparing or reserving", async () => {
  let release, staged, writes=0, prepared=0, applied=0;
  const gate=new Promise(r=>release=r), entered=new Promise(r=>staged=r);
  const store={data:{count:0},now:()=>1000,refreshCompetition(){},prepareSnapshot:x=>x,
    journal:{async stage(){staged();await gate;return true;}},
    writeSnapshot(next){this.data=next;writes++;return true;}};
  const queue=new ArenaBoosterQueue(store,{maxBatchSize:4,maxPending:4}),errors=[];
  const command=owner=>({owner,prepare(batch){prepared++;batch.next={count:batch.next.count+1};
    return {finish(){applied++;}};},fail:e=>errors.push(e)});
  for(let i=0;i<4;i++)queue.use(command('p'+i));
  await entered;assert.equal(queue.waiting.length,0);assert.equal(queue.pending,4);
  let reserved=false;queue.use({...command('overflow'),reserve:()=>{reserved=true;}});
  assert.equal(reserved,false);assert.equal(prepared,4);assert.equal(applied,0);
  assert.equal(store.data.count,0);assert.equal(errors.length,1);assert.equal(errors[0].status,429);
  release();await queue.running;assert.equal(queue.pending,0);assert.equal(queue.counts.size,0);
  assert.equal(applied,4);assert.equal(writes,1);assert.equal(queue.overloadRejections,1);
  queue.use(command('overflow'));await queue.running;assert.equal(store.data.count,5);assert.equal(queue.pending,0);
});

test("failed durable stage releases admission without applying or charging the queued operations", async () => {
  let prepared=0,applied=0;
  const store={data:{count:0},now:()=>1000,refreshCompetition(){},prepareSnapshot:x=>x,
    journal:{async stage(){throw Error('fsync failed');}},writeSnapshot(){throw Error('not durable');}};
  const queue=new ArenaBoosterQueue(store,{maxPending:2}),errors=[];
  for(let i=0;i<3;i++)queue.use({owner:'p'+i,prepare(batch){prepared++;batch.next={count:1};return{finish(){applied++;}};},fail:e=>errors.push(e)});
  await queue.running;assert.equal(prepared,2);assert.equal(applied,0);assert.equal(store.data.count,0);
  assert.equal(queue.pending,0);assert.equal(queue.counts.size,0);assert.equal(errors.length,3);
  for(const maxPending of [0,65537,NaN,1.5])assert.throws(()=>new ArenaBoosterQueue({}, {maxPending}),RangeError);
});
