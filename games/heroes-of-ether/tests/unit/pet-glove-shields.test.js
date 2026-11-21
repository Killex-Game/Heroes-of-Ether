"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const pets = require("../../src/server/pets/arena-pets");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");

function scene(parts = false) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const owner = arena.addPlayer(0, "owner"), target = arena.addPlayer(0, "target");
  for (const [p, x] of [[owner, 1000], [target, 1300]]) {
    Object.assign(p, { x, y: 5000, mass: 100, radius: radiusForMass(100),
      targetX: x, targetY: 5000, protectedUntil: 0, stopped: true, level: 501 });
  }
  if (parts) {
    target.parts = [0, 200].map((offset, i) => ({ id: i ? "sibling" : target.mainPartId,
      x: target.x, y: target.y + offset, mass: 100, radius: radiusForMass(100), vx: 0, vy: 0 }));
    arena.syncParts(target);
  }
  pets.start(owner, { level: 501, pets: { equipped: "manya", owned: {
    manya: { games: 5000, vitalityMs: 60000, refillAt: 50000 } } } }, 5000, 5000);
  owner.pet.stock.claw = 0;
  const message = { spawnSerial: owner.spawnSerial, requestId: "glove-hit-0001",
    sequence: 1, ability: "secondary", aimX: 9000, aimY: 5000 };
  const fire = () => {
    const before = owner.pet.stock.glove;
    assert.equal(pets.use(arena, owner, message, 5000).kind, "glove");
    assert.equal(pets.use(arena, owner, message, 5000).replay, true);
    assert.equal(owner.pet.stock.glove, before - 1);
    assert.equal(arena.combat.shots.length, 1);
    return arena.combat.shots[0];
  };
  return { arena, owner, target, fire };
}

for (const shield of [null, "colorful_shield", "sphere", "golden_shield"]) {
  test(`Pet glove splits the contacted part through ${shield || "no shield"}`, () => {
    for (const siblings of [false, true]) {
      const { arena, target, fire } = scene(siblings);
      if (shield) target.effects[shield] = 20000;
      target.effects.poison = 18000;
      target.shieldReadyAt = { golden_shield: 22000 };
      fire();
      arena.combat.update(7000);
      assert.equal(arena.combat.shots.length, 0);
      assert.deepEqual(arena.bodies(target).map(p => p.mass).sort((a,b) => a-b),
        siblings ? [50, 50, 100] : [50, 50]);
      assert.equal(target.mass, siblings ? 200 : 100);
      assert.deepEqual(target.effects, { poison: 18000 });
      assert.deepEqual(target.shieldReadyAt, { golden_shield: 22000 });
      if (siblings) assert.equal(arena.bodies(target).find(p => p.id === "sibling").y, 5200);
    }
  });
}

test("Pet glove reflects from clan shield without stripping stacked shields or extending its flight", () => {
  const { arena, owner, target, fire } = scene();
  target.effects = { clan_shield: 20000, golden_shield: 18000 };
  const shot = fire(), deadline = shot.landsAt;
  assert.ok(Number.isFinite(deadline) && deadline > 5000);
  for (let now = 5050; now < 7000 && shot.ownerId === owner.id; now += 50)
    arena.combat.update(now);
  assert.equal(shot.ownerId, target.id);
  assert.equal(shot.landsAt, deadline);
  assert.deepEqual(target.effects, { clan_shield: 20000, golden_shield: 18000 });
  assert.equal(arena.bodies(target).length, 1);
  assert.equal(target.mass, 100);
  assert.ok(shot.dx < 0);
});

test("Spawn protection still stops pet glove before stripping or splitting", () => {
  const { arena, target, fire } = scene();
  target.protectedUntil = 20000;
  target.effects.golden_shield = 18000;
  fire();
  arena.combat.update(7000);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(target.effects.golden_shield, 18000);
  assert.equal(arena.bodies(target).length, 1);
});

test("At the part limit pet glove removes an ordinary shield without extra damage", () => {
  const { arena, target, fire } = scene();
  target.parts = Array.from({ length: 16 }, (_, i) => ({
    id: i ? "sibling" + i : target.mainPartId, x: target.x, y: target.y + i * 100,
    mass: 100, radius: radiusForMass(100), vx: 0, vy: 0,
  }));
  arena.syncParts(target);
  target.effects.golden_shield = 20000;
  fire();
  arena.combat.update(7000);
  assert.equal(target.effects.golden_shield, undefined);
  assert.equal(arena.bodies(target).length, 16);
  assert.equal(target.mass, 1600);
});

test("Ordinary axe remains blocked by ordinary shields", () => {
  const { arena, owner, target } = scene();
  target.effects.golden_shield = 20000;
  arena.combat.prepare(owner, BOOSTERS.get("axe"), { aimX: 9000, aimY: 5000 }, 5000)();
  arena.combat.update(7000);
  assert.equal(target.effects.golden_shield, 20000);
  assert.equal(arena.bodies(target).length, 1);
});
