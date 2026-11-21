"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass, RULES } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
function scene(mass) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    p = arena.addPlayer(0, "target");
  Object.assign(p, {
    x: 5000,
    y: 5000,
    targetX: 5100,
    targetY: 5000,
    mass,
    radius: radiusForMass(mass),
    protectedUntil: 0,
  });
  return { arena, p };
}
test("Single hit: low and high masses preserve every mass unit, unique IDs and legal maximum", () => {
  for (const mass of [
    ...Array.from({ length: 64 }, (_, i) => i + 2),
    100,
    5000,
    40000,
    150000,
    1000000,
  ]) {
    const { arena, p } = scene(mass);
    let settled = 0;
    const settle = arena.separateParts.bind(arena);
    arena.separateParts = (...args) => {
      settled++;
      return settle(...args);
    };
    arena.boosterEffects.splitToLimit(p, 5000);
    const parts = arena.bodies(p);
    assert.equal(parts.length, Math.min(RULES.MAX_PARTS, Math.floor(mass / 2)), String(mass));
    assert.equal(
      parts.reduce((s, b) => s + b.mass, 0),
      mass,
    );
    assert.equal(p.mass, mass);
    assert.equal(new Set(parts.map((b) => arena.bodyId(p, b))).size, parts.length);
    assert.ok(
      parts.every(
        (b) => Number.isInteger(b.mass) && b.mass >= 2 && b.radius === radiusForMass(b.mass),
      ),
    );
    assert.equal(settled, parts.length > 1 ? 1 : 0);
    if (parts.length > 1) assert.ok(parts.every((b) => b.mergeAt === 5000 + RULES.MERGE_DELAY_MS));
  }
});
test("A hit during sword burn keeps the remaining damage budget and other effects", () => {
  const { arena, p } = scene(16000);
  arena.boosterEffects.apply(p, BOOSTERS.get("fire_sword"), 4000);
  p.effects.lock = 20000;
  p.effects.freeze = 18000;
  arena.boosterEffects.splitToLimit(p, 4500);
  const mass = p.mass,
    remaining = p.swordBurns.reduce((s, b) => s + b.budget - b.applied, 0);
  assert.equal(p.parts.length, 16);
  assert.equal(p.effects.lock, 20000);
  assert.equal(p.effects.freeze, 18000);
  arena.boosterEffects.tickSwordBurns(p, 20000);
  assert.equal(p.mass, mass - remaining);
  assert.equal(p.swordBurns.length, 0);
});
test("Many simultaneous Knuckles cannot exceed the cap or drain mass", () => {
  const { arena, p } = scene(40000);
  const owner = arena.addPlayer(0, "owner");
  for (let i = 0; i < 100; i++)
    arena.combat.impact(
      {
        boosterId: "knuckles",
        ownerId: owner.id,
        ownerLife: owner.lifeId,
        x: 5000,
        y: 5000,
        dx: 1,
        dy: 0,
      },
      p,
      5000,
    );
  assert.equal(p.parts.length, 16);
  assert.equal(p.mass, 40000);
  assert.equal(p.effects.knuckles, undefined);
});
