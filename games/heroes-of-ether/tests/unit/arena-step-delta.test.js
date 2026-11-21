"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const { capture, restore, install, RandomTape } = require("../../scripts/benchmarks/experimental-step-workers/step-state");
const { ArenaStepWorkers } = require("../../scripts/benchmarks/experimental-step-workers/step-workers");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(pool) {
  while (pool.lanes.length < pool.maxWorkers) pool.lane();
  for (let n = 0; n < 500; n++) {
    if (pool.lanes.every(l => Atomics.load(l.signal, 0) === -1)) return;
    await sleep(10);
  }
  throw Error("Workers did not start");
}
function scene() {
  const arena = new Arena({ etherCount: 0, random: () => 0.5 });
  for (let i = 0; i < Math.max(35, BOOSTERS.size); i++) {
    const p = arena.addPlayer(0, "p" + i);
    Object.assign(p, { lifeId: "life" + i, level: 600, protectedUntil: 0, stopped: true });
    p.parts = Array.from({ length: 4 }, (_, j) => ({
      id: p.id + ":" + j, mass: 300 + 100 * j, radius: radiusForMass(300 + 100 * j),
      x: 400 + (i % 7) * 700 + (j % 2) * 100, y: 400 + Math.floor(i / 7) * 700 + Math.floor(j / 2) * 100,
      vx: 0, vy: 0, mergeAt: 100000,
    }));
    arena.syncParts(p);
  }
  return arena;
}
function normalized(value) {
  const ids = new Map();
  return JSON.stringify(value, (_, item) => {
    if (item instanceof Map) return [...item];
    if (item instanceof Set) return [...item];
    if (typeof item !== "string") return item;
    return item.replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/g, id => {
      if (!ids.has(id)) ids.set(id, "uuid-" + ids.size);
      return ids.get(id);
    });
  });
}
test("Room worker step matches the common simulation for all boosters and keeps player identity", async t => {
  const pool = new ArenaStepWorkers({ delta: true, maxWorkers: 2, timeoutMs: 2000 });
  t.after(() => pool.close()); await ready(pool);
  const a = scene(), b = restore(structuredClone(capture(a)), () => 0.5), spare = new Arena({ etherCount: 0 });
  const originalPlayers = [...b.players.values()];
  const ids = [...BOOSTERS.values()].filter(v => v.ready).map(v => v.id);
  for (const arena of [a, b]) for (let i = 0; i < ids.length; i++) {
    const p = arena.players.get("p" + i), part = arena.bodies(p)[0];
    arena.prepareBooster(p.id, { boosterId: ids[i], spawnSerial: p.spawnSerial,
      aimX: part.x + 700, aimY: part.y }, 5000)();
  }
  // Each booster launch creates unrelated IDs; normalization preserves references.
  for (let step = 1; step <= 80; step++) {
    const at = 5000 + step * 50;
    const expected = a.step(at), actual = pool.step([b, spare], at)[0];
    assert.equal(normalized(actual), normalized(expected), "events at step " + step);
    assert.equal(normalized(capture(b)), normalized(capture(a)), "world at step " + step);
    for (const p of originalPlayers) assert.equal(b.players.get(p.id), p);
  }
  assert.equal(pool.stats.fallback, 0);
  assert.equal(pool.stats.completed, 160);
});

test("Checkpoint retains Vortex captures keyed by an unsplit player's actual object", () => {
  const arena = new Arena({ etherCount: 0 }), owner = arena.addPlayer(0, "owner"), target = arena.addPlayer(0, "target");
  const shot = { vortexCaptures: new WeakMap([[target, { source: owner, target: null, elapsed: 0.3 }]]) };
  arena.combat.shots.push(shot);
  const state = structuredClone(capture(arena));
  install(arena, state);
  const remembered = arena.combat.shots[0].vortexCaptures.get(target);
  assert.equal(remembered.source, owner);
  assert.equal(remembered.elapsed, 0.3);
  assert.equal(arena.players.get("target"), target);
});

test("Random tape preserves unused values and exact order across fallback and direct inputs", () => {
  let next = 0;
  const arena = { random: () => next++ };
  const tape = new RandomTape(arena);
  assert.deepEqual(tape.reserve(4), [0, 1, 2, 3]);
  tape.consume(2);
  assert.equal(arena.random(), 2);
  assert.deepEqual(tape.reserve(4), [3, 4, 5, 6]);
  // Failed calculation did not consume: replay starts from 3.
  assert.deepEqual(Array.from({ length: 6 }, () => arena.random()), [3, 4, 5, 6, 7, 8]);
});

test("Entropy exhaustion retries unchanged world once and keeps the random sequence", async t => {
  const pool = new ArenaStepWorkers({ delta: true, maxWorkers: 2, timeoutMs: 2000 });
  t.after(() => pool.close()); await ready(pool);
  const a = new Arena({ etherCount: 0, random: () => 0.5 });
  a.etherCount = 300;
  const b = restore(structuredClone(capture(a)), () => 0.5);
  a.step(50); pool.step([b, new Arena({ etherCount: 0 })], 50);
  assert.equal(normalized(capture(b)), normalized(capture(a)));
  assert.equal(pool.stats.entropyFallback, 1);
  assert.equal(b.tick, 1);
});

test("Timed out worker cannot publish a late step or duplicate progress", async t => {
  const pool = new ArenaStepWorkers({ delta: true, maxWorkers: 2, timeoutMs: 5 });
  t.after(() => pool.close()); await ready(pool);
  // Suspend only dispatch on one test lane. It never receives this calculation.
  pool.lanes[0].worker.postMessage = () => {};
  const a = scene(), b = restore(structuredClone(capture(a)), () => 0.5);
  const expected = a.step(5000), actual = pool.step([b, new Arena({ etherCount: 0 })], 5000)[0];
  assert.equal(normalized(actual), normalized(expected));
  assert.equal(normalized(capture(b)), normalized(capture(a)));
  assert.equal(pool.lanes[0].retired, true);
  assert.ok(pool.stats.fallback >= 1);
  assert.equal(b.tick, 1);
});
