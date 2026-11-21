"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ArenaBoosterQueue } = require("../../src/server/profiles/arena-booster-queue");
function fixture() {
  const finished = [], failed = [], staged = [];
  const store = {
    data: { owners: [] }, now: () => 1000, refreshCompetition() {}, prepareSnapshot: x => x,
    journal: { stage: async next => { staged.push(next.owners); return { durable: true }; } },
    writeSnapshot(next, staged) { assert.equal(staged.durable, true); this.data = next; return true; },
  };
  const queue = new ArenaBoosterQueue(store, { fairRetries: true });
  const command = (owner, valid = () => true, target = null) => ({
    owner, target,
    prepare(batch) {
      batch.next = { owners: [...batch.next.owners, owner] };
      return { valid, finish: () => finished.push(owner) };
    },
    fail: error => failed.push([owner, error.message]),
  });
  return { store, queue, command, finished, failed, staged };
}
test("a changing cast yields to independent arrivals without letting conflicts overtake it", async () => {
  const f = fixture();
  f.queue.use(f.command("changing", () => f.finished.includes("new"), "target"));
  f.queue.use(f.command("stable"));
  f.queue.use(f.command("target"));
  let turns = 0;
  f.queue.onProgressTurn = () => {
    if (++turns === 1) {
      assert.deepEqual(f.store.data.owners, ["stable"], "only the independent rebuilt draft was published");
      f.queue.use(f.command("new"));
      assert.equal(f.queue.counts.get("changing"), 1);
    }
    assert.ok(turns < 20, "no unbounded retry in this fixture");
  };
  await f.queue.running;
  assert.deepEqual(f.finished, ["stable", "new", "changing", "target"]);
  assert.deepEqual(f.store.data.owners, f.finished);
  assert.deepEqual(f.failed, []);
  assert.equal(f.queue.counts.size, 0);
});
test("retries get bounded turns amid independent arrivals, and each action spends once", async () => {
  const f = fixture();
  let attempts = 0, turns = 0;
  f.queue.use(f.command("retry", () => ++attempts >= 4));
  f.queue.onProgressTurn = () => {
    if (++turns < 20) f.queue.use(f.command("new-" + turns));
    assert.ok(turns < 40);
  };
  await f.queue.running;
  assert.equal(attempts, 4);
  assert.ok(f.finished.indexOf("retry") < 15, "fresh arrivals cannot starve retry");
  assert.equal(new Set(f.finished).size, f.finished.length);
  assert.deepEqual(f.store.data.owners, f.finished);
  assert.deepEqual(f.failed, []);
  assert.equal(f.queue.counts.size, 0);
});
test("failed retry writes neither spend nor replay a completed independent cast", async () => {
  const f = fixture();
  let writes = 0;
  f.store.journal.stage = async () => {
    if (++writes === 3) throw Error("disk unavailable");
    return { durable: true };
  };
  f.queue.use(f.command("retry", () => false));
  f.queue.use(f.command("stable"));
  await f.queue.running;
  assert.deepEqual(f.store.data.owners, ["stable"]);
  assert.deepEqual(f.finished, ["stable"]);
  assert.deepEqual(f.failed, [["retry", "disk unavailable"]]);
  assert.equal(f.queue.counts.size, 0);
});

test('bounded retry batches preserve owner and target conflict order', () => {
  const f=fixture();f.queue.retryBatchSize=4;f.queue.retryEvery=2;
  const commands=[f.command('a',()=>true,'target'),f.command('b'),f.command('target'),f.command('c'),f.command('a')];
  f.queue.waiting=commands;
  for(const command of commands)f.queue.deferred.add(command);
  assert.deepEqual(f.queue.takeBatch().map(c=>c.owner),['a','b','c']);
  assert.deepEqual(f.queue.takeBatch().map(c=>c.owner),['target','a']);
  assert.equal(f.queue.waiting.length,0);
  assert.throws(()=>new ArenaBoosterQueue(f.store,{retryBatchSize:0}),/Invalid retry/);
  assert.throws(()=>new ArenaBoosterQueue(f.store,{retryEvery:5}),/Invalid retry/);
});

test('mixed early and late reservations await validation before publishing', async () => {
  const f=fixture();let unlock,checked=false,releaseLate;
  const early={...f.command('food'),reserve:async()=>{},release:()=>{checked=true;}};
  const late=f.command('rocket',()=>new Promise(resolve=>{unlock=()=>resolve(true);}));
  const prepared=late.prepare;late.prepare=batch=>{const result=prepared(batch);return {...result,abort:()=>{releaseLate=true;}};};
  f.queue.use(early);f.queue.use(late);
  while(!unlock)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.store.data.owners,[]);assert.deepEqual(f.finished,[]);assert.equal(checked,false);
  unlock();await f.queue.running;
  assert.deepEqual(f.store.data.owners,['food','rocket']);assert.deepEqual(f.finished,['food','rocket']);
  assert.equal(checked,true);assert.equal(releaseLate,undefined);assert.deepEqual(f.failed,[]);
});

test('mixed reservation rechecks a concurrent writer after late validation', async () => {
  const f=fixture();let attempts=0,released=0;
  const early={...f.command('food'),reserve:async()=>{},release:()=>{released++;}};
  const late=f.command('rocket',async()=>{
    if(++attempts===1)f.store.data={owners:['purchase']};return true;
  });
  f.queue.use(early);f.queue.use(late);await f.queue.running;
  assert.deepEqual(f.store.data.owners,['purchase','food','rocket']);
  assert.deepEqual(f.finished,['food','rocket']);assert.equal(f.queue.restages.profile,1);
  assert.equal(released,2);assert.deepEqual(f.failed,[]);
});

test('invalid late cast cannot hold independent reserved food in an endless restage', async () => {
  const f=fixture();let reservations=0,releases=0;
  const early={...f.command('food'),reserve:async()=>{reservations++;},release:()=>{releases++;}};
  const late=f.command('rocket',async()=>f.finished.includes('food'));
  f.queue.use(early);f.queue.use(late);
  let turns=0;f.queue.onProgressTurn=()=>{assert.ok(++turns<10);};
  await f.queue.running;
  assert.deepEqual(f.finished,['food','rocket']);assert.deepEqual(f.store.data.owners,['food','rocket']);
  assert.equal(reservations,releases);assert.deepEqual(f.failed,[]);assert.equal(f.queue.counts.size,0);
});
