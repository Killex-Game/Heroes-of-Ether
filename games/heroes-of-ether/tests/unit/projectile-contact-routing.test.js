"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const { route, clearSegment } = require("../../src/server/arena/projectile-route");
const { vortexRadius } = require("../../src/server/arena/projectile-combat");

test("Вихрь с 16 частями сохраняет ближайшую цель и перемещение еды при быстром поиске", () => {
  const arena = new Arena({ etherCount: 0 }),
    owner = arena.addPlayer(0, "vortex-owner");
  owner.parts = Array.from({ length: 16 }, (_, i) => {
    const mass = 20 + i * 100;
    return {
      id: "v-" + i,
      mass,
      radius: radiusForMass(mass),
      x: 400 + (i % 4) * 200,
      y: 400 + Math.floor(i / 4) * 200,
    };
  });
  arena.syncParts(owner);
  let seed = 42;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  arena.ether = Array.from({ length: 1500 }, (_, i) => ({
    id: "f-" + i,
    x: random() * 3000,
    y: random() * 2200,
    radius: i % 3 ? 5.5 : 9,
  }));
  const shot = { ownerId: owner.id, ownerLife: owner.lifeId };
  for (const dt of [0.05, 0.12]) {
    const expected = arena.ether.map((food) => {
      let source = null,
        nearest = Infinity;
      for (const part of owner.parts) {
        const distance = Math.hypot(part.x - food.x, part.y - food.y);
        if (distance <= vortexRadius(part) + food.radius && distance < nearest) {
          source = part;
          nearest = distance;
        }
      }
      if (!source || !nearest) return { ...food };
      const ratio = Math.min(1, (100 * dt) / nearest);
      return { x: food.x + (source.x - food.x) * ratio, y: food.y + (source.y - food.y) * ratio };
    });
    arena.combat.vortex(shot, dt, 5000);
    arena.ether.forEach((food, i) =>
      assert.ok(Math.hypot(food.x - expected[i].x, food.y - expected[i].y) < 1e-9),
    );
    // Recompute ranges after growth and merging, never reuse stale source radii.
    owner.parts.pop();
    owner.parts[0].mass = 4000;
    owner.parts[0].radius = radiusForMass(4000);
    arena.syncParts(owner);
  }
});

test("Все летящие бустеры регистрируют первое касание края, в том числе скользящее", () => {
  for (const booster of BOOSTERS.values()) {
    if (booster.target !== "direction" || booster.kind === "sword") continue;
    const arena = new Arena({ etherCount: 0, world: { width: 2000, height: 2000 } });
    const a = arena.addPlayer(0, "a"),
      b = arena.addPlayer(0, "b");
    for (const p of [a, b]) Object.assign(p, { protectedUntil: 0, level: 100 });
    Object.assign(a, { x: 500, y: 1000, stopped: true });
    Object.assign(b, { x: 610, y: 1000 + b.radius + 9 });
    const hits = [];
    arena.combat.impact = (shot, player) => hits.push({ x: shot.x, y: shot.y, player });
    arena.combat.prepare(
      a,
      booster,
      { aimX: booster.id === "mine" ? 0 : 1900, aimY: 1000 },
      5000,
    )();
    for (let t = 5050; t <= 6000; t += 50) arena.combat.update(t);
    assert.ok(
      hits.some((h) => h.player === b),
      booster.id,
    );
    if (booster.kind !== "fire")
      for (const h of hits)
        assert.ok(Math.hypot(h.x - b.x, h.y - b.y) >= b.radius + 9.99, booster.id);
  }
});

