"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { setTimeout: delay, setImmediate: turn } = require("node:timers/promises");
const { ArenaStateWorkers } = require("../../src/server/arena/state-workers");
const { ArenaStateStream } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
async function until(check) {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw Error("Timed out"); await delay(5); }
}
function snapshot(tick, count = 5) {
  return { type: "state", tick, world: { width: 6000, height: 4000 },
    players: Array.from({ length: count }, (_, i) => ({
      id: "p" + i, x: 500 + i * 500, y: 1000 + tick, mass: 1000 + tick, radius: 50,
      viewRadius: 60, name: "Игрок " + i, mainPartId: "c" + i, lifeElapsedMs: tick * 50,
      pet: { id: "manya", level: 5, active: true, stock: { fire: 11 - tick } },
      parts: [{ id: "c" + i, x: 500 + i * 500, y: 1000 + tick, mass: 1000 + tick, radius: 50 }],
    })), ether: [{ id: "e1", x: 500, y: 1001 + tick, mass: 5, radius: 5 }],
    projectiles: [{ id: "shot", x: 505, y: 1000 + tick, radius: 5 }], hazards: [],
    events: [{ type: "split", playerId: "p0", tick }],
    audioEvents: [], visualEvents: [],
    ...(tick === 1 ? { leaderboard: [{ id: "p0", mass: 1001 }] } : {}),
  };
}
function peer(pool, id, room = "arena-1", protocol = wire.PROTOCOL) {
  const ws = { playerId: id, protocol, readyState: 1, bufferedAmount: 0 }, raw = [], decoded = [];
  const decoder = new wire.Decoder();
  const send = (_, data) => { raw.push(JSON.parse(data)); decoded.push(decoder.decode(raw.at(-1))); };
  const stream = pool ? pool.createStream(room, ws, send) : new ArenaStateStream(ws, send, () => 0);
  return { ws, stream, raw, decoded, decoder };
}

test("packed split parts produce identical packets across merges, births and worker failure", async t => {
  const pool = new ArenaStateWorkers({ maxWorkers: 1, packedFood: true, packedParts: true, onError: () => {} });
  t.after(() => pool.close());
  const client = peer(pool, "p0"), reference = peer(null, "p0");
  let old, frozenCopy;
  for (let tick = 1; tick <= 8; tick++) {
    const state = snapshot(tick, 35);
    for (const p of state.players) p.parts = Array.from({ length: tick === 6 ? 1 : 16 }, (_, i) => ({
      id: p.id + "-" + i, x: p.x + i * 11 + tick / 3, y: p.y + i * 7 - tick / 9,
      mass: 1000 / 16, radius: 12.5, mergeVersion: tick < 6 ? 1 : 2,
      ...(i % 3 === 0 && tick < 3 ? { birth: { at: 0, x: p.x, y: p.y, parent: p.id } } : {}),
      mergeMs: 18000 - tick * 50, burnMs: i * 50,
    }));
    for (const c of [client, reference]) { c.stream.acknowledge(c.stream.sequence); c.stream.publish(state); }
    await until(() => client.raw.at(-1)?.tick === tick);
    assert.deepEqual(client.raw.at(-1), reference.raw.at(-1));
    assert.deepEqual(client.decoded.at(-1), reference.decoded.at(-1));
    if (old) assert.deepEqual(old, frozenCopy);
    old = state; frozenCopy = structuredClone(state);
  }
  await client.stream.room.lane.worker.terminate();
  await until(() => pool.stats.failures === 1);
  assert.equal(client.raw.at(-1).stateReset, true);
  assert.deepEqual(client.decoded.at(-1).players, reference.decoded.at(-1).players);
});
test("thirteen rooms share five encoders without crossing room state and survive a lane failure", async t => {
  const pool = new ArenaStateWorkers({ maxWorkers: 5, maxRooms: 13, onError: () => {} });
  t.after(() => pool.close());
  const clients = Array.from({ length: 13 }, (_, i) => peer(pool, "p0", "arena-" + i));
  const references = clients.map(() => peer(null, "p0"));
  for (let tick = 1; tick <= 3; tick++) {
    for (let i = 0; i < clients.length; i++) {
      const state = snapshot(tick + i * 100);
      for (const c of [clients[i], references[i]]) {
        c.stream.acknowledge(c.stream.sequence);
        c.stream.publish(state);
      }
    }
    await until(() => clients.every((c, i) => c.raw.at(-1)?.tick === tick + i * 100));
    for (let i = 0; i < clients.length; i++) assert.deepEqual(clients[i].raw, references[i].raw);
  }
  assert.equal(pool.lanes.length, 5);
  assert.equal(pool.rooms.size, 13);
  assert.equal(pool.stats.overflowStreams, 0);
  const failed = clients[0].stream.room.lane;
  const affected = clients.map(c => c.stream.room.lane === failed);
  await failed.worker.terminate();
  await until(() => pool.stats.failures === 1);
  for (let i = 0; i < clients.length; i++) {
    const c = clients[i];
    assert.equal(c.raw.at(-1).stateReset === true, affected[i]);
    c.stream.acknowledge(c.stream.sequence);
    c.stream.publish(snapshot(4 + i * 100));
  }
  await until(() => clients.every((c, i) => c.raw.at(-1)?.tick === 4 + i * 100));
  for (let i = 0; i < clients.length; i++) {
    assert.equal(clients[i].decoded.at(-1).players[0].y, 1004 + i * 100);
    assert.equal(clients[i].raw.at(-1).stateReset, undefined);
  }
  assert.equal(pool.stats.failures, 1);
});

