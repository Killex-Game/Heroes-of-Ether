"use strict";
const { Arena, radiusForMass: radius } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards, HAZARD_RULES: H } = require("../../src/server/arena/arena-hazards");

// Original full search is the oracle for RNG order, placement and cooldowns.
function linearReplenish(now) {
  const a = this.arena;
  if (![...a.players.values()].some(p => !p.dead && !p.isRemnant)) {
    this.items = []; this.recent.clear(); this.nextAt = 0; return;
  }
  for (const [cell, until] of this.recent) if (until <= now) this.recent.delete(cell);
  if (now < this.nextAt) return;
  const budget = H.BASE_COUNT - this.items.length;
  for (let n = 0; n < budget; n++) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const margin = radius(H.MASS) + 5,
        x = margin + a.random() * Math.max(0, a.world.width - margin * 2),
        y = margin + a.random() * Math.max(0, a.world.height - margin * 2),
        cell = this.cell(x, y);
      if (this.recent.has(cell) ||
          this.items.some(item => Math.hypot(item.x - x, item.y - y) < item.radius + margin + 30) ||
          [...a.players.values()].some(p => !p.dead &&
            a.bodies(p).some(b => Math.hypot(b.x - x, b.y - y) < b.radius + margin + 90))) continue;
      this.items.push(this.create(x, y, now));
      this.recent.set(cell, now + H.CELL_COOLDOWN_MS);
      break;
    }
  }
  this.nextAt = this.items.length < H.BASE_COUNT ? now + 1000 : now;
}
function scene(seed, count = 35, dense = false, spatialIndex = true) {
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const arena = new Arena({ etherCount: 0, spatialIndex, random,
    world: { width: dense ? 2500 : 6000, height: dense ? 2000 : 4000 } });
  const masses = [20, 50, 150, 1000, 5000, 25000, 40000, 75000, 120000, 480000];
  for (let i = 0; i < count; i++) {
    const p = arena.addPlayer(0, "p" + i), mass = masses[(i + seed) % masses.length];
    p.dead = i % 13 === 12; p.isRemnant = i % 11 === 10;
    const number = i % 5 ? 16 : 1;
    const parts = Array.from({ length: number }, (_, j) => ({ id: `${i}-${j}`,
      x: random() * arena.world.width, y: random() * arena.world.height,
      mass: mass / number, radius: radius(mass / number) }));
    if (number > 1) p.parts = parts;
    else Object.assign(p, parts[0], { id: p.id });
  }
  const h = new ArenaHazards(arena);
  // Stable IDs allow exact assertions without masking the placement fields.
  let serial = 0; const create = h.create;
  h.create = function (...args) { return { ...create.apply(this, args), id: `h${++serial}` }; };
  h.setRun(seed % 2 ? { id: "easter" } : null);
  return { h, arena, rng: () => state };
}
function view(s) { return { items: s.h.items, recent: [...s.h.recent], nextAt: s.h.nextAt, rng: s.rng() }; }
module.exports = { linearReplenish, scene, view };
