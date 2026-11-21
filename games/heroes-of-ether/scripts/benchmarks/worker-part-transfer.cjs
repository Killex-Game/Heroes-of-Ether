"use strict";
const assert = require("node:assert/strict"), { performance } = require("node:perf_hooks");
const { packPlayers, unpackPlayers } = require("../../src/server/arena/worker-part-transfer");
function state(parts, tick, room) {
  return { tick, room, players: Array.from({ length: 35 }, (_, i) => ({
    id: "player" + i, name: "Игрок " + i, x: i * 75 + tick, y: room * 100 + tick,
    mass: 65000, radius: 300, skinId: "crystal", account: { vip: true, premium: true },
    clanPrefix: "TEST", title: { id: "hero", label: "Герой" }, boosterUses: { fire: tick % 11 },
    parts: Array.from({ length: parts }, (_, j) => ({ id: "part" + i + ":" + j,
      x: i * 75 + j * 17 + tick / 3, y: room * 100 + j * 13 + tick / 7,
      mass: 65000 / parts, radius: Math.sqrt(65000 / parts), mergeVersion: j,
      ...(tick % 13 < 4 && j % 3 === 0 ? { birth: { at: tick * 50, x: i * 75, y: j * 13 } } : {}),
      mergeMs: 17000 - tick * 50, burnMs: tick % 100,
    })), pet: { id: "manya", level: 5, active: true }, effects: [{ id: "shield", remainingMs: 15000 - tick * 50 }],
  })), projectiles: Array.from({ length: 70 }, (_, i) => ({ id: "shot" + i, x: i * 31 + tick, y: i * 7,
    owner: "player" + i % 35, boosterId: "rocket", speed: 1200 })) };
}
function run(packed, count) {
  let encodeMs = 0, cloneMs = 0, decodeMs = 0;
  for (let tick = 0; tick < 120; tick++) for (let room = 0; room < 10; room++) {
    const original = state(count, tick, room), start = performance.now();
    const encoded = packed ? packPlayers(original.players) : { players: original.players, partValues: null };
    const packet = { ...original, ...encoded }, ready = performance.now();
    const copy = structuredClone(packet, { transfer: packet.partValues ? [packet.partValues.buffer] : [] });
    const cloned = performance.now();
    const players = unpackPlayers(copy.players, copy.partValues), end = performance.now();
    if (tick >= 20) { encodeMs += ready - start; cloneMs += cloned - ready; decodeMs += end - cloned; }
    assert.deepEqual(players, original.players);
    assert.equal(JSON.stringify(players), JSON.stringify(original.players));
  }
  return { packed, parts: count, encodeMs, cloneMs, decodeMs, totalMs: encodeMs + cloneMs + decodeMs };
}
for (const parts of [1, 8, 16]) console.log(JSON.stringify({ exact: true,
  results: [false, true, true, false].map(packed => run(packed, parts)) }));
