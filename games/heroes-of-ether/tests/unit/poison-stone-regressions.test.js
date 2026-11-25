"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Arena, RULES, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");

function scene() {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  for (const [p, x] of [
    [a, 1000],
    [b, 2000],
  ])
    Object.assign(p, { x, y: 1000, mass: 100, radius: radiusForMass(100), protectedUntil: 0 });
  return { arena, a, b };
}
const foodMass = (arena) => arena.ether.reduce((total, orb) => total + orb.value, 0);
function throwStone(arena, a) {
  arena.combat.prepare(a, BOOSTERS.get("stone"), { aimX: 9000, aimY: 1000 }, 5000)();
  return arena.combat.shots[0];
}

for (const id of ["poison", "mega_poison"])
  test(`${id}: дробный выход, части у минимума и сопротивление не меняют долю еды`, () => {
    for (const mass of [3, 19, 101, 1001]) {
      for (const resistance of [0, 15]) {
        const { arena, b } = scene();
        b.parts = [2, mass, mass].map((value, i) => ({
          id: "part" + i,
          mass: value,
          radius: radiusForMass(value),
          x: 2000 + i * 200,
          y: 1000,
        }));
        arena.syncParts(b);
        b.pet = { id: "manya", stats: { resistance }, vitalityMs: 100000 };
        const original = b.mass;
        arena.boosterEffects.apply(b, BOOSTERS.get(id), 5000);
        const budget = Math.floor(original * BOOSTERS.get(id).fraction * (1 - resistance / 100));
        const expectedLoss = Math.min(budget, 2 * (mass - 2));
        for (let at = 5000; at <= 25000; at += 50) arena.boosterEffects.tick(b, at);
        assert.equal(original - b.mass, expectedLoss);
        assert.equal(foodMass(arena), Math.floor((expectedLoss * 15) / 100));
        assert.equal(b.poisonFoodRemainder, (expectedLoss * 15) % 100);
        assert.equal(b.parts[0].mass, RULES.MIN_PART_MASS);
        assert.ok(arena.ether.every((orb) => Number.isInteger(orb.value) && orb.value > 0));
        const emitted = foodMass(arena);
        arena.boosterEffects.tick(b, 30000);
        assert.equal(foodMass(arena), emitted, "завершённый эффект не дублирует еду");
      }
    }
  });

test("Остаток выхода яда не переходит в следующую жизнь", () => {
  const { arena, b } = scene();
  b.mass = 19;
  b.radius = radiusForMass(19);
  arena.boosterEffects.apply(b, BOOSTERS.get("poison"), 5000);
  arena.boosterEffects.tick(b, 25000);
  assert.equal(foodMass(arena), 0);
  assert.equal(b.poisonFoodRemainder, 90);
  arena.resetPlayer(b, 30000);
  assert.equal(b.poisonFoodRemainder, 0);
});

test("Камень у конца полёта отражается только на остаток 3,6 секунды", () => {
  const { arena, a, b } = scene();
  const shot = throwStone(arena, a),
    start = shot.x;
  b.x = start + 628 + b.radius + 10;
  b.effects.clan_shield = 30000;
  arena.combat.update(8550);
  assert.equal(shot.ownerId, b.id);
  assert.equal(shot.landed, false);
  assert.equal(shot.dx, -1);
  assert.ok(Math.abs(shot.distanceTravelled - 628) < 1e-7);
  assert.equal(shot.landsAt, 8600);
  assert.equal(shot.launchedAt, 5000);
  const contactX = shot.x;
  arena.removePlayer(a.id);
  b.x += 100; // Let the stone land outside the shield's larger ground-trigger radius.
  arena.combat.update(8600);
  assert.ok(Math.abs(shot.x - contactX + 9) < 1e-7);
  assert.equal(shot.landed, true);
  const landedX = shot.x;
  arena.combat.update(20000);
  assert.equal(shot.x, landedX);
  assert.equal(arena.combat.shots.length, 1);
  assert.equal(b.effects.stone, undefined);
});

test("Клановый щит поглощает лежащий Камень, не запускает новый полёт", () => {
  for (const offset of [-30, 0, 30]) {
    const { arena, a, b } = scene();
    const shot = throwStone(arena, a);
    Object.assign(shot, { x: b.x + offset, y: b.y, landed: true, lastAt: 7000, landsAt: 7000 });
    b.effects.clan_shield = 30000;
    arena.combat.update(8000);
    assert.equal(arena.combat.shots.length, 0);
    assert.equal(shot.landed, true);
    arena.combat.update(8050);
    assert.equal(arena.combat.shots.length, 0);
    assert.equal(b.effects.stone, undefined);
  }
});

test("Отражённый Камень возвращается к исходной части разделённого отправителя", () => {
  const { arena, a, b } = scene();
  a.parts = [
    { id: "large", x: 4000, y: 1000, mass: 200, radius: radiusForMass(200) },
    { id: "source", x: 1000, y: 1000, mass: 100, radius: radiusForMass(100) },
  ];
  arena.syncParts(a);
  arena.combat.prepare(a, BOOSTERS.get("stone"), { aimX: 1800, aimY: 1000 }, 5000)();
  const shot = arena.combat.shots[0];
  assert.equal(shot.sourcePartId, "source");
  Object.assign(shot, { x: b.x - b.radius - 10, y: b.y, lastAt: 8000 });
  b.effects.clan_shield = 30000;
  arena.combat.update(8000);
  assert.equal(shot.dx, -1, "не в сторону крупнейшей части за щитом");
});

test("Повторные отражения между двумя щитами не продлевают 3,6 секунды", () => {
  const { arena, a, b } = scene();
  b.x = 1250;
  a.effects.clan_shield = b.effects.clan_shield = 30000;
  const shot = throwStone(arena, a);
  const owners = new Set();
  let reflections = 0,
    previous = shot.ownerId;
  for (let at = 5050; at < 8600; at += 50) {
    arena.combat.update(at);
    assert.equal(arena.combat.shots.length, 1);
    if (shot.ownerId !== previous) {
      reflections++;
      owners.add(shot.ownerId);
      assert.equal(shot.landsAt, 8600);
      assert.ok(shot.distanceTravelled > 0);
      assert.equal(shot.speed, 180);
      previous = shot.ownerId;
    }
    assert.equal(a.effects.stone, undefined);
    assert.equal(b.effects.stone, undefined);
  }
  assert.equal(owners.size, 2);
  assert.ok(reflections >= 3);
  arena.combat.update(8600);
  assert.ok(shot.landed || arena.combat.shots.length === 0);
  const x = shot.x;
  arena.combat.update(12000);
  assert.equal(shot.x, x);
  assert.equal(shot.landsAt, 8600);
});

test("Камень при совпадении с отправителем сохраняет ненулевое направление отскока", () => {
  const { arena, a, b } = scene();
  const shot = throwStone(arena, a);
  Object.assign(shot, { x: a.x, y: a.y, lastAt: 8000 });
  b.x = a.x;
  b.effects.clan_shield = 30000;
  assert.equal(arena.combat.impact(shot, b, 8000), "reflected");
  assert.equal(shot.ownerId, b.id);
  assert.equal(Math.hypot(shot.dx, shot.dy), 1);
  assert.equal(shot.x, b.x - b.radius - 10 - 0.01);
});