test("Неогненные попадания передают конечную точку, не пролетают к следующему шару", () => {
  for (const booster of BOOSTERS.values()) {
    if (booster.target !== "direction" || booster.kind === "sword") continue;
    const arena = new Arena({ etherCount: 0, world: { width: 3000, height: 2000 } });
    const a = arena.addPlayer(0, "a"),
      b = arena.addPlayer(0, "b"),
      c = arena.addPlayer(0, "c");
    for (const [p, x] of [
      [a, 500],
      [b, 650],
      [c, 720],
    ])
      Object.assign(p, {
        x,
        y: 1000,
        mass: 20,
        radius: radiusForMass(20),
        protectedUntil: 0,
        stopped: true,
      });
    const hits = [];
    arena.combat.impact = (shot, player) => {
      hits.push(player.id);
    };
    arena.combat.prepare(
      a,
      booster,
      { aimX: booster.id === "mine" ? 0 : 2800, aimY: 1000 },
      5000,
    )();
    // A large update sweeps through both balls; no endpoint-only collision check.
    arena.tick = 123;
    arena.combat.update(7000);
    assert.ok(hits.includes("b"), booster.id);
    if (booster.kind === "fire") {
      assert.ok(hits.includes("c"));
      assert.equal(arena.combat.contacts.length, 0);
    } else {
      assert.ok(!hits.includes("c"), booster.id);
      assert.ok(arena.combat.contacts.length > 0, booster.id);
      for (const event of arena.combat.contacts) {
        assert.equal(event.tick, 123);
        assert.ok(Math.hypot(event.shot.x - b.x, event.shot.y - b.y) >= b.radius + 9.99);
        assert.equal(event.hold, booster.kind === "pull");
      }
    }
  }
});
test("Утилита маршрута обходит закрытый прямой путь по внешним сегментам", () => {
  const circles = [
    { x: 300, y: 300, r: 60 },
    { x: 415, y: 300, r: 60 },
  ];
  const start = { x: 240, y: 300 },
    world = { width: 1000, height: 1000 };
  const path = route(start, circles, [circles[1]], world);
  assert.ok(path.length > 1);
  let previous = start;
  for (const point of path) {
    assert.ok(clearSegment(previous, point, circles));
    previous = point;
  }
  assert.ok(Math.abs(Math.hypot(previous.x - 415, previous.y - 300) - 60) < 0.001);
});

test("Камень летит 4 секунды со скоростью 180 на 720 единиц и остаётся ловушкой", () => {
  const arena = new Arena({ etherCount: 0, world: { width: 5000, height: 5000 } });
  const p = arena.addPlayer(0, "p");
  Object.assign(p, { x: 1000, y: 1000, protectedUntil: 0 });
  arena.combat.prepare(p, BOOSTERS.get("stone"), { aimX: 4000, aimY: 1000 }, 5000)();
  const shot = arena.combat.shots[0],
    start = shot.x;
  arena.combat.update(5500);
  assert.equal(shot.x - start, 90);
  arena.combat.update(9000);
  assert.ok(Math.abs(shot.x - start - 720) < 1e-7);
  assert.equal(shot.landed, true);
  assert.equal(arena.combat.shots.length, 1);
});
test("Вихрь: разные радиусы частей, одно притяжение в перекрытии, защита щитом", () => {
  const arena = new Arena({ etherCount: 0 }),
    a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  a.protectedUntil = b.protectedUntil = 0;
  a.parts = [20, 1000].map((mass, i) => ({
    id: i ? "second" : a.mainPartId,
    mass,
    radius: radiusForMass(mass),
    x: 500 + i * 100,
    y: 500,
  }));
  arena.syncParts(a);
  Object.assign(b, { x: 550, y: 600 });
  arena.combat.prepare(a, BOOSTERS.get("vortex"), {}, 5000)();
  const views = arena.combat.snapshot();
  assert.equal(views.length, 2);
  assert.ok(views[1].areaRadius > views[0].areaRadius);
  const x = b.x,
    y = b.y;
  arena.combat.update(5050);
  assert.ok(Math.abs(Math.hypot(b.x - x, b.y - y) - 5) < 1e-8);
  b.effects.sphere = 9000;
  const bx = b.x,
    by = b.y;
  arena.combat.update(5100);
  assert.deepEqual([b.x, b.y], [bx, by]);
  assert.equal(vortexRadius(a.parts[0]), views[0].areaRadius);
  a.parts.splice(1);
  arena.syncParts(a);
  assert.equal(arena.combat.snapshot().length, 1);
});
test("Новая жизнь 20, обычное деление 4 → 2 + 2, масса не теряется", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p");
  assert.equal(p.mass, 20);
  p.mass = 4;
  p.radius = radiusForMass(4);
  assert.equal(arena.splitPlayer(p, { spawnSerial: p.spawnSerial, sequence: 1 }, 5000), true);
  assert.deepEqual(
    p.parts.map((b) => b.mass),
    [2, 2],
  );
  assert.equal(arena.splitPlayer(p, { spawnSerial: p.spawnSerial, sequence: 2 }, 5000), false);
});

