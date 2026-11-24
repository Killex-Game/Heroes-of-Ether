"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS, BOOSTER_RULES: R } = require("../../src/server/boosters/booster-catalog");
const shields = ["colorful_shield", "sphere", "golden_shield", "clan_shield"];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

function scene(parts = false) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const owner = arena.addPlayer(0, "owner");
  const target = arena.addPlayer(0, "target");
  for (const [p, x] of [
    [owner, 1000],
    [target, 1300],
  ]) {
    Object.assign(p, {
      x,
      y: 5000,
      mass: 100,
      radius: radiusForMass(100),
      targetX: x,
      targetY: 5000,
      protectedUntil: 0,
      stopped: true,
      level: 501,
    });
    if (parts) {
      p.parts = [0, 200].map((offset, i) => ({
        id: i ? p.id + "-sibling" : p.mainPartId,
        x,
        y: 5000 + offset,
        mass: 100,
        radius: radiusForMass(100),
        vx: 0,
        vy: 0,
      }));
      arena.syncParts(p);
    }
  }
  return { arena, owner, target };
}

test("Knuckles keeps moving outward when a moving shield overlaps the reflected contact", () => {
  const { arena, owner, target } = scene();
  target.effects.clan_shield = 20000;
  arena.combat.prepare(owner, BOOSTERS.get("knuckles"), { aimX: 9000, aimY: 5000 }, 5000)();
  const shot = arena.combat.shots[0];
  shot.x = target.x - target.radius - R.PROJECTILE_RADIUS;
  arena.combat.impact(shot, target, 5000);
  const before = shot.x, version = shot.motionVersion;
  target.x -= 5;
  arena.combat.update(5050);
  assert(shot.x < before, "flight must not freeze at zero-length repeated contacts");
  assert.equal(shot.motionVersion, version, "the same outgoing contact is not reflected twice");
});

test("A projectile can bounce between clan shields repeatedly without a permanent contact blacklist", () => {
  const { arena, owner, target } = scene();
  owner.effects.clan_shield = target.effects.clan_shield = 30000;
  arena.combat.prepare(owner, BOOSTERS.get("knuckles"), { aimX: 9000, aimY: 5000 }, 5000)();
  const shot = arena.combat.shots[0];
  for (let now = 5050; now <= 11000; now += 50) arena.combat.update(now);
  assert(shot.motionVersion >= 3);
  assert.equal(owner.mass, 100);
  assert.equal(target.mass, 100);
});

for (const shield of shields) {
  test(`Harpoon hitting ${shield} pulls only its original thrower, including split players`, () => {
    for (const parts of [false, true]) {
      const { arena, owner, target } = scene(parts);
      target.effects[shield] = 20000;
      const beforeOwner = arena.bodies(owner).map((part) => ({ x: part.x, y: part.y }));
      const beforeTarget = arena
        .bodies(target)
        .map((part) => ({ x: part.x, y: part.y, mass: part.mass }));
      arena.combat.prepare(owner, BOOSTERS.get("harpoon"), { aimX: 9000, aimY: 5000 }, 5000)();
      const shot = arena.combat.shots[0];
      let now = 5000;
      while (arena.combat.shots.length && now < 7100) arena.combat.update((now += 50));
      assert.equal(arena.combat.shots.length, 0, "shield contact consumes the projectile");
      assert.equal(shot.ownerId, owner.id, "clan shield must not transfer harpoon ownership");
      assert.equal(shot.ownerLife, owner.lifeId);
      assert.equal(arena.combat.pulls.get(owner.id)?.kind, "harpoon");
      assert.equal(arena.combat.pulls.has(target.id), false);
      near(shot.x, target.x - radiusForMass(100) - R.PROJECTILE_RADIUS);
      for (let elapsed = 50; elapsed <= R.PULL_MS; elapsed += 50) {
        arena.combat.movePull(owner, now + elapsed);
        arena.combat.movePull(target, now + elapsed);
      }
      arena.bodies(owner).forEach((part, i) => {
        near(part.x - beforeOwner[i].x, R.HARPOON_SPEED);
        near(part.y, beforeOwner[i].y);
      });
      assert.deepEqual(
        arena.bodies(target).map((part) => ({ x: part.x, y: part.y, mass: part.mass })),
        beforeTarget,
      );
      assert.equal(target.effects[shield], 20000, "harpoon does not strip the shield");
      assert.equal(arena.combat.pulls.size, 0);
    }
  });

  test(`Awl and pet claw only remove ${shield}, preserving damage effects and cooldowns`, () => {
    for (const pet of [false, true]) {
      const { arena, owner, target } = scene();
      target.effects[shield] = 20000;
      target.effects.poison = 18000;
      target.shieldReadyAt = { [shield]: 25000 };
      target.boosterReadyAt = 12000;
      target.boosterItemReadyAt = { fire: 15000 };
      const booster = pet
        ? { ...BOOSTERS.get("awl"), id: "pet_claw", pet: true }
        : BOOSTERS.get("awl");
      arena.combat.prepare(owner, booster, { aimX: 9000, aimY: 5000 }, 5000)();
      arena.combat.update(7000);
      assert.equal(arena.combat.shots.length, 0);
      assert.deepEqual(target.effects, { poison: 18000 });
      assert.deepEqual(target.shieldReadyAt, { [shield]: 25000 });
      assert.deepEqual(target.boosterItemReadyAt, { fire: 15000 });
      assert.equal(target.boosterReadyAt, 12000);
      assert.equal(target.mass, 100);
      assert.equal(arena.combat.pulls.size, 0);
    }
  });
}

test("All five warheads travel at double speed and keep the same range", () => {
  const { arena, owner, target } = scene();
  target.y = 9000;
  arena.combat.prepare(owner, BOOSTERS.get("warheads"), { aimX: 9000, aimY: 5000 }, 5000)();
  const shots = arena.combat.shots.slice();
  const origins = shots.map((shot) => ({ x: shot.x, y: shot.y }));
  assert.equal(shots.length, 5);
  arena.combat.update(5500);
  shots.forEach((shot, i) => near(Math.hypot(shot.x - origins[i].x, shot.y - origins[i].y), 100));
  arena.combat.update(7001);
  assert.equal(arena.combat.shots.length, 0);
  shots.forEach((shot, i) => near(Math.hypot(shot.x - origins[i].x, shot.y - origins[i].y), 400));
});
