'use strict';
// Alternating exact replay of the internal worker transport, not game capacity.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { performance } = require('node:perf_hooks');
const file = require.resolve('../../src/server/arena/worker-food-transfer');
const current = require(file), baseline = new Module(file, module);
baseline.filename = file; baseline.paths = Module._nodeModulePaths(path.dirname(file));
baseline._compile(fs.readFileSync(process.env.BASELINE_TRANSFER, 'utf8'), file);
const modules = [baseline.exports, current];
function run(which, moving) {
  const { FoodTransferEncoder, FoodTransferDecoder } = modules[which];
  const rooms = Array.from({ length: 10 }, () => ({ encoder: new FoodTransferEncoder({ packed: true }),
    decoder: new FoodTransferDecoder(), food: Array.from({ length: 6000 }, (_, i) => ({
      id: 'e' + i, x: i / 3, y: i / 7, value: 5, radius: 5.5, color: 'gold',
      artValue: 5, ejected: true, birth: Object.freeze({ at: 1000, x: i, y: 0 }),
    })), previous: [] }));
  let encodeMs = 0, cloneMs = 0, decodeMs = 0;
  for (let tick = 0; tick < 70; tick++) for (const room of rooms) {
    for (let i = 0; i < moving; i++) { room.food[i].x += .000001; room.food[i].y -= .000003; }
    if (tick % 7 === 0) room.food.reverse();
    if (tick % 9 === 0) room.food[123].value++;
    const start = performance.now(), packet = room.encoder.encode(room.food), encoded = performance.now();
    const copy = packet && structuredClone(packet, { transfer: [packet.refs.buffer, packet.positions.buffer] });
    const cloned = performance.now(), rows = room.decoder.decode(copy), end = performance.now();
    if (tick > 9) { encodeMs += encoded - start; cloneMs += cloned - encoded; decodeMs += end - cloned; }
    assert.deepEqual(rows, room.food);
    if (tick % 10 === 0) {
      for (const old of room.previous) assert.deepEqual(old.rows, old.copy);
      room.previous.push({ rows, copy: structuredClone(rows) });
      if (room.previous.length > 2) room.previous.shift();
    }
  }
  return { name: which ? 'after' : 'before', moving, encodeMs, cloneMs, decodeMs };
}
for (const moving of [1000, 4000]) {
  const results = [0, 1, 1, 0].map(which => run(which, moving));
  console.log(JSON.stringify({ exact: true, results }));
}
