"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const wire = require("../../public/shared/arena-wire");
const { ArenaStateStream } = require("../../src/server/arena/state-stream");

function client(protocol) {
  const decoder = new wire.Decoder(), packets = [], frames = [], bytes = [];
  const ws = { protocol, playerId: "p", readyState: 1, bufferedAmount: 0 };
  const stream = new ArenaStateStream(ws, (_, data) => {
    const packet = JSON.parse(data);
    packets.push(packet); frames.push(decoder.decode(packet)); bytes.push(data.length);
  }, () => 0);
  return { ws, stream, packets, frames, bytes };
}
function scene(t) {
  let parts = Array.from({ length: t % 8 === 0 ? 8 : 16 }, (_, i) => ({
    id: "part-" + (i === 15 ? "new-" + Math.floor(t / 4) : i),
    x: 100 + i * 15.453 - t * 1.001, y: 500 - i * t * 0.017,
    mass: 480000 / (i + 3 + t * 0.13), radius: 20 + i / 3,
    mergeVersion: Math.floor(t / 4), mergeMs: 30000 - t * 50, burnMs: i % 3 ? 0 : 300 - t,
    ...(t % 7 < 3 ? { birth: { tick: Math.floor(t / 7), x: i / 7, y: i / 13 } } : {}),
  }));
  if (t % 3 === 0) parts.reverse();
  if (t % 17 === 0) parts = [];
  return { type: "state", tick: t, world: { width: 6000, height: 4000 },
    players: [{ id: "p", parts, x: 100, y: 500 }, { id: "other", x: 100, y: 500, parts }],
    ether: [], projectiles: [], hazards: [], events: [], audioEvents: [], visualEvents: [] };
}
test("v8 reconstructs reorders, births, merges, burns and stalled snapshots exactly like v7", () => {
  const current = client(wire.PROTOCOL), old = client(wire.PRIVATE_STATE_PROTOCOL);
  const saved = [];
  for (let t = 1; t <= 120; t++) {
    const state = scene(t);
    for (const c of [current, old]) {
      c.ws.bufferedAmount = t % 9 < 2 ? 100000 : 0;
      c.stream.viewport = { x: t % 11 ? 100 : 5000, y: 500, width: 800, height: 600 };
      c.stream.acknowledge(c.stream.sequence);
      c.stream.publish(structuredClone(state));
    }
    assert.deepEqual(current.frames.at(-1)?.players, old.frames.at(-1)?.players);
    if (current.frames.length > saved.length) saved.push(structuredClone(current.frames.at(-1).players));
    assert.deepEqual(current.frames.map(f => f.players), saved, "published old frames are immutable");
  }
  assert.ok(current.packets.some(p => p.playersDelta.upsert.some(p => p.parts?.order)));
  assert.ok(old.packets.every(p => p.playersDelta.upsert.every(p => p.parts?.order === undefined)));
  const size = c => c.bytes.reduce((a, b) => a + b, 0);
  assert.ok(size(current) < size(old) * 0.65, `${size(current)} vs ${size(old)}`);
});
test("v8 preserves JSON fallback for unsupported numeric values and metadata removal", () => {
  const current = client(wire.PROTOCOL), old = client(wire.PRIVATE_STATE_PROTOCOL);
  for (const x of [undefined, 1e20, 5, -1e20, 0]) {
    const frame = scene(3);
    frame.players[0].parts[0].x = x;
    for (const c of [current, old]) {
      c.stream.acknowledge(c.stream.sequence); c.stream.publish(frame);
    }
    assert.deepEqual(current.frames.at(-1).players, old.frames.at(-1).players);
  }
});
