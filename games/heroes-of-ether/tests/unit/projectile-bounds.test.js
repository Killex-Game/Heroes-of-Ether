"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
function scene() {
  const arena = new Arena({ etherCount: 0, random: () => 0.5, world: { width: 10000, height: 10000 } });
  for (let i = 0; i < 35; i++) {
    const p = arena.addPlayer(0, "p" + i);
    Object.assign(p, { level: 600, protectedUntil: 0, stopped: true });
    p.parts = Array.from({ length: 8 }, (_, j) => {
      const mass = 250 + 100 * j;
      return { id: p.id + ":" + j, mass, radius: radiusForMass(mass),
        x: 500 + (i % 7) * 800 + (j % 4) * 100,
        y: 500 + Math.floor(i / 7) * 900 + Math.floor(j / 4) * 100, vx: 0, vy: 0 };
    });
    arena.syncParts(p);
  }
  return arena;
}
function checkHits(combat) {
  const hit = combat.hit;
  const stats = { calls: 0, cached: 0 };
  combat.hit = function (...args) {
    const actual = hit.apply(this, args), cache = this.hitBounds;
    this.hitBounds = null;
    const expected = hit.apply(this, args);
    this.hitBounds = cache;
    assert.equal(actual?.t, expected?.t);
    assert.equal(actual?.player, expected?.player);
    assert.equal(actual?.part, expected?.part);
    assert.deepEqual(actual?.contacts, expected?.contacts);
    stats.calls++; if (cache) stats.cached++;
    return actual;
  };
  return stats;
}
test("Projectile broad phase matches exact ordered scan through mixed booster updates", () => {
  const arena = scene(), combat = arena.combat, stats = checkHits(combat);
  const players = [...arena.players.values()];
  const ids = [...BOOSTERS.values()].filter(b => b.ready).map(b => b.id);
  for (let i = 0; i < ids.length; i++) {
    const p = players[i % players.length], part = p.parts[0];
    arena.prepareBooster(p.id, { boosterId: ids[i], spawnSerial: p.spawnSerial,
      aimX: part.x + 500, aimY: part.y }, 5000)();
  }
  for (let step = 1; step <= 100; step++) {
    combat.update(5000 + step * 50);
    assert.equal(combat.hitBounds, null, "Bounds cannot escape the combat step");
  }
  assert.ok(stats.cached > 100, `Must exercise the broad phase, got ${stats.cached}`);
});
test("Growth, splitting, fire and pulls invalidate cached player bounds immediately", () => {
  const arena = scene(), combat = arena.combat, stats = checkHits(combat);
  const [owner, target] = arena.players.values();
  combat.hitBounds = new Map();
  const probe = { boosterId: "freeze", ownerId: owner.id, ownerLife: owner.lifeId };
  const query = () => combat.hit(probe, 100, 500, 4000, 500, 6000);
  for (const id of ["cake", "rocket", "fire", "knuckles"]) {
    query(); assert.ok(combat.hitBounds.has(target));
    const part = arena.bodies(target)[0];
    const shot = { boosterId: id, ownerId: owner.id, ownerLife: owner.lifeId,
      x: part.x - part.radius, y: part.y, dx: 1, dy: 0, hitParts: new Set() };
    combat.impact(shot, target, 6000, part);
    assert.equal(combat.hitBounds.has(target), false);
    query();
  }
  combat.pulls.set(target.id, { life: target.lifeId, dx: 400, dy: 0, startedAt: 6000, applied: 0, duration: 500 });
  combat.movePull(target, 6250);
  assert.equal(combat.hitBounds.has(target), false);
  query(); assert.ok(stats.cached > 0);
});
test("Combat exceptions discard cached bounds", () => {
  const arena = scene(), combat = arena.combat;
  combat.shots = Array(8).fill({});
  combat.updateProjectiles = () => { assert.ok(combat.hitBounds); throw Error("injected failure"); };
  assert.throws(() => combat.update(1), /injected failure/);
  assert.equal(combat.hitBounds, null);
  assert.equal(combat.hitCandidates, null);
  assert.equal(combat.indexHits, false);
});

test("Column candidates match ordered scans after moves, growth, split and removals", () => {
  const arena = scene(), combat = arena.combat, players = [...arena.players.values()];
  const check = checkHits(combat);
  let seed = 29173;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  combat.hitBounds = new Map(); combat.indexHits = true;
  for (let i = 0; i < 3000; i++) {
    if (i % 79 === 0) {
      const p = players[i % players.length];
      for (const part of p.parts) { part.x = random() * 6000; part.radius *= 1.03; }
      if (i % 158 === 0) p.parts.push({ ...p.parts[0], id: 'extra-' + i, x: random() * 6000 });
      if (i % 237 === 0 && p.parts.length > 1) p.parts.shift();
      combat.invalidateHitBounds(p);
    }
    const ax = random() * 6000, ay = random() * 5000;
    const shot = {boosterId:'freeze',ownerId:players[0].id,landed:i%4===0,hitParts:new Set()};
    combat.hit(shot, ax, ay, ax + (i%3 ? 12 : 1300), ay + random()*200, 6000);
  }
  assert.equal(check.calls, 3000);
  assert.ok(combat.hitCandidates);
});

test("A same-step moved target enters a previously empty projectile column", () => {
  const arena=scene(),combat=arena.combat,players=[...arena.players.values()];
  const shot={boosterId:'freeze',ownerId:players[0].id};
  combat.hitBounds=new Map();combat.indexHits=true;
  assert.equal(combat.hit(shot,9000,9000,9001,9000,6000),null);
  const target=players[1],part=target.parts[0];
  part.x=9000;part.y=9000;combat.invalidateHitBounds(target);
  assert.equal(combat.hit(shot,9000,9000,9001,9000,6000)?.part,part);
  target.dead=true;
  assert.equal(combat.hit(shot,9000,9000,9001,9000,6000),null);
});
