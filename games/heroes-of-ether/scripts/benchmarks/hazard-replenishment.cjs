"use strict";
const { performance } = require("node:perf_hooks");
const assert = require("node:assert/strict");
const { linearReplenish, scene, view } = require("../../tests/helpers/hazard-replenishment-reference");
function run(dense, old) {
  let ms = 0; const results = [];
  for (let seed = 1; seed <= 100; seed++) {
    const s = scene(seed, 35, dense), start = performance.now();
    for (const at of [0, 1000, 2000]) {
      if (old) linearReplenish.call(s.h, at); else s.h.replenish(at);
      s.h.items.splice(0, 8);
    }
    ms += performance.now() - start; results.push(view(s));
  }
  return { ms, results };
}
for (const dense of [false, true]) {
  run(dense, true); run(dense, false);
  const before = run(dense, true), after = run(dense, false);
  assert.deepEqual(after.results, before.results);
  console.log(JSON.stringify({ dense, scenes: 100, beforeMs: before.ms, afterMs: after.ms,
    speedup: before.ms / after.ms, identical: true }));
}