test("workers preserve all wire fields, owner HUD and per-peer viewports over split/removal ticks", async t => {
  const pool = new ArenaStateWorkers({ maxWorkers: 2, packedFood: true }); t.after(() => pool.close());
  const clients = Array.from({ length: 35 }, (_, i) => peer(pool, "p" + i));
  const references = clients.map((_, i) => peer(null, "p" + i));
  for (let tick = 1; tick <= 8; tick++) {
    const state = snapshot(tick, 35);
    if (tick > 3) { state.players.splice(5, 1); state.ether = []; state.projectiles = []; }
    if (tick > 2) state.players[0].parts.push({ id: "new", x: 550 + tick, y: 1020, mass: 100, radius: 10 });
    for (let i = 0; i < clients.length; i++) for (const c of [clients[i], references[i]]) {
      c.stream.viewport = { x: 500 + i * 500, y: 1000, width: 1000, height: 800 };
      c.stream.acknowledge(c.stream.sequence); c.stream.publish(state);
    }
    await until(() => clients.every(c => c.raw.at(-1)?.tick === tick));
    for (let i = 0; i < clients.length; i++) {
      assert.deepEqual(clients[i].raw.at(-1), references[i].raw.at(-1));
      assert.deepEqual(clients[i].decoded.at(-1), references[i].decoded.at(-1));
    }
  }
  assert.equal(pool.stats.failures, 0);
  const jobs = pool.stats.jobs;
  for (const c of clients) c.stream.acknowledge(c.stream.sequence);
  await delay(30);
  assert.equal(pool.stats.jobs, jobs, "healthy ACKs wait for the next snapshot instead of extra jobs");
});
for (const packedFood of [false, true]) test(`delta food transport (packed=${packedFood}) matches full snapshots across metadata edits and slow ACKs`, async t => {
  const pool = new ArenaStateWorkers({ maxWorkers: 1, packedFood }); t.after(() => pool.close());
  const clients = [peer(pool, "p0"), peer(pool, "p1")];
  const references = [peer(null, "p0"), peer(null, "p1")];
  const food = Array.from({ length: 300 }, (_, i) => ({ id: "e" + i.toString(36), x: 490 + i, y: 1000,
    value: 5, radius: 3, birth: { at: 1, origin: { x: 400, y: 1000 } } }));
  for (let tick = 1; tick <= 10; tick++) {
    const state = snapshot(tick);
    if (tick === 3) food[0].birth.origin.x = 401;
    if (tick === 4) food.reverse();
    if (tick === 5) food.splice(5, 20);
    if (tick === 6) food[0].value = 50;
    if (tick === 7) { delete food[0].radius; food[1].x += 0.000001; }
    state.ether = structuredClone(food);
    for (let i = 0; i < 2; i++) for (const client of [clients[i], references[i]]) {
      client.stream.viewport = { x: 500 + i * 100, y: 1000, width: 180 + tick * 10, height: 800 };
      client.stream.acknowledge(Math.max(0, client.stream.sequence - i * 2));
      client.stream.publish(state);
    }
    await until(() => clients.every(c => c.raw.at(-1)?.tick === tick));
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(clients[i].raw.at(-1), references[i].raw.at(-1));
      assert.deepEqual(clients[i].decoded.at(-1), references[i].decoded.at(-1));
    }
  }
  assert.equal(pool.stats.failures, 0);
});

