"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTER_RULES: R } = require("../../src/server/boosters/booster-catalog");
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("Гарпун прижимает части к краям отдельно, не прерывая тягу остальных", () => {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2],
  ]) {
    const arena = new Arena({ etherCount: 0, world: { width: 5000, height: 5000 } });
    const p = arena.addPlayer(0, "moving");
    p.parts = [20, 100, 500].map((mass, i) => {
      const body = {
        id: i ? "part-" + i : p.mainPartId,
        mass,
        radius: radiusForMass(mass),
        vx: 3,
        vy: 2,
      };
      const edge = arena.bodyBounds(body);
      body.x = dx > 0 ? edge.maxX - i * 400 : dx < 0 ? edge.minX + i * 400 : 2500;
      body.y = dy > 0 ? edge.maxY - i * 400 : dy < 0 ? edge.minY + i * 400 : 2500;
      return body;
    });
    arena.syncParts(p);
    const original = p.parts.map((part) => ({ ...part }));
    arena.combat.pullToPoint(
      { ownerId: p.id, ownerLife: p.lifeId, dx, dy },
      p.x + dx,
      p.y + dy,
      5000,
    );
    for (let elapsed = 50; elapsed <= 1000; elapsed += 50) {
      arena.combat.movePull(p, 5000 + elapsed);
      for (const [i, part] of p.parts.entries()) {
        const edge = arena.bodyBounds(part),
          step = (R.HARPOON_SPEED * elapsed) / 1000;
        near(part.x, Math.max(edge.minX, Math.min(edge.maxX, original[i].x + dx * step)));
        near(part.y, Math.max(edge.minY, Math.min(edge.maxY, original[i].y + dy * step)));
        near(part.mass, original[i].mass);
      }
      assert.equal(arena.combat.pulls.has(p.id), elapsed < 1000);
    }
    near(p.mass, 620);
  }
});

test("Частые попадания Гарпуна не обнуляют движение текущего такта", () => {
  const arena = new Arena({ etherCount: 0, world: { width: 20000, height: 20000 } });
  const p = arena.addPlayer(0, "moving");
  Object.assign(p, { x: 10000, y: 10000 });
  const shot = { ownerId: p.id, ownerLife: p.lifeId, dx: 1, dy: 0 };
  arena.combat.pullToPoint(shot, p.x + 100, p.y, 5000);
  for (let at = 5050; at <= 5500; at += 50) {
    // Projectile hits are processed before movePull in Arena.step.
    arena.combat.pullToPoint(shot, p.x + 100, p.y, at);
    arena.combat.movePull(p, at);
    near(p.x - 10000, (R.HARPOON_SPEED * (at - 5000)) / 1000);
    // Another hit at the same time must not move the player twice.
    arena.combat.pullToPoint(shot, p.x + 100, p.y, at);
    arena.combat.movePull(p, at);
    near(p.x - 10000, (R.HARPOON_SPEED * (at - 5000)) / 1000);
  }
  arena.combat.movePull(p, 6500);
  near(p.x - 10000, R.HARPOON_SPEED * 1.5);
});

test("Запоздавший снаряд не разворачивает Гарпун назад после обгона точки попадания", () => {
  const arena = new Arena({ etherCount: 0, world: { width: 20000, height: 20000 } });
  const p = arena.addPlayer(0, "moving");
  Object.assign(p, { x: 10000, y: 10000 });
  const shot = { ownerId: p.id, ownerLife: p.lifeId, dx: 1, dy: 0 };
  arena.combat.pullToPoint(shot, 10100, 10000, 5000);
  arena.combat.movePull(p, 5500);
  const start = p.x;
  arena.combat.pullToPoint(shot, 10150, 10000, 5500);
  arena.combat.movePull(p, 6500);
  near(p.x - start, R.HARPOON_SPEED);
});

test("Несколько летящих Гарпунов при промахах сохраняют движение на каждом шаге арены", () => {
  const arena = new Arena({ etherCount: 0, world: { width: 20000, height: 20000 } });
  const p = arena.addPlayer(0, "moving");
  Object.assign(p, {
    x: 10000,
    y: 10000,
    targetX: 10000,
    targetY: 10000,
    protectedUntil: 0,
    stopped: true,
    nextMassDecayAt: Infinity,
  });
  for (let at = 3000; at <= 4200; at += 300) {
    arena.prepareBooster(
      p.id,
      {
        boosterId: "harpoon",
        spawnSerial: p.spawnSerial,
        aimX: 19000,
        aimY: 10000,
      },
      at,
    )();
  }
  for (let at = 4250; at <= 7200; at += 50) {
    arena.step(at);
    near(p.x - 10000, (R.HARPOON_SPEED * Math.max(0, at - 5000)) / 1000);
    near(p.y, 10000);
  }
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(arena.combat.pulls.size, 0);
});

