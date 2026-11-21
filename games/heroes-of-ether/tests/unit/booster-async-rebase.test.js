"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { ArenaBoosterQueue } = require("../../src/server/profiles/arena-booster-queue");
function fixture() {
  const store = {
    data: { version: 0 },
    now: () => 1000,
    refreshCompetition() {},
    prepareSnapshot: (x) => x,
    journal: {},
    writeSnapshot(next, staged) {
      assert.ok(staged, "an obsolete cast must not fall back to synchronous persistence");
      this.data = next;
      return true;
    },
  };
  const queue = new ArenaBoosterQueue(store);
  let finished = 0;
  const command = {
    prepare(batch) {
      batch.next = { version: batch.next.version + 1 };
      return {
        finish() {
          finished++;
        },
      };
    },
  };
  return { store, queue, command, finished: () => finished };
}

test("progress handoff cannot start a newer writer ahead of an already queued cast", async () => {
  const f = fixture();
  f.queue.fairRetries = true;
  const effects = [], errors = [];
  f.store.journal.stage = async () => ({ durable: true });
  let turns = 0, overtakes = 0;
  f.queue.onProgressTurn = async () => {
    assert.equal(f.queue.staging, false, "captured progress retains its turn");
    turns++;
    // A background writer scheduled by the completed progress barrier.
    setImmediate(() => { if (f.queue.waiting.length && !f.queue.staging) overtakes++; });
  };
  for (let i = 0; i < 3; i++) f.queue.use({ owner: "same", fail:e=>errors.push(e),
    prepare(batch) { const result=f.command.prepare(batch); return {finish(){result.finish();effects.push(i);}}; } });
  await f.queue.running;
  assert.deepEqual(effects, [0,1,2]);
  assert.equal(overtakes, 0);
  assert.equal(turns, 3);
  assert.equal(f.queue.staging, false);
  assert.deepEqual(errors, []);
});
test("competing profile saves rebase asynchronously and publish the effect exactly once", async () => {
  const f = fixture();
  let attempts = 0;
  f.store.journal.stage = async () => {
    if (++attempts <= 3) f.store.data = { version: f.store.data.version + 10 };
    assert.equal(f.finished(), 0);
    return { durable: true };
  };
  await f.queue.commit([f.command]);
  assert.equal(attempts, 4);
  assert.equal(f.store.data.version, 31);
  assert.equal(f.finished(), 1);
});
test("a sealed checkpoint does not delay a durably staged cast", async () => {
  const f = fixture();
  let release,
    attempts = 0;
  f.store.journal.running = new Promise((resolve) => {
    release = resolve;
  });
  f.store.journal.stage = async () => {
    attempts++;
    return { durable: true };
  };
  const pending = f.queue.commit([f.command]);
  await pending;
  assert.equal(attempts, 1);
  assert.equal(f.store.data.version, 1);
  assert.equal(f.finished(), 1);
  f.store.journal.running = null;
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.store.data.version, 1);
  assert.equal(f.finished(), 1);
});
test("failure of a restaged write keeps the competing save and applies no effect", async () => {
  const f = fixture();
  let attempts = 0;
  f.store.journal.stage = async () => {
    if (++attempts === 1) {
      f.store.data = { version: 10 };
      return { durable: true };
    }
    throw Error("disk unavailable");
  };
  await assert.rejects(f.queue.commit([f.command]), /disk unavailable/);
  assert.equal(f.store.data.version, 10);
  assert.equal(f.finished(), 0);
});

test("queued casts release staging while the bounded progress barrier drains", async () => {
  const f = fixture();
  let release,
    entered,
    barriers = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  f.store.journal.stage = async () => ({ durable: true });
  f.queue.onProgressTurn = async () => {
    assert.equal(f.queue.staging, false);
    if (++barriers === 1) {
      entered();
      await gate;
    }
  };
  const errors = [];
  const command = { ...f.command, owner: "same-player", fail: (error) => errors.push(error) };
  f.queue.use(command);
  f.queue.use(command);
  await ready;
  assert.equal(f.finished(), 1);
  assert.equal(f.store.data.version, 1);
  assert.equal(f.queue.waiting.length, 1);
  // A request arriving during the barrier must join the existing drain.
  f.queue.use(command);
  const pending = f.queue.running;
  release();
  await pending;
  assert.deepEqual(errors, []);
  assert.equal(f.finished(), 3);
  assert.equal(f.store.data.version, 3);
  assert.equal(f.queue.running, null);
  assert.equal(f.queue.counts.size, 0);
});

test("invalid cast releases progress before restaging, without publishing the rejected draft", async () => {
  const f = fixture();
  let attempted = 0,
    progressed = false;
  f.store.journal.stage = async () => {
    attempted++;
    return { durable: true };
  };
  f.queue.onProgressTurn = async () => {
    assert.equal(f.queue.staging, false);
    assert.equal(f.finished(), 0);
    f.store.data = { version: 10 };
    progressed = true;
  };
  await f.queue.commit([
    {
      prepare(batch) {
        const result = f.command.prepare(batch);
        return { ...result, valid: () => progressed };
      },
    },
  ]);
  assert.equal(attempted, 2);
  assert.equal(f.queue.restages.validity, 1);
  assert.equal(f.store.data.version, 11);
  assert.equal(f.finished(), 1);
});

test("one invalid independent cast cannot hold the stable subset unpublished", async () => {
  const f = fixture(),
    finished = [],
    failed = [];
  f.store.journal.stage = async () => ({ durable: true });
  const changed = {
    owner: "changing",
    prepare(batch) {
      batch.next = { version: batch.next.version + 1 };
      return { valid: () => finished.includes("stable"), finish: () => finished.push("changing") };
    },
    fail: (error) => failed.push(error),
  };
  const stable = {
    owner: "stable",
    prepare(batch) {
      batch.next = { version: batch.next.version + 1 };
      return { finish: () => finished.push("stable") };
    },
    fail: (error) => failed.push(error),
  };
  await f.queue.commit([changed, stable]);
  assert.deepEqual(finished, ["stable", "changing"]);
  assert.deepEqual(failed, []);
  assert.equal(f.store.data.version, 2);
});

test("failed split subset cannot fail or replay already published independent casts", async () => {
  const f = fixture(),
    finished = [],
    failed = [];
  let attempts = 0;
  f.store.journal.stage = async () => {
    if (++attempts === 3) throw Error("second subset disk failure");
    return { durable: true };
  };
  const commands = ["changing", "stable"].map((owner) => ({
    owner,
    prepare(batch) {
      batch.next = { version: batch.next.version + 1 };
      return { valid: () => owner === "stable", finish: () => finished.push(owner) };
    },
    fail: (error) => failed.push([owner, error.message]),
  }));
  await f.queue.commit(commands);
  assert.deepEqual(finished, ["stable"]);
  assert.deepEqual(failed, [["changing", "second subset disk failure"]]);
  assert.equal(f.store.data.version, 1);
});

test("a wholly invalid independent group is rebuilt in bounded smaller groups", async () => {
  const f = fixture(),
    finished = [];
  f.store.journal.stage = async () => ({ durable: true });
  const commands = ["a", "b", "c", "d"].map((owner) => ({
    owner,
    prepare(batch) {
      (batch.owners ??= []).push(owner);
      batch.next = { version: batch.next.version + 1 };
      return { valid: () => batch.owners.length === 1, finish: () => finished.push(owner) };
    },
    fail: (error) => {
      throw error;
    },
  }));
  await f.queue.commit(commands);
  assert.deepEqual(finished, ["a", "b", "c", "d"]);
  assert.equal(f.store.data.version, 4);
});
