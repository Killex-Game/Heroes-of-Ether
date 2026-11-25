"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
function scene() {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const a = arena.addPlayer(0, "a"), b = arena.addPlayer(0, "b");
  for (const [p, x] of [[a, 1000], [b, 1400]]) Object.assign(p, {
    x, y: 5000, targetX: x, targetY: 5000, stopped: true,
    level: 121, mass: 1000, radius: radiusForMass(1000), protectedUntil: 0,
    nextMassDecayAt: Infinity,
  });
  return { arena, a, b };
}
function hit(arena, a, b, boosterId, now = 5000) {
  arena.combat.impact({ boosterId, ownerId: a.id, ownerLife: a.lifeId,
    dx: 1, dy: 0, x: b.x - 50, y: b.y, launchedAt: now }, b, now, arena.mainBody(b));
}
function launch(arena, p, boosterId, now) {
  arena.prepareBooster(p.id, { boosterId, spawnSerial: p.spawnSerial,
    aimX: 9000, aimY: 5000 }, now)();
}
const positions = (arena, p) => arena.bodies(p).map(({ x, y }) => ({ x, y }));
for (const id of ["hook", "glove"]) test(`stone permits ${id}; web blocks it until expiry`, () => {
  for (const root of ["stone", "web"]) {
    const { arena, a, b } = scene();
    hit(arena, a, b, root);
    const before = b.x;
    b.moveDirection = { x: 1000, y: 0 };
    arena.step(5050);
    if (root === "web") assert.equal(b.x, before);
    else assert.notEqual(b.x, before, "Stone permits confused movement");
    hit(arena, a, b, id, 5100);
    arena.step(5300);
    if (root === "stone") assert.ok(id === "hook" ? b.x < before : b.x > before);
    else {
      assert.equal(b.x, before);
      b.moveDirection = null;
      const expiry = b.effects.web;
      arena.step(expiry - 1); assert.equal(b.x, before);
      arena.step(expiry); assert.equal(b.x, before, "No queued impulse on release");
      hit(arena, a, b, id, expiry + 1); arena.step(expiry + 201);
      assert.ok(id === "hook" ? b.x < before : b.x > before);
    }
  }
});
test("web interrupts an existing push/pull and releases without residual travel", () => {
  for (const id of ["hook", "glove", "harpoon"]) {
    const { arena, a, b } = scene(), moving = id === "harpoon" ? a : b;
    hit(arena, a, b, id); arena.step(5100);
    hit(arena, moving === a ? b : a, moving, "web", 5150);
    const before = positions(arena, moving);
    for (const now of [5200, 5500, moving.effects.web - 1, moving.effects.web]) {
      arena.step(now); assert.deepEqual(positions(arena, moving), before);
    }
    assert.equal(arena.combat.pulls.has(moving.id), false);
  }
});
test("web blocks a newly launched harpoon, including its miss; stone does not", () => {
  for (const root of ["web", "stone"]) {
    const { arena, a, b } = scene(); hit(arena, a, b, root);
    launch(arena, b, "harpoon", 5100);
    const before = b.x;
    for (let now = 5150; now <= 8500; now += 50) arena.step(now);
    assert.equal(b.x === before, root === "web");
  }
});
test("vortex cannot move webbed parts and resumes after the effect expires", () => {
  const { arena, a, b } = scene();
  b.x = b.targetX = 1200;
  hit(arena, a, b, "web");
  const shot = { ownerId: a.id, ownerLife: a.lifeId };
  arena.combat.vortex(shot, .5, 5100); assert.equal(b.x, 1200);
  arena.combat.vortex(shot, .5, b.effects.web); assert.ok(b.x < 1200);
});
test("splitting damage still applies under web without launch, separation or merge movement", () => {
  const { arena, a, b } = scene(); hit(arena, a, b, "web");
  hit(arena, a, b, "rocket", 5100);
  assert.ok(b.parts.length > 1); assert.equal(b.mass, 1000);
  const before = positions(arena, b);
  assert.ok(before.every(p => p.x === 1400 && p.y === 5000));
  b.parts.forEach(p => { p.mergeAt = 5100; p.vx = 50; p.vy = 30; }); b.mergeAt = 5100;
  for (let now = 5150; now < 6000; now += 50) arena.step(now);
  assert.deepEqual(positions(arena, b), before);
  assert.ok(b.parts.every(p => p.vx === 0 && p.vy === 0));
  assert.equal(arena.splitPlayer(b, { spawnSerial: b.spawnSerial, sequence: 1 }, 6000), false);
});
test("growth at the wall preserves web anchors without losing the received mass", () => {
  const { arena, a, b } = scene(); b.x = arena.bodyBounds(b).minX;
  hit(arena, a, b, "web"); const x = b.x;
  launch(arena, b, "meat", 5100);
  // Exercise the common growth path and the final collection bounds pass.
  arena.gainMass(b, 500, undefined, 5150); arena.step(5200);
  assert.equal(b.x, x); assert.ok(b.mass > 1000);
  arena.step(b.effects.web); assert.ok(b.x > x);
});
test("overlapping stone and web keep the web anchor until its own deadline", () => {
  const { arena, a, b } = scene(); hit(arena, a, b, "web"); hit(arena, a, b, "stone", 9000);
  hit(arena, a, b, "glove", 5200); arena.step(5400); assert.equal(b.x, 1400);
  const expiry = b.effects.web; assert.ok(b.effects.stone > expiry);
  hit(arena, a, b, "glove", expiry); arena.step(expiry + 200); assert.ok(b.x > 1400);
});