test("room isolation, legacy compatibility, backpressure and invalid ACKs", async t => {
  const pool = new ArenaStateWorkers({ maxWorkers: 1 }); t.after(() => pool.close());
  const a = peer(pool, "p0"), b = peer(pool, "p0", "arena-2");
  const old = peer(pool, "p0", "arena-3", wire.HUD_PROTOCOL);
  assert.equal(old.stream.room, undefined);
  for (let tick = 1; tick <= 4; tick++) {
    a.stream.publish(snapshot(tick)); b.stream.publish(snapshot(100 + tick));
    await until(() => a.raw.length === tick && b.raw.length === tick);
  }
  assert.equal(a.stream.acknowledge(999), false);
  assert.equal(a.stream.acknowledge(-1), false);
  a.stream.publish(snapshot(5)); a.stream.publish(snapshot(6));
  await delay(30); assert.equal(a.raw.length, 4);
  a.ws.bufferedAmount = 100000;
  assert.equal(a.stream.acknowledge(4), true);
  assert.equal(a.stream.acknowledge(4), false);
  await delay(30); assert.equal(a.raw.length, 4);
  a.ws.bufferedAmount = 0; a.stream.flush();
  await until(() => a.raw.length === 5);
  assert.equal(a.raw.at(-1).tick, 6);
  assert.equal(b.raw.at(-1).tick, 104);
  assert.deepEqual(a.raw.at(-1).events.map(e => e.tick), [5, 6]);
});
test("worker crash resumes the same connection with a complete reset, without stale entities", async t => {
  const errors = [], pool = new ArenaStateWorkers({ maxWorkers: 1, packedFood: true, onError: e => errors.push(e) });
  t.after(() => pool.close());
  const c = peer(pool, "p0");
  c.stream.publish(snapshot(1)); await until(() => c.raw.length === 1);
  c.stream.acknowledge(1);
  const current = snapshot(2, 1); current.ether = []; current.projectiles = [];
  c.stream.publish(current);
  await pool.lanes[0].worker.terminate();
  await until(() => pool.stats.failures === 1);
  assert.equal(errors.length, 1);
  assert.equal(c.raw.at(-1).stateReset, true);
  assert.deepEqual(c.decoded.at(-1).ether, []);
  assert.deepEqual([...c.decoder.food], []);
  assert.deepEqual([...c.decoder.projectiles], []);
  assert.deepEqual([...c.decoder.players.keys()], ["p0"]);
  assert.ok(c.raw.at(-1).stateSequence > 1);
  c.stream.acknowledge(c.stream.sequence); c.stream.publish(snapshot(3, 1));
  assert.equal(c.raw.at(-1).stateReset, undefined);
  assert.equal(c.raw.at(-1).tick, 3);
});
test("a blocked worker has one in-flight job and one latest snapshot, bounded events and no departed recipients", async t => {
  class Blocked extends EventEmitter {
    jobs = []; postMessage(job) { this.jobs.push(structuredClone(job)); }
    terminate() { return Promise.resolve(0); }
  }
  const worker = new Blocked(), pool = new ArenaStateWorkers({ maxWorkers: 1, workerFactory: () => worker });
  t.after(() => pool.close());
  const c = peer(pool, "p0"), gone = peer(pool, "p1");
  const companion = peer(pool, "p2");
  c.stream.publish(snapshot(1)); gone.stream.publish(snapshot(1)); await turn();
  for (let tick = 2; tick < 1002; tick++) {
    const state = snapshot(tick);
    c.stream.publish(state); companion.stream.publish(state);
  }
  assert.equal(worker.jobs.length, 1);
  assert.equal(c.stream.queued.snapshot.tick, 1001);
  assert.equal(c.stream.queued.snapshot.events.length, 128);
  gone.stream.dispose();
  worker.emit("message", { job: worker.jobs[0].id, buffer: new ArrayBuffer(0), entries: [], workerMs: 1 });
  await turn();
  assert.equal(worker.jobs.length, 2);
  assert.deepEqual(worker.jobs[1].rooms[0].peers.map(p => p.id), [c.stream.key, companion.stream.key]);
  assert.equal(worker.jobs[1].rooms[0].states.length, 1);
  assert.equal(worker.jobs[1].rooms[0].states[0].snapshot.tick, 1001);
  const extra = peer(pool, "p0", "arena-2");
  extra.stream.publish(snapshot(2000)); c.stream.publish(snapshot(1002));
  worker.emit("message", { job: worker.jobs[1].id, buffer: new ArrayBuffer(0), entries: [], workerMs: 1 });
  await turn();
  assert.deepEqual(worker.jobs[2].rooms.map(room => room.id), ["arena-1", "arena-2"],
    "all dirty rooms share one round trip even if the main loop is congested");
});