test("Вихрь передаёт захваченного соперника от малых частей к крупнейшей, еду тянет локально", () => {
  const arena = new Arena({ etherCount: 0 });
  const a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b"),
    outside = arena.addPlayer(0, "outside");
  for (const p of [a, b, outside]) p.protectedUntil = 0;
  a.parts = [20, 40, 1000].map((mass, i) => ({
    id: i === 0 ? a.mainPartId : "part-" + i,
    mass,
    radius: radiusForMass(mass),
    x: 700 + i * 300,
    y: 1000,
  }));
  arena.syncParts(a);
  Object.assign(b, { mass: 80, radius: radiusForMass(80), x: 700, y: 1100 });
  Object.assign(outside, { x: 2700, y: 1800 });
  arena.ether = a.parts.map((part, i) => ({
    id: "food-" + i,
    x: part.x,
    y: part.y + 100,
    value: 1,
  }));
  arena.combat.prepare(a, BOOSTERS.get("vortex"), {}, 5000)();
  arena.combat.update(5050);
  assert.ok(b.x > 700 && b.y < 1100);
  assert.deepEqual(
    arena.ether.map((f) => f.y),
    [1095, 1095, 1095],
  );
  assert.deepEqual(
    arena.ether.map((f) => f.x),
    [700, 1000, 1300],
  );
  for (let time = 5100; time <= 14000; time += 50) arena.combat.update(time);
  assert.ok(Math.hypot(b.x - 1300, b.y - 1000) < 1);
  assert.equal(arena.mainBody(a).id, "part-2", "Тяга приходит к крупнейшей, а не к первой части");
  assert.deepEqual([outside.x, outside.y], [2700, 1800]);
  arena.resolveAbsorptions(14000);
  assert.equal(b.dead, true);
  assert.equal(a.parts.find((p) => p.id === "part-2").mass, 1064);
  assert.equal(a.parts[0].mass, 20);
});

test("Вихрь пересчитывает цель после потери крупной части; щит снимает захват, окончание останавливает тягу", () => {
  const arena = new Arena({ etherCount: 0 });
  const a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  a.protectedUntil = b.protectedUntil = 0;
  a.parts = [20, 1000].map((mass, i) => ({
    id: i ? "large" : a.mainPartId,
    mass,
    radius: radiusForMass(mass),
    x: 700 + i * 300,
    y: 1000,
  }));
  arena.syncParts(a);
  Object.assign(b, { x: 700, y: 1100 });
  arena.combat.prepare(a, BOOSTERS.get("vortex"), {}, 5000)();
  arena.combat.update(5050);
  a.parts.splice(1);
  arena.syncParts(a);
  arena.combat.update(5100);
  assert.ok(b.x < 702);
  b.effects.sphere = 5200;
  arena.combat.update(5150);
  Object.assign(b, { x: 2800, y: 1800 });
  arena.combat.update(5250);
  assert.deepEqual([b.x, b.y], [2800, 1800]);
  Object.assign(b, { x: 700, y: 1100 });
  arena.combat.update(15000);
  const position = [b.x, b.y];
  arena.combat.update(16000);
  assert.deepEqual([b.x, b.y], position);
  assert.equal(arena.combat.shots.length, 0);
});
