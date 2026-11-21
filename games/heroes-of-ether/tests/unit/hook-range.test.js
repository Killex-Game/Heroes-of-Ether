"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena } = require("../../src/server/arena/arena-simulation");
test("hook travels 750 instead of 1000 units, at unchanged 200 units/s, and cannot hit beyond range", () => {
  for (const distance of [740, 790]) {
    const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
      a = arena.addPlayer(0, "a"),
      b = arena.addPlayer(0, "b");
    Object.assign(a, { x: 1000, y: 5000, protectedUntil: 0 });
    Object.assign(b, {
      x: 1000 + a.radius + 10 + distance + b.radius + 10,
      y: 5000,
      protectedUntil: 0,
    });
    arena.prepareBooster(
      a.id,
      { boosterId: "hook", spawnSerial: a.spawnSerial, aimX: 9000, aimY: 5000 },
      5000,
    )();
    const shot = arena.combat.shots[0],
      origin = shot.x;
    arena.combat.update(6000);
    assert.equal(shot.x - origin, 200);
    arena.combat.update(9000);
    assert.equal(arena.combat.shots.length, 0);
    assert.equal(arena.combat.pulls.has(b.id), distance === 740);
    assert.ok(shot.distanceTravelled <= 750 + 1e-7);
  }
});
