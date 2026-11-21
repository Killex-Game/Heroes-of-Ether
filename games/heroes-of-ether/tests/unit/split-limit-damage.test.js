"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");

function scene(count = 16, mass = 100) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    attacker = arena.addPlayer(0, "attacker"),
    target = arena.addPlayer(0, "target");
  Object.assign(attacker, { x: 1000, y: 5000, level: 121, protectedUntil: 0 });
  Object.assign(target, { targetX: 9000, targetY: 5000, protectedUntil: 0 });
  target.parts = Array.from({ length: count }, (_, i) => ({
    id: i ? "part-" + i : target.mainPartId,
    x: i ? 5000 : 1300,
    y: 5000 + i * 100,
    mass,
    radius: radiusForMass(mass),
    vx: 0,
    vy: 0,
    mergeAt: 60000,
  }));
  arena.syncParts(target);
  const hit = (boosterId, part = target.parts[0], now = 5000) =>
    arena.combat.impact(
      {
        boosterId,
        ownerId: attacker.id,
        ownerLife: attacker.lifeId,
        x: part.x - part.radius,
        y: part.y,
        dx: 1,
        dy: 0,
        launchedAt: now,
      },
      target,
      now,
      part,
    );
  return { arena, attacker, target, hit };
}

test("Лимит частей: Ракета и Боеголовки -20%, Секира -50%, Мина -20% только у задетой части", () => {
  for (const [id, loss] of [
    ["rocket", 20],
    ["warheads", 20],
    ["axe", 50],
    ["mine", 20],
  ]) {
    const { target, hit } = scene(),
      part = target.parts[7],
      others = target.parts.filter((p) => p !== part).map((p) => ({ ...p }));
    hit(id, part);
    assert.equal(part.mass, 100 - loss, id);
    assert.equal(part.radius, radiusForMass(100 - loss), id);
    assert.equal(target.mass, 1600 - loss, id);
    assert.equal(target.parts.length, 16, id);
    assert.deepEqual(
      target.parts.filter((p) => p !== part),
      others,
      id,
    );
    assert.equal(part.mergeAt, 60000, id);
  }
});

test("Частичное деление Ракетой, Боеголовками, Секирой и Миной не добавляет урон", () => {
  for (const [id, count] of [
    ["rocket", 14],
    ["warheads", 14],
    ["rocket", 15],
    ["warheads", 15],
    ["axe", 15],
    ["mine", 15],
  ]) {
    const { target, hit } = scene(count);
    hit(id);
    assert.equal(target.parts.length, 16, id);
    assert.equal(target.mass, count * 100, id);
  }
});

test("Кастет при лимите не снимает массу; нехватка массы для деления не включает запасной урон", () => {
  const capped = scene();
  capped.hit("knuckles");
  assert.equal(capped.target.mass, 1600);
  assert.equal(capped.target.parts.length, 16);
  for (const [id, mass] of [
    ["rocket", 19],
    ["warheads", 9],
    ["axe", 3],
    ["mine", 3],
  ]) {
    const { target, hit } = scene(2, mass);
    hit(id);
    assert.equal(target.mass, mass * 2, id);
    assert.equal(target.parts.length, 2, id);
  }
});

test("Урон при лимите сохраняет щиты, отражение и защиту появления", () => {
  for (const id of ["rocket", "warheads", "axe", "mine"])
    for (const protection of ["sphere", "golden_shield", "clan_shield", "spawn"]) {
      const { target, hit } = scene();
      if (protection === "spawn") target.protectedUntil = 10000;
      else target.effects[protection] = 10000;
      const result = hit(id);
      assert.equal(target.mass, 1600, id + " " + protection);
      assert.equal(target.parts.length, 16);
      if (protection === "clan_shield") assert.equal(result, "reflected");
    }
});

test("Лимит: целая масса, минимум 2 и действующее сопротивление питомца сохраняются", () => {
  for (const id of ["rocket", "warheads", "axe", "mine"]) {
    const tiny = scene(16, 3);
    for (let n = 0; n < 3; n++) tiny.hit(id);
    assert.equal(tiny.target.parts[0].mass, 2, id);
    assert.equal(tiny.target.mass, 47, id);
    const resistant = scene();
    resistant.target.pet = { vitalityMs: 10000, stats: { resistance: 20 } };
    resistant.hit(id);
    assert.equal(resistant.target.parts[0].mass, id === "axe" ? 60 : 84, id);
  }
});

test("Попадание летящих Ракеты, Боеголовок и Секиры при лимите обрабатывается ровно один раз на снаряд", () => {
  for (const id of ["rocket", "warheads", "axe"]) {
    const { arena, attacker, target } = scene();
    arena.prepareBooster(
      attacker.id,
      {
        boosterId: id,
        spawnSerial: attacker.spawnSerial,
        aimX: 9000,
        aimY: 5000,
      },
      5000,
    )();
    let impacts = 0;
    const impact = arena.combat.impact.bind(arena.combat);
    arena.combat.impact = (...args) => {
      impacts++;
      return impact(...args);
    };
    arena.combat.update(10000);
    assert.ok(impacts > 0, id);
    let expected = 100;
    for (let i = 0; i < impacts; i++) expected -= Math.floor(expected * (id === "axe" ? 0.5 : 0.2));
    assert.equal(target.parts[0].mass, expected, id);
    assert.equal(arena.combat.shots.length, 0, id);
    const mass = target.mass;
    arena.combat.update(11000);
    assert.equal(target.mass, mass, id);
  }
});

test("Мина на земле при лимите наносит урон один раз даже после ухода владельца", () => {
  const { arena, attacker, target } = scene();
  arena.prepareBooster(
    attacker.id,
    {
      boosterId: "mine",
      spawnSerial: attacker.spawnSerial,
      aimX: 9000,
      aimY: 5000,
    },
    5000,
  )();
  arena.removePlayer(attacker.id);
  arena.combat.update(6000);
  const trap = arena.combat.shots[0];
  assert.equal(trap.landed, true);
  Object.assign(target.parts[0], { x: trap.x, y: trap.y });
  arena.combat.update(6100);
  assert.equal(target.parts[0].mass, 80);
  assert.equal(target.mass, 1580);
  assert.equal(arena.combat.shots.length, 0);
  arena.combat.update(6200);
  assert.equal(target.mass, 1580);
});
