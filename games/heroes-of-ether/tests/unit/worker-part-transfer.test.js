"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { packPlayers, unpackPlayers } = require("../../src/server/arena/worker-part-transfer");
function player(count = 16) {
  return { id: "p", extra: { preserved: true }, parts: Array.from({ length: count }, (_, i) => ({
    id: "b" + i, x: i ? i / 3 : -0, y: i / 7, mass: 12345.67, radius: Math.sqrt(12345.67),
    mergeVersion: i, ...(i % 3 === 0 ? { birth: { at: 10, parent: "b0", point: [1, 2] } } : {}),
    mergeMs: 4567.89, burnMs: i,
  })) };
}
test("packed parts preserve exact values, key order, births and source snapshots", () => {
  const players = [player(1), player(8), player(16), { id: "no-parts" }, { id: "null", parts: null }], original = structuredClone(players);
  const packet = packPlayers(players);
  const copy = structuredClone(packet, { transfer: [packet.partValues.buffer] });
  const decoded = unpackPlayers(copy.players, copy.partValues);
  assert.deepEqual(decoded, original);
  assert.equal(JSON.stringify(decoded), JSON.stringify(original));
  decoded[1].parts[0].birth.point[0] = 999;
  assert.deepEqual(players, original);
});
test("unknown part extensions, key layouts and short lists use the unchanged path", () => {
  const extension = player(), layout = player(), short = player(1);
  extension.parts[0].newField = { x: 123 };
  layout.parts[0] = { mergeMs: 1, ...layout.parts[0] };
  const packet = packPlayers([extension, layout, short]);
  assert.equal(packet.partValues, null);
  assert.deepEqual(unpackPlayers(packet.players, packet.partValues), [extension, layout, short]);
});
test("invalid packed coordinates are rejected without changing input", () => {
  const packet = packPlayers([player()]), original = structuredClone(packet);
  assert.throws(() => unpackPlayers(packet.players, packet.partValues.subarray(1)), /range/);
  assert.deepEqual(packet, original);
});
