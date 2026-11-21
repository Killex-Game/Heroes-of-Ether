"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { EventEmitter } = require("node:events");
const { setImmediate: turn, setTimeout: delay } = require("node:timers/promises");

const root = path.resolve(__dirname, "../..");
const { ArenaStateWorkers } = require(path.join(root, "src/server/arena/state-workers"));
const { ArenaStateStream } = require(path.join(root, "src/server/arena/state-stream"));
const wire = require(path.join(root, "public/shared/arena-wire"));
async function until(check) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw Error("Timed out");
    await delay(5);
  }
}
function state(tick) {
  return {
    type: "state",
    tick,
    world: { width: 6000, height: 4000 },
    players: [],
    ether: [{ id: "e1", x: 100 + tick, y: 200, radius: 5, value: 1 }],
    projectiles: [],
    hazards: [],
    events: [],
  };
}
function peer(pool, room) {
  const ws = { protocol: wire.PROTOCOL, playerId: "p", readyState: 1, bufferedAmount: 0 },
    packets = [];
  const send = (_, data) => packets.push(data.toString());
  return {
    stream: pool ? pool.createStream(room, ws, send) : new ArenaStateStream(ws, send, () => 0),
    packets,
  };
}
class Blocked extends EventEmitter {
  jobs = [];
  postMessage(job) {
    this.jobs.push(structuredClone(job));
  }
  terminate() {
    return Promise.resolve(0);
  }
}
function complete(worker, job) {
  worker.emit("message", {
    job: job.id,
    buffer: new ArrayBuffer(0),
    entries: [],
    workerMs: 0,
    pendingRooms: [],
  });
}
test("empty slot is unavailable until worker confirms cleanup; delayed old completion cannot retire a rejoined room", async (t) => {
  const worker = new Blocked(),
    pool = new ArenaStateWorkers({ maxWorkers: 1, maxRooms: 1, workerFactory: () => worker });
  t.after(() => pool.close());
  const first = peer(pool, "one");
  first.stream.publish(state(1));
  pool.flush();
  const frame = worker.jobs[0];
  first.stream.dispose();
  const overflow = peer(pool, "two");
  assert.equal(overflow.stream.room, undefined);
  overflow.stream.dispose();
  complete(worker, frame);
  pool.flush();
  const empty = worker.jobs[1];
  assert.equal(empty.rooms[0].peers.length, 0);
  assert.equal(pool.rooms.size, 1);
  const rejoined = peer(pool, "one"),
    room = rejoined.stream.room;
  rejoined.stream.publish(state(2));
  complete(worker, empty);
  assert.equal(pool.rooms.get("one"), room);
  pool.flush();
  const active = worker.jobs[2];
  complete(worker, empty);
  assert.equal(room.lane.busy.id, active.id, "duplicate cleanup ACK cannot close a newer job");
  rejoined.stream.dispose();
  complete(worker, active);
  pool.flush();
  const cleanup = worker.jobs[3];
  assert.equal(pool.rooms.size, 1);
  complete(worker, cleanup);
  assert.equal(pool.rooms.size, 0);
  const next = peer(pool, "two");
  assert.ok(next.stream.room);
  assert.equal(pool.lanes.length, 1);
  assert.equal(pool.lanes[0].rooms.length, 1);
});
test("successive room visits reuse bounded workers with fresh packets and no fallback", async (t) => {
  const pool = new ArenaStateWorkers({ maxWorkers: 3, maxRooms: 3 });
  t.after(() => pool.close());
  for (let visit = 0; visit < 20; visit++) {
    const clients = [0, 1, 2].map((n) => peer(pool, "room-" + (visit % 2 ? n : visit * 3 + n))),
      refs = clients.map(() => peer(null));
    for (let tick = 1; tick <= 2; tick++) {
      const snapshot = state(visit * 100 + tick);
      for (const c of [...clients, ...refs]) {
        c.stream.acknowledge(c.stream.sequence);
        c.stream.publish(snapshot);
      }
      pool.flush();
      await until(() => clients.every((c) => c.packets.length === tick));
      clients.forEach((c, i) => assert.equal(c.packets.at(-1), refs[i].packets.at(-1)));
    }
    for (const c of clients) c.stream.dispose();
    pool.flush();
    await until(() => pool.rooms.size === 0);
    assert.equal(pool.lanes.length, 3);
    assert.equal(
      pool.lanes.reduce((n, l) => n + l.rooms.length, 0),
      0,
    );
  }
  assert.equal(pool.stats.overflowStreams, 0);
  assert.equal(pool.stats.retiredRooms, 60);
  assert.equal(pool.stats.failures, 0);
});
test("reused slot selects the idle lane without moving a live room", async (t) => {
  const workers = [],
    pool = new ArenaStateWorkers({
      maxWorkers: 2,
      maxRooms: 2,
      workerFactory: () => {
        const w = new Blocked();
        workers.push(w);
        return w;
      },
    });
  t.after(() => pool.close());
  const active = peer(pool, "active"),
    leaving = peer(pool, "leaving"),
    fixed = active.stream.room.lane,
    idle = leaving.stream.room.lane;
  leaving.stream.dispose();
  pool.flush();
  complete(workers[1], workers[1].jobs[0]);
  const next = peer(pool, "next");
  assert.equal(next.stream.room.lane, idle);
  assert.equal(active.stream.room.lane, fixed);
  assert.equal(pool.rooms.size, 2);
  assert.equal(pool.stats.failures, 0);
  await turn();
});

test("sequential visits reuse one idle worker and rapid rejoin keeps its fresh decoder", async (t) => {
  const pool = new ArenaStateWorkers({ maxWorkers: 3, maxRooms: 3 });
  t.after(() => pool.close());
  for (let visit = 0; visit < 10; visit++) {
    const id = "room-" + visit;
    const first = peer(pool, id);
    first.stream.publish(state(visit * 100));
    pool.flush();
    await until(() => first.packets.length === 1);
    first.stream.dispose();
    pool.flush();
    // Cleanup is already in flight. Rejoin before its asynchronous answer.
    const rejoined = peer(pool, id), reference = peer(null);
    const snapshot = state(visit * 100 + 1);
    rejoined.stream.publish(snapshot);
    reference.stream.publish(snapshot);
    pool.flush();
    await until(() => rejoined.packets.length === 1);
    assert.equal(rejoined.packets[0], reference.packets[0]);
    assert.equal(pool.stats.retiredRooms, visit);
    assert.equal(pool.lanes.length, 1);
    rejoined.stream.dispose();
    pool.flush();
    await until(() => pool.rooms.size === 0);
  }
  assert.equal(pool.stats.retiredRooms, 10);
  assert.equal(pool.stats.overflowStreams, 0);
  assert.equal(pool.stats.failures, 0);
});
