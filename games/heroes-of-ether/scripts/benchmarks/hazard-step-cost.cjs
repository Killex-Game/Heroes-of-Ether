"use strict";
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { scene } = require('../../tests/helpers/hazard-replenishment-reference');
const file = require.resolve('../../src/server/arena/arena-hazards');
const old = new Module(file, module); old.filename = file; old.paths = Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(path.join(process.argv[2], 'arena-hazards.js'), 'utf8'), file);
const current = require(file).ArenaHazards.prototype.beginStep, previous = old.exports.ArenaHazards.prototype.beginStep;
const samples = [[], []];
for (let round = 0; round < 16; round++) {
  for (const before of round % 2 ? [false,true] : [true,false]) {
    const { h, arena } = scene(17, 35, true);
    h.replenish(0); h.nextAt = Infinity;
    const method = before ? previous : current;
    const start = performance.now();
    for (let i=0;i<1500;i++) method.call(h, i*50);
    const elapsed = performance.now()-start;
    for (const p of arena.players.values()) if (!p.dead) for (const b of arena.bodies(p)) {
      const point=before ? h.bodyStarts.get(p.lifeId+':'+arena.bodyId(p,b)) : h.bodyStarts.get(p.lifeId).get(arena.bodyId(p,b));
      assert.deepEqual(point, {x:b.x,y:b.y});
    }
    if (round > 3) samples[before ? 0 : 1].push(elapsed);
  }
}
const median = a => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
console.log(JSON.stringify({steps:1500, players:35, beforeMs:median(samples[0]), afterMs:median(samples[1]), speedup:median(samples[0])/median(samples[1]), samples}));
