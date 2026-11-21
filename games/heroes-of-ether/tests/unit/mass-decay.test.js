/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  Arena,
  RULES,
  massDecayLoss,
  radiusForMass,
} = require("../../src/server/arena/arena-simulation");
function scene(mass) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    p = arena.addPlayer(0, "decay");
  Object.assign(p, {
    level: 121,
    mass,
    radius: radiusForMass(mass),
    x: 5000,
    y: 5000,
    targetX: 5000,
    targetY: 5000,
    protectedUntil: 0,
  });
  return { arena, p };
}
test("Естественное сгорание удвоено: 0,1854% / 0,309%, округление вверх и прежние пороги", () => {
  for (const [mass, loss] of [
    [10, 0],
    [999, 0],
    [1000, 0],
    [1001, 1],
    [1500, 3],
    [5000, 10],
    [25000, 47],
    [120000, 223],
    [120001, 1],
    [120200, 200],
    [200000, 618],
    [500000, 1545],
  ])
    assert.equal(massDecayLoss(mass), loss, `масса ${mass}`);
});
test("Сгорание раз в 2 секунды, переход на меньшую ставку и отсутствие повторного списания", () => {
  const { arena, p } = scene(120001);
  arena.step(1999);
  assert.equal(p.mass, 120001);
  arena.step(2000);
  assert.equal(p.mass, 120000);
  arena.step(2000);
  assert.equal(p.mass, 120000);
  arena.step(3999);
  assert.equal(p.mass, 120000);
  arena.step(4000);
  assert.equal(p.mass, 119777);
  assert.equal(p.radius, radiusForMass(119777));
  arena.step(24000);
  assert.equal(p.mass, 117569);
  assert.equal(arena.progressEvents.find((e) => e.type === "massPeak").mass, 117569);
});
test("Пропущенные интервалы считаются последовательно; ниже 1000 сгорания нет", () => {
  const { arena, p } = scene(5000);
  arena.decayMass(p, 12000);
  assert.equal(p.mass, 4940);
  const small = scene(1001);
  small.arena.decayMass(small.p, 10000);
  assert.equal(small.p.mass, 1000);
  small.arena.decayMass(small.p, 1e12);
  assert.equal(small.p.mass, 1000);
});
test("Деление не меняет суммарную потерю; главный шар — крупнейший, жизнь и расход слотов сохраняются", () => {
  const { arena, p } = scene(5000);
  p.boosterUses.candy = 2;
  const lifeId = p.lifeId;
  for (let sequence = 1; sequence <= 4; sequence++)
    arena.handleInput(p.id, { type: "split", sequence, spawnSerial: p.spawnSerial }, 5000);
  const ids = p.parts.map((part) => part.id),
    main = p.mainPartId;
  arena.decayMass(p, 2000);
  assert.equal(p.mass, 4990);
  assert.equal(
    p.parts.reduce((sum, part) => sum + part.mass, 0),
    4990,
  );
  assert.deepEqual(
    p.parts.map((part) => part.id),
    ids,
  );
  // Rounding may shrink the former leader below another part; ties keep its ID.
  const largest = Math.max(...p.parts.map((part) => part.mass));
  assert.equal(p.parts.find((part) => part.id === p.mainPartId).mass, largest);
  if (p.parts.find((part) => part.id === main).mass === largest) assert.equal(p.mainPartId, main);
  assert.ok(
    p.parts.every(
      (part) =>
        Number.isInteger(part.mass) && part.mass >= 10 && part.radius === radiusForMass(part.mass),
    ),
  );
  assert.equal(p.lifeId, lifeId);
  assert.equal(p.boosterUses.candy, 2);
  assert.equal(p.nextMassDecayAt, 4000);
});
test("Сгорание распределяется между неравными частями, не уничтожая малые", () => {
  const { arena, p } = scene(500000);
  p.parts = Array.from({ length: 16 }, (_, i) => ({
    id: i === 0 ? p.mainPartId : `part-${i}`,
    mass: i === 0 ? 499850 : 10,
    x: 5000,
    y: 5000,
  }));
  for (const part of p.parts) part.radius = radiusForMass(part.mass);
  arena.syncParts(p);
  arena.decayMass(p, 2000);
  assert.equal(p.mass, 498455);
  assert.equal(p.parts.length, 16);
  assert.ok(p.parts.every((part) => part.mass >= RULES.MIN_PART_MASS));
  assert.equal(p.parts[0].mass, 498305);
});
test("После завершения жизни сгорание остановлено; новая жизнь сбрасывает таймер", () => {
  const { arena, p } = scene(5000);
  p.dead = true;
  arena.decayMass(p, 60000);
  assert.equal(p.mass, 5000);
  arena.resetPlayer(p, 70000);
  assert.equal(p.nextMassDecayAt, 72000);
  arena.gainMass(p, 1480);
  arena.decayMass(p, 71999);
  assert.equal(p.mass, 1500);
  arena.decayMass(p, 72000);
  assert.equal(p.mass, 1497);
});
test("Неравные части теряют массу в своей пропорции: округляется общая потеря, а не каждая часть вверх", () => {
  for (const [masses, expected] of [
    [
      [3000, 1000],
      [2994, 998],
    ],
    [
      [300000, 100000],
      [299073, 99691],
    ],
    [
      [800, 800],
      [798, 799],
    ],
  ]) {
    const { arena, p } = scene(masses.reduce((a, b) => a + b));
    p.parts = masses.map((mass, i) => ({
      id: i ? "z" : p.mainPartId,
      mass,
      radius: radiusForMass(mass),
      x: 5000,
      y: 5000,
    }));
    arena.syncParts(p);
    arena.decayMass(p, 2000);
    assert.deepEqual(
      p.parts.map((part) => part.mass),
      expected,
    );
    assert.equal(
      p.mass,
      expected.reduce((a, b) => a + b),
    );
  }
});
