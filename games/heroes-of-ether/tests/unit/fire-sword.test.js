/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { BOOSTERS, publicCatalog } = require("../../src/server/boosters/booster-catalog");
const { cooldown } = require("../../public/shared/booster-cooldowns");
const sword = BOOSTERS.get("fire_sword");
function scene() {
  const arena = new Arena({ etherCount: 0 }),
    a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  for (const p of [a, b])
    Object.assign(p, {
      mass: 1000,
      radius: radiusForMass(1000),
      x: 1000,
      y: 1000,
      targetX: 2000,
      targetY: 1000,
      protectedUntil: 0,
      level: 121,
    });
  return { arena, a, b };
}
function parts(arena, p) {
  p.parts = [
    { id: p.mainPartId, mass: 1000, x: 1000, y: 1000, radius: radiusForMass(1000) },
    { id: "other", mass: 500, x: 1500, y: 1500, radius: radiusForMass(500) },
  ];
  arena.syncParts(p);
  return p.parts;
}
test("Поджог снимает ровно 20% начальной массы за 1 секунду только с задетого шара", () => {
  const { arena, b } = scene(),
    [hit, other] = parts(arena, b);
  arena.boosterEffects.apply(b, sword, 5000, hit);
  assert.equal(hit.mass, 1000);
  arena.boosterEffects.tick(b, 5500);
  assert.equal(hit.mass, 900);
  assert.equal(other.mass, 500);
  const packet = arena.snapshot(5500).players.find((p) => p.id === b.id);
  assert.deepEqual(
    packet.parts.map((p) => p.burnMs),
    [500, 0],
  );
  arena.boosterEffects.tick(b, 12000);
  assert.equal(hit.mass, 800);
  assert.equal(other.mass, 500);
  assert.equal(b.mass, 1300);
  assert.equal(b.effects.fire_sword, undefined);
  arena.boosterEffects.tick(b, 20000);
  assert.equal(b.mass, 1300);
});
test("Повторный удар добавляет новый секундный поджог от текущей массы", () => {
  const { arena, b } = scene();
  arena.boosterEffects.apply(b, sword, 5000);
  arena.boosterEffects.apply(b, sword, 5500);
  assert.equal(b.mass, 900);
  assert.equal(b.swordBurns.length, 2);
  assert.equal(b.swordBurns[1].until, 6500);
  arena.boosterEffects.tick(b, 6500);
  assert.equal(b.mass, 620);
});

test("Меч снова поджигает тот же шар после выхода лезвия и нового касания", () => {
  const { arena, a, b } = scene();
  b.x = a.x + a.radius + 80;
  arena.combat.prepare(a, sword, { aimX: 2000, aimY: 1000 }, 5000)();
  arena.combat.updateSwords(5000);
  assert.equal(b.swordBurns[0].until, 6000);
  arena.combat.updateSwords(5500);
  assert.equal(b.swordBurns[0].until, 6000);
  a.targetX = 1000;
  a.targetY = 2000;
  arena.combat.updateSwords(6000);
  a.targetX = 2000;
  a.targetY = 1000;
  arena.combat.updateSwords(6500);
  assert.equal(b.swordBurns.length, 1);
  assert.equal(b.swordBurns[0].until, 7500);
  arena.combat.updateSwords(15000);
  assert.equal(arena.combat.swords.length, 0);
  arena.boosterEffects.tick(b, 16000);
  assert.equal(b.swordBurns.length, 0);
});
test("Повтор меча после 0,5 секунды обновляет единственный клинок", () => {
  const { arena, a } = scene(),
    message = { boosterId: sword.id, spawnSerial: a.spawnSerial, aimX: 2000, aimY: 1000 };
  const commit = arena.prepareBooster(a.id, message, 5000);
  assert.equal(a.boosterItemReadyAt.fire_sword, undefined);
  commit();
  assert.throws(() => arena.prepareBooster(a.id, message, 5499),/Подожди/);
  assert.doesNotThrow(() => arena.prepareBooster(a.id, message, 5500));
  assert.doesNotThrow(() => arena.prepareBooster(a.id, { ...message, boosterId: "rocket" }, 6000));
  const me = arena.snapshot(6000).players.find((p) => p.id === a.id);
  const item = publicCatalog().items.find((b) => b.id === sword.id);
  assert.equal(cooldown(item, me, 500, publicCatalog().rules).ms, 0);
  assert.equal(item.heldMs, 10000);
  arena.prepareBooster(a.id, message, 10000)();
  assert.equal(arena.combat.swords.length, 1);
  assert.equal(arena.combat.swords[0].until, 20000);
  arena.resetPlayer(a, 11000);
  assert.deepEqual(a.boosterItemReadyAt, {});
});
test("Разделение горящего шара сохраняет остаток урона и срок между его потомками", () => {
  for (const kind of ["space", "rocket"]) {
    const { arena, b } = scene();
    b.mass=10000; b.radius=radiusForMass(b.mass);
    arena.boosterEffects.apply(b, sword, 5000);
    if (kind === "space") arena.splitPlayer(b, { spawnSerial: b.spawnSerial, sequence: 1 }, 5500);
    else arena.boosterEffects.split(b, b, 3, 5500, true);
    assert.equal(b.mass, 9000);
    assert.ok(b.swordBurns.length >= 2);
    arena.boosterEffects.tick(b, 6000);
    assert.equal(b.mass, 8000);
    assert.ok(arena.bodies(b).every((p) => p.mass > 300));
  }
});
test("Слияние сохраняет остаток поджога, не начисляя 20% от общей массы заново", () => {
  const { arena, b } = scene(),
    [hit, other] = parts(arena, b);
  arena.boosterEffects.apply(b, sword, 5000, hit);
  arena.boosterEffects.tick(b, 5500);
  other.x = hit.x;
  other.y = hit.y;
  other.vx = other.vy = hit.vx = hit.vy = 0;
  b.mergeAt = 0;
  b.stopped = true;
  b.targetX = hit.x;
  b.targetY = hit.y;
  arena.moveParts(b, 5500, 0);
  assert.equal(arena.bodies(b).length, 1);
  arena.boosterEffects.tick(b, 6000);
  assert.equal(b.mass, 1300);
});
test("Поглощение горящей части не переносит поджог на оставшийся шар, возрождение очищает огонь", () => {
  const { arena, b } = scene(),
    [hit, other] = parts(arena, b);
  arena.boosterEffects.apply(b, sword, 5000, hit);
  b.parts = [other];
  arena.syncParts(b);
  arena.boosterEffects.tick(b, 7000);
  assert.equal(b.mass, 500);
  assert.equal(b.swordBurns.length, 0);
  arena.boosterEffects.apply(b, sword, 8000);
  arena.resetPlayer(b, 9000);
  assert.equal(b.swordBurns.length, 0);
  assert.equal(b.effects.fire_sword, undefined);
});
test("Частота обновления не меняет итог поджога; малый горящий шар исчезает", () => {
  for (const step of [16, 50, 1000, 5000]) {
    const { arena, b } = scene();
    arena.boosterEffects.apply(b, sword, 5000);
    for (let at = 5000; at < 12000; at += step) arena.boosterEffects.tick(b, at);
    arena.boosterEffects.tick(b, 12000);
    assert.equal(b.mass, 800);
    arena.boosterEffects.apply(b, sword, 13000);
    b.mass = 2;
    b.radius = radiusForMass(2);
    arena.boosterEffects.tick(b, 20000);
    assert.equal(b.mass, 2);
    assert.equal(b.dead, true);
  }
});
