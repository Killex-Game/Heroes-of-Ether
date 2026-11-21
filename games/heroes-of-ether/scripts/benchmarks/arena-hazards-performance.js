"use strict";
const { performance } = require("node:perf_hooks");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards, HAZARD_RULES } = require("../../src/server/arena/arena-hazards");
const report = [];
for (const count of [0, HAZARD_RULES.BASE_COUNT, HAZARD_RULES.MAX_COUNT]) {
  const arena = new Arena({ etherCount: 200, world: { width: 8000, height: 8000 } });
  arena.hazards = new ArenaHazards(arena);
  arena.hazards.nextAt = Infinity;
  for (let i = 0; i < 35; i++) {
    const p = arena.addPlayer(0, "bench-" + i);
    p.level = 501;
    p.isTestBot = true;
    p.protectedUntil = 0;
    arena.gainMass(p, 3200 - p.mass);
    arena.boosterEffects.split(p, p, 16, 0);
    for (const [j, b] of p.parts.entries()) {
      b.x = 200 + (i % 7) * 500 + (j % 4) * 50;
      b.y = 200 + Math.floor(i / 7) * 600 + Math.floor(j / 4) * 50;
      b.vx = b.vy = 0;
      b.mergeAt = 1e9;
    }
    arena.syncParts(p);
    p.targetX = p.x;
    p.targetY = p.y;
    p.stopped = true;
    p.nextMassDecayAt = Infinity;
  }
  for (let i = 0; i < count; i++)
    arena.hazards.items.push(
      arena.hazards.create(5000 + (i % 16) * 160, 100 + Math.floor(i / 16) * 500, 0),
    );
  const times = [],
    collisions = [],
    collect = arena.hazards.collect.bind(arena.hazards);
  let collisionMs = 0;
  arena.hazards.collect = (now) => {
    const start = performance.now();
    collect(now);
    collisionMs = performance.now() - start;
  };
  for (let n = 1; n <= 220; n++) {
    const start = performance.now();
    arena.step(n * 50);
    if (n > 30) {
      times.push(performance.now() - start);
      collisions.push(collisionMs);
    }
  }
  times.sort((a, b) => a - b);
  collisions.sort((a, b) => a - b);
  report.push({
    players: 35,
    parts: [...arena.players.values()].reduce((n, p) => n + arena.bodies(p).length, 0),
    hazardsBefore: count,
    hazardsAfter: arena.hazards.items.length,
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    p95Ms: times[Math.floor(times.length * 0.95)],
    hazardCollisionP95Ms: collisions[Math.floor(collisions.length * 0.95)],
    maxMs: times.at(-1),
  });
}
console.log(JSON.stringify(report, null, 2));
