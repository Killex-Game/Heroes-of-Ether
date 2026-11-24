"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const wire = require("../../public/shared/arena-wire");
const { ArenaStateStream } = require("../../src/server/arena/state-stream");
const { ArenaStateWorkers } = require("../../src/server/arena/state-workers");

function peer(protocol, pool) {
  const ws = { playerId: "p0", protocol, readyState: 1, bufferedAmount: 0 }, decoder = new wire.Decoder(), raw = [], states = [];
  const send = (_, bytes) => {
    const packet = JSON.parse(bytes), value = decoder.decode(packet);
    raw.push(packet); delete value.playersDelta; delete value.foodDelta;
    states.push(structuredClone({ ...value, allFood: [...decoder.food.values()] }));
  };
  return { ws, raw, states, decoder, stream: pool ? pool.createStream("room", ws, send) : new ArenaStateStream(ws, send, () => 100) };
}
function scene(tick) {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: "p" + i, x: 100 + i * 10 + tick, y: 100, mass: 350.125 + tick, radius: 30,
    name: "Игрок 😀 " + i, account: { vip: true, premium: tick % 2 === 0, deadline: 9000 },
    pet: { id: "manya", level: 5, active: true, stock: { fire: tick }, vitality: 99 },
    boosterUses: { meat: tick }, forcedMovement: tick % 4 === 0,
    effects: [{ id: "golden_shield", remainingMs: 9000.123456789 - tick * 50 }, { id: "future_effect", remainingMs: 4.55 }],
    instantEffects: tick % 3 ? [{ id: "meat", remainingMs: 345 }] : null,
    ...(tick % 4 ? { futureExtension: { nested: [tick, null, "😀"] } } : {}),
    parts: Array.from({ length: 1 + tick % 4 }, (_, j) => ({ id: `p${i}c${j}`, x: 101 + tick + j, y: 100,
      mass: 87.53125, radius: 20.25, mergeMs: 9000 - tick * 50, mergeVersion: 1,
      ...(tick % 6 === 0 ? { birth: { tick, x: 100.123456, y: 200.654321 } } : {}) })),
  }));
  if (tick % 13 === 0) players.splice(2, 2);
  if (tick % 7 === 0) players.reverse();
  return { type: "state", tick, world: { width: 6000, height: 4000 }, players,
    ether: [{ id: "e1", x: 100 + tick, y: 100, value: 5, radius: 6, ejected: true,
      ...(tick % 5 ? { birth: { tick: 1, x: 100.123456789, y: 100 } } : { extra: "new" }) }],
    events: [{ type: "split", playerId: "p0", tick }], audioEvents: [], visualEvents: [],
    projectiles: [{ id: "s1", x: 100 + tick, y: 90, ownerId: "p1" }], hazards: [] };
}
test("effect schema preserves known and unknown effects, extensions, null and legacy arrays", () => {
  for (const value of [null, [], false, "extension", [{ id: "speed", remainingMs: 1.55 }],
    [{ id: "future", remainingMs: 123.456 }], [{ id: "speed", remainingMs: 10, extra: true }],
    [["legacy", 4]], [null, 3, false], [{ id: "__proto__", remainingMs: 4 }]])
    assert.deepEqual(wire.unpackEffects(wire.packEffects(value)), value);
  for (const value of [null, [2, []], [1, null], [1, [[1000, 2]]], [1, [[-1, 2]]], [1, [[1, "2"]]]])
    assert.throws(() => wire.unpackEffects(value));
});
test("player schema validates masks, row lengths and extension collisions", () => {
  for (const value of [["p", -1], ["p", 65536], ["p", 1], ["p", 0, 1], ["p", 0, { x: 4 }],
    ["p", 0, { id: "q" }], ["p", 0, {}, {}], [4, 0], ["p", 64, [1, [[999, 2]]]]])
    assert.throws(() => wire.unpackPlayerChange(value));
  const extension = JSON.parse('{"__proto__":{"test":1},"unknown":[1,null]}');
  const value = wire.unpackPlayerChange(["p", 1, 0, extension]);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.deepEqual(value.__proto__, { test: 1 }); assert.deepEqual(value.unknown, [1, null]);
  assert.equal(value.x, 0);
});
test("v8/v9/v10 yield exact states through splits, field deletion, view changes and backpressure", () => {
  const peers = [peer(wire.PROTOCOL), peer(wire.SCHEMA_PROTOCOL), peer(wire.PLAYER_SCHEMA_PROTOCOL)];
  let retained, original;
  for (let tick = 1; tick <= 120; tick++) {
    const frame = scene(tick);
    for (const c of peers) {
      c.stream.viewport = tick % 19 < 4 ? { x: 3000, y: 3000, width: 400, height: 400 } : null;
      c.ws.bufferedAmount = tick % 11 < 3 ? 100000 : 0;
      c.ws.playerId = tick > 80 ? "p1" : "p0";
      if (tick % 5) c.stream.acknowledge(c.stream.sequence);
      c.stream.publish(frame);
    }
    for (const c of peers.slice(1)) assert.deepEqual(c.states, peers[0].states);
    if (tick === 10) { retained = peers[2].states.at(-1); original = structuredClone(retained); }
  }
  assert.deepEqual(retained, original);
  assert(peers[2].raw.some(p => p.playersDelta.upsert.some(Array.isArray)));
  assert(peers[0].raw.every(p => p.playersDelta.upsert.every(row => !Array.isArray(row))));
  const rejoin = peer(wire.PLAYER_SCHEMA_PROTOCOL); rejoin.stream.publish(scene(121));
  const fresh = peer(wire.PROTOCOL); fresh.stream.publish(scene(121));
  assert.deepEqual(rejoin.states, fresh.states);
});
test("v10 survives encoding worker failure and starts a complete fresh baseline", async t => {
  const pool = new ArenaStateWorkers({ maxWorkers: 1, onError: () => {} }); t.after(() => pool.close());
  const worker = peer(wire.PLAYER_SCHEMA_PROTOCOL, pool), legacy = peer(wire.PROTOCOL);
  async function until(fn) { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw Error("Worker timeout"); await delay(5); } }
  for (let tick = 1; tick < 6; tick++) {
    const frame = scene(tick); for (const c of [worker, legacy]) c.stream.publish(frame);
    await until(() => worker.raw.at(-1)?.tick === tick);
    assert.deepEqual(worker.states.at(-1), legacy.states.at(-1));
    for (const c of [worker, legacy]) c.stream.acknowledge(c.stream.sequence);
  }
  await worker.stream.room.lane.worker.terminate(); await until(() => pool.stats.failures === 1 && worker.raw.at(-1).stateReset);
  assert.deepEqual([...worker.decoder.players], [...legacy.decoder.players]);
  assert.deepEqual([...worker.decoder.food], [...legacy.decoder.food]);
});
