"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
for (const id of ["mine", "web", "stone"])
  for (const clan of [false, true])
    test(`${id}: установленная ловушка поглощается ${clan ? "клановым" : "обычным"} щитом`, () => {
      const arena = new Arena({ etherCount: 0 }),
        a = arena.addPlayer(0, "a"),
        b = arena.addPlayer(0, "b");
      Object.assign(a, { x: 1000, y: 1000, protectedUntil: 0 });
      Object.assign(b, {
        x: 2000,
        y: 1000,
        mass: 100,
        radius: radiusForMass(100),
        protectedUntil: 0,
      });
      const booster = BOOSTERS.get(id);
      arena.combat.prepare(a, booster, { aimX: 2500, aimY: 1000 }, 5000)();
      const shot = arena.combat.shots[0];
      Object.assign(shot, { x: b.x, y: b.y, landed: true, landsAt: 6000, lastAt: 6000 });
      b.effects[clan ? "clan_shield" : "colorful_shield"] = 30000;
      arena.combat.update(7000);
      assert.equal(arena.combat.shots.length, 0);
      assert.equal(b.mass, 100);
      assert.equal(b.parts?.length || 1, 1);
      assert.equal(b.effects[id], undefined);
      assert.equal(shot.ownerId, a.id);
      assert.equal(shot.landsAt, 6000);
      arena.combat.update(12000);
      assert.equal(arena.combat.shots.length, 0);
    });
for (const id of ["mine", "web", "stone"])
  test(`${id}: летящий снаряд по-прежнему отражается`, () => {
    const arena = new Arena({ etherCount: 0 }),
      a = arena.addPlayer(0, "a"),
      b = arena.addPlayer(0, "b");
    Object.assign(a, { x: 1000, y: 1000, protectedUntil: 0 });
    Object.assign(b, { x: 2000, y: 1000, protectedUntil: 0 });
    arena.combat.prepare(a, BOOSTERS.get(id), { aimX: 2500, aimY: 1000 }, 5000)();
    const shot = arena.combat.shots[0],
      deadline = shot.landsAt;
    b.effects.clan_shield = 30000;
    assert.equal(arena.combat.impact(shot, b, 5100), "reflected");
    assert.equal(shot.ownerId, b.id);
    assert.equal(shot.landsAt, deadline);
    assert.ok(!shot.landed);
  });