test("worker timeout falls back once and creating unavailable workers remains optional", async t => {
  class Blocked extends EventEmitter {
    postMessage() {} terminate() { return Promise.resolve(0); }
  }
  const errors = [], pool = new ArenaStateWorkers({ maxWorkers: 2, timeoutMs: 20,
    onError: e => errors.push(e), workerFactory: () => new Blocked() });
  t.after(() => pool.close());
  const c = peer(pool, "p0");
  c.stream.publish(snapshot(1));
  await until(() => c.raw.length === 1);
  assert.equal(pool.stats.failures, 1);
  assert.equal(c.raw[0].stateReset, true);
  assert.equal(errors.length, 1);
  c.stream.acknowledge(1); c.stream.publish(snapshot(2));
  assert.equal(c.raw.at(-1).tick, 2);
  const unavailable = new ArenaStateWorkers({ maxWorkers: 1, onError: () => {},
    workerFactory: () => { throw Error("unavailable"); } });
  t.after(() => unavailable.close());
  const fallback = peer(unavailable, "p0");
  fallback.stream.publish(snapshot(1)); assert.equal(fallback.raw.length, 1);
});

test("overflow rooms stay on main without resetting healthy workers or changing room assignments", async t => {
  const pool = new ArenaStateWorkers({ maxWorkers: 3, maxRooms: 3 });
  t.after(() => pool.close());
  const clients = [1, 2, 3].map(n => peer(pool, "p0", "arena-" + n));
  for (const c of clients) c.stream.publish(snapshot(1));
  await until(() => clients.every(c => c.raw.length === 1));
  for (const c of clients) c.stream.acknowledge(1);
  const next = peer(pool, "p0", "arena-4");
  assert.equal(pool.stats.overflowStreams, 1);
  assert.equal(pool.overflowPeers.size, 1);
  assert.equal(pool.lanes.length, 3);
  assert.equal(pool.rooms.size, 3);
  assert.equal(next.stream.room, undefined);
  assert.equal(pool.stats.failures, 0);
  for (const c of clients) {
    assert.ok(c.stream.room);
    assert.equal(c.raw.length, 1, "opening room four must not send a reset");
    c.stream.publish(snapshot(3));
  }
  next.stream.publish(snapshot(4));
  assert.equal(next.raw.at(-1).tick, 4);
  await until(() => clients.every(c => c.raw.at(-1).tick === 3));
  for (const c of clients) {
    assert.equal(c.raw.at(-1).stateSequence, 2);
    assert.equal(c.raw.at(-1).stateReset, undefined);
    assert.equal(c.stream.room.lane.failed, undefined);
  }
  clients[0].stream.dispose();
  const jobs = pool.stats.jobs;
  const overflow = peer(pool, "p1", "arena-4");
  assert.equal(overflow.stream.room, undefined, "empty worker room does not migrate overflow peers");
  overflow.stream.publish(snapshot(5));
  assert.equal(overflow.raw.at(-1).tick, 5);
  const revisit = peer(pool, "p0", "arena-1");
  assert.equal(revisit.stream.room, pool.rooms.get("arena-1"));
  revisit.stream.publish(snapshot(5));
  await until(() => revisit.raw.at(-1)?.tick === 5);
  assert.ok(pool.stats.jobs > jobs, "the original room keeps its working encoder");
  assert.equal(pool.lanes.length, 3);
  assert.equal(pool.stats.failures, 0);
  next.stream.dispose(); overflow.stream.dispose(); overflow.stream.dispose();
  assert.equal(pool.overflowPeers.size, 0, "departed overflow peers must not keep mixed-mode draining active");
  await pool.close();
});

test("a ready packet can leave the worker mailbox before callbacks run, exactly once", async t => {
  let output, job;
  class Mailbox extends EventEmitter {
    postMessage(value) { job = value; }
    terminate() { return Promise.resolve(0); }
  }
  const pool = new ArenaStateWorkers({ maxWorkers: 1, workerFactory: port => {
    output = port; return new Mailbox();
  } });
  t.after(() => { output.close(); return pool.close(); });
  const c = peer(pool, "p0");
  const reference = peer(null, "p0");
  const state = snapshot(1);
  reference.stream.publish(state);
  c.stream.publish(state); pool.flush();
  const data = Buffer.from(JSON.stringify(reference.raw[0]));
  output.postMessage({ job: job.id, buffer: data, workerMs: 1, entries: [{
    room: "arena-1", id: c.stream.key, sequence: 1, offset: 0, length: data.length,
  }] });
  assert.equal(c.raw.length, 0, "message callbacks have not run yet");
  pool.drainMixed();
  assert.equal(c.raw.length, 0, "worker-only rooms deliver outside the simulation turn");
  pool.maxRooms = 1;
  const extra = peer(pool, "p1", "arena-2");
  pool.drainMixed();
  assert.equal(pool.stats.drained, 1);
  assert.deepEqual(c.raw[0], reference.raw[0]);
  assert.deepEqual(c.decoded[0], reference.decoded[0]);
  pool.drain();
  await turn();
  assert.equal(c.raw.length, 1, "callback must not deliver a manually drained packet again");
  assert.equal(c.stream.acknowledge(1), true);
  assert.equal(pool.stats.failures, 0);
  extra.stream.dispose();
});
