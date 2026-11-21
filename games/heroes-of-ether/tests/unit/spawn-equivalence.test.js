"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Arena, RULES, radiusForMass } = require("../../src/server/arena/arena-simulation");
function random(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function reference(arena, excludeId, mass, next) {
  const r = radiusForMass(mass);
  let best = { x: arena.world.width / 2, y: arena.world.height / 2 }, clearanceBest = -Infinity;
  for (let i = 0; i < RULES.SPAWN_ATTEMPTS; i++) {
    const candidate = { x: r + next() * (arena.world.width - 2 * r), y: r + next() * (arena.world.height - 2 * r) };
    let clearance = Infinity;
    for (const p of arena.players.values()) {
      if (p.id === excludeId || p.dead) continue;
      for (const part of arena.bodies(p))
        clearance = Math.min(clearance, Math.hypot(part.x - candidate.x, part.y - candidate.y) - part.radius - r);
    }
    if (clearance > clearanceBest) { best = candidate; clearanceBest = clearance; }
    if (clearance >= RULES.SPAWN_MARGIN) return candidate;
  }
  return best;
}
test("spawn pruning preserves exact choices and random consumption on sparse and crowded maps", () => {
  for (let seed = 1; seed <= 120; seed++) {
    const arena = new Arena({ etherCount: 0 });
    const layout = random(seed);
    for (let i = 0; i < seed % 36; i++) {
      const parts = Array.from({ length: 1 + seed % 16 }, () => ({
        x: layout() * arena.world.width, y: layout() * arena.world.height,
        radius: radiusForMass([50, 5000, 30000, 125000][seed % 4]),
      }));
      arena.players.set(String(i), { id: String(i), dead: i % 13 === 7, parts });
    }
    for (const mass of [20, 50, 5000, 30000, 125000]) {
      const oldRandom = random(seed * 1987), newRandom = random(seed * 1987);
      arena.random = newRandom;
      assert.deepEqual(arena.chooseSpawn("0", mass), reference(arena, "0", mass, oldRandom));
      assert.equal(newRandom(), oldRandom(), "following gameplay uses identical random sequence");
    }
  }
});
