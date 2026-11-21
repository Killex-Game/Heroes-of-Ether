"use strict";
// Deterministic AoI comparison, including index construction for each snapshot.
// No sockets or live game files. Correctness comparisons are outside timers.
const assert = require("node:assert/strict");
const path = require("node:path");
const before = require(path.resolve(process.env.BASELINE_VISIBILITY));
const after = require("../../src/server/arena/visibility");
const times = [[], []];
const summarize = a => ({ totalMs: a.reduce((s, n) => s + n, 0),
  p95: [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] });
for (let frame = 0; frame < 220; frame++) {
  const snapshot = { world: { width: 6113, height: 4077 }, players: [], projectiles: [], hazards: [],
    ether: Array.from({ length: 6000 }, (_, i) => ({ id: "e" + i,
      x: (i * 97 + frame * (i % 4)) % 6113, y: (i * 139 + frame * (i % 3)) % 4077,
      radius: i % 173 === 0 ? 350 : 5 })) };
  const views = Array.from({ length: 35 }, (_, i) => ({
    x: (i % 7) * 850 + frame, y: Math.floor(i / 7) * 850,
    width: [640, 1280, 2400, 4800, 10000][i % 5],
    height: [360, 720, 1350, 2700, 5625][i % 5],
  }));
  const results = [];
  for (const index of frame % 2 ? [1, 0] : [0, 1]) {
    const module = [before, after][index], start = performance.now();
    results[index] = views.map(v => module.select(snapshot, v, "me"));
    if (frame >= 20) times[index].push(performance.now() - start);
  }
  for (let i = 0; i < views.length; i++) {
    const a = results[0][i], b = results[1][i];
    if (a === null || b === null) assert.equal(a, b);
    else {
      assert.equal(a.key, b.key);
      assert.deepEqual([...a.ether], [...b.ether]);
      assert.deepEqual([...a.players], [...b.players]);
    }
  }
}
const old = summarize(times[0]), current = summarize(times[1]);
console.log(JSON.stringify({ identical: true, frames: 220, measuredFrames: 200, viewsPerFrame: 35,
  before: old, after: current, improvementPercent: (1 - current.totalMs / old.totalMs) * 100 }));
