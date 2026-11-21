'use strict';
// Isolated exact replay of W movement, expiry and thorn reproduction. Timing
// excludes scene construction and comparisons; no server or player data.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { performance } = require('node:perf_hooks');
let serial = 0;
require('node:crypto').randomUUID = () => 'fixture-' + (++serial);
const file = require.resolve('../../src/server/arena/arena-simulation');
const { Arena } = require(file);
const { ArenaHazards } = require('../../src/server/arena/arena-hazards');
const baseline = new Module(file, module);
baseline.filename = file; baseline.paths = Module._nodeModulePaths(path.dirname(file));
baseline._compile(fs.readFileSync(process.env.BASELINE_ARENA, 'utf8'), file);
const methods = [baseline.exports.Arena.prototype.moveFeed, Arena.prototype.moveFeed];
function scene(seed, mode) {
  serial = 0;
  let randomState = seed;
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296);
  const arena = new Arena({ etherCount: 0, random });
  arena.hazards = new ArenaHazards(arena);
  if (mode === 'contacts') {
    for (let i = 0; i < (seed % 3 === 0 ? 80 : seed % 3 === 1 ? 79 : 40); i++) {
      const h = arena.hazards.create(200 + i % 8 * 700, 200 + Math.floor(i / 8) * 350, 1000);
      h.previousX = h.x; h.previousY = h.y;
      arena.hazards.items.push(h);
    }
  }
  arena.ether = Array.from({ length: 6000 }, (_, i) => {
    const drop = i % 3 !== 0;
    const x = random() * 6000, y = random() * 4000;
    return { id: 'food-' + i, x, y, radius: 5.5, value: drop ? 5 : 1,
      ...(drop ? { ejected: true, updatedAt: 1000, expiresAt: mode === 'expiry' && i % 5 ? 1900 : 5000,
        vx: (random() - .5) * 900, vy: (random() - .5) * 900,
        sourceId: 'p' + i % 35, sourceLife: 'life' + i % 35 } : {}),
    };
  });
  return arena;
}
for (const mode of ['moving', 'expiry', 'contacts']) {
  const totals = [0, 0], samples = [[], []];
  for (let seed = 1; seed <= 80; seed++) {
    let expected;
    for (let j = 0; j < 2; j++) {
      const k = (j + seed) % 2, arena = scene(seed, mode), original = arena.ether;
      const at = performance.now(); methods[k].call(arena, 2000); const elapsed = performance.now() - at;
      if (seed > 10) { totals[k] += elapsed; samples[k].push(elapsed); }
      assert.strictEqual(arena.ether, original);
      const value = { food: arena.ether, hazards: arena.hazards.items, contacts: arena.hazards.contacts };
      if (expected) assert.deepEqual(value, expected); else expected = value;
    }
  }
  console.log(JSON.stringify({ mode, exact: true, variants: totals.map((ms, i) => ({
    name: i ? 'after' : 'before', ms, p95: samples[i].sort((a, b) => a - b)[66],
  })) }));
}
