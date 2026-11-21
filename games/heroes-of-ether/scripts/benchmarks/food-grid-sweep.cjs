"use strict";
const fs = require('node:fs'), Module = require('node:module'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const file = require.resolve('../../src/server/arena/arena-simulation');
const source = fs.readFileSync(file, 'utf8');
const { scene } = require('../../tests/helpers/hazard-replenishment-reference');
const sizes = [64, 96, 128, 192, 256, 384, 512];
const methods = sizes.map(size => {
  const mod = new Module(file, module); mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
  const start = source.indexOf('  collectEther(now = 0) {'), end = source.indexOf('  resolveAbsorptions(', start);
  const changed = source.slice(start, end).replace('RULES.SPATIAL_CELL_SIZE,', `${size},`);
  mod._compile(source.slice(0, start) + changed + source.slice(end), file);
  return mod.exports.Arena.prototype.collectEther;
});
for (const dense of [false, true]) {
  const samples = sizes.map(() => []);
  for (let seed = 1; seed <= 60; seed++) {
    const original = scene(seed, 35, dense).arena;
    let state = seed;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const p of original.players.values()) { p.protectedUntil = 0; original.syncParts(p); }
    const ether = Array.from({ length: 1224 }, (_, i) => ({ id: `e${i}`,
      x: random()*original.world.width, y: random()*original.world.height, radius: 5.5,
      value: i % 17 ? 2 : 100, ...(i%3 ? { ejected:true, sourceId:`p${i%35}`, sourcePickupAt:1000 } : {}) }));
    let expected;
    // Rotate measurement order to avoid systematically favouring a warm CPU.
    for (let j = 0; j < sizes.length; j++) {
      const k = (j + seed) % sizes.length, a = scene(seed, 35, dense).arena;
      a.players = structuredClone(original.players); a.ether = structuredClone(ether);
      const t = performance.now(); methods[k].call(a, 2000); const ms = performance.now() - t;
      if (seed > 10) samples[k].push(ms);
      const result = { players:a.players, ether:a.ether };
      if (expected) assert.deepEqual(result, expected); else expected = result;
    }
  }
  console.log(JSON.stringify({dense, exact:true, grid:sizes.map((size,i) => {
    const values=samples[i].sort((a,b)=>a-b); return {size, medianMs:values[25], p95Ms:values[47], totalMs:values.reduce((a,b)=>a+b,0)};
  })}));
}