test("Скорость Гарпуна одинакова на близком и дальнем пути при разной массе и числе частей", () => {
  for (const mass of [20, 1000, 75000])
    for (const distance of [80, 300, 1200]) {
      for (const count of [1, 4])
        for (const angle of [0, Math.PI / 4, Math.PI, -Math.PI / 2]) {
          const arena = new Arena({ etherCount: 0, world: { width: 20000, height: 20000 } });
          const p = arena.addPlayer(0, "moving");
          Object.assign(p, {
            x: 10000,
            y: 10000,
            mass,
            radius: radiusForMass(mass),
            protectedUntil: 0,
          });
          if (count > 1) {
            p.parts = Array.from({ length: count }, (_, i) => ({
              id: i ? "part" + i : p.mainPartId,
              x: p.x,
              y: p.y + i * 100,
              mass,
              radius: radiusForMass(mass),
              vx: 10,
              vy: -10,
            }));
            arena.syncParts(p);
          }
          const origin = { x: p.x, y: p.y },
            parts = arena.bodies(p).map((b) => ({ x: b.x, y: b.y }));
          arena.combat.pullToPoint(
            { ownerId: p.id, ownerLife: p.lifeId },
            origin.x + Math.cos(angle) * distance,
            origin.y + Math.sin(angle) * distance,
            5000,
          );
          const duration = arena.combat.pulls.get(p.id).duration;
          let previousTime = 5000,
            previous = { x: p.x, y: p.y };
          for (const fraction of [0.1, 0.3, 0.7, 1]) {
            p.targetX = 0;
            p.targetY = 0;
            const now = 5000 + duration * fraction;
            arena.combat.movePull(p, now);
            near(
              (Math.hypot(p.x - previous.x, p.y - previous.y) / (now - previousTime)) * 1000,
              R.HARPOON_SPEED,
            );
            arena.bodies(p).forEach((b, i) => {
              near(b.x - parts[i].x, Math.cos(angle) * R.HARPOON_SPEED * fraction);
              near(b.y - parts[i].y, Math.sin(angle) * R.HARPOON_SPEED * fraction);
            });
            previous = { x: p.x, y: p.y };
            previousTime = now;
          }
          arena.combat.movePull(p, 5000 + duration + 1);
          assert.equal(arena.combat.pulls.has(p.id), false);
        }
    }
});

test("Раннее поглощение не сокращает фиксированный рывок Гарпуна, позднее оставляет 400 мс", () => {
  for (const distance of [80, 300, 1200]) {
    for (const fraction of [0, 0.05, 0.5, 0.8, 1]) {
      const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
      const p = arena.addPlayer(0, "moving");
      Object.assign(p, { x: 5000, y: 5000 });
      arena.combat.pullToPoint({ ownerId: p.id, ownerLife: p.lifeId }, 5000 + distance, 5000, 5000);
      const at = 5000 + arena.combat.pulls.get(p.id).duration * fraction;
      arena.combat.movePull(p, at);
      const start = p.x;
      arena.combat.continuePullAfterAbsorption(p.id, "victim", at, "harpoon");
      // Поглощение изменяет массу, но не тягу.
      p.mass = 1000;
      p.radius = radiusForMass(1000);
      const duration = Math.max(400, 1000 * (1 - fraction));
      near(arena.combat.pulls.get(p.id).duration, duration);
      for (let elapsed = 50; elapsed <= duration; elapsed += 50) {
        arena.combat.movePull(p, at + elapsed);
        near(p.x, start + (elapsed * R.HARPOON_SPEED) / 1000);
        arena.combat.continuePullAfterAbsorption(p.id, "next-victim", at + elapsed, "harpoon");
      }
      near(p.x - start, (duration * R.HARPOON_SPEED) / 1000);
      assert.equal(arena.combat.pulls.has(p.id), false);
    }
  }
});

test("Близкое и дальнее попадания с настоящим поглощением дают полный рывок 612", () => {
  for (const distance of [170, 450]) {
    const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
    const owner = arena.addPlayer(0, "owner"),
      target = arena.addPlayer(0, "target");
    Object.assign(owner, {
      x: 5000,
      y: 5000,
      mass: 1000,
      radius: radiusForMass(1000),
      level: 151,
      targetX: 5000,
      targetY: 5000,
      protectedUntil: 0,
      stopped: true,
      nextMassDecayAt: Infinity,
    });
    Object.assign(target, {
      x: 5000 + distance,
      y: 5000,
      targetX: 5000 + distance,
      targetY: 5000,
      protectedUntil: 0,
      stopped: true,
      nextMassDecayAt: Infinity,
    });
    arena.prepareBooster(
      owner.id,
      { boosterId: "harpoon", spawnSerial: owner.spawnSerial, aimX: target.x, aimY: target.y },
      5000,
    )();
    let start = null,
      at = 5000,
      eaten = false;
    while (at < 10000) {
      at += 50;
      const before = owner.x;
      const events = arena.step(at);
      if (start === null && arena.combat.pulls.has(owner.id)) start = at;
      if (start !== null && at > start) near(owner.x - before, R.HARPOON_SPEED * 0.05);
      if (events.some((e) => e.type === "absorbed" && e.eaterId === owner.id)) eaten = true;
      if (start !== null && !arena.combat.pulls.has(owner.id)) break;
    }
    assert.ok(eaten && target.dead, "victim actually consumed at distance " + distance);
    near(at - start, R.PULL_MS);
    near(owner.x - 5000, R.HARPOON_SPEED);
  }
});
