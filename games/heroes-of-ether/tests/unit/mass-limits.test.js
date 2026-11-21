/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  Arena,
  massLimitForLevel,
  radiusForMass,
} = require("../../src/server/arena/arena-simulation");
test("На пределе массы еду собирают все части, без прибавки и без опыта за еду", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "parts");
  p.parts = [500, 1900].map((x, i) => ({
    id: i ? "small" : p.mainPartId,
    x,
    y: 800,
    mass: 5000,
    radius: radiusForMass(5000),
  }));
  arena.syncParts(p);
  arena.ether = p.parts.flatMap((part, i) =>
    [1, 3, 5, 10].map((value) => ({ id: i + ":" + value, x: part.x, y: part.y, value })),
  );
  arena.ether.push({ id: "far", x: 1200, y: 100, value: 10 });
  arena.collectEther();
  assert.equal(p.mass, 10000);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [5000, 5000],
  );
  assert.deepEqual(
    arena.ether.map((o) => o.id),
    ["far"],
  );
  assert.deepEqual(arena.progressEvents, []);
});
for (const [level, limit] of [
  [1, 5000],
  [25, 5000],
  [26, 18000],
  [120, 18000],
  [121, 24000],
  [500, 24000],
  [501, 30000],
  [10001, 30000],
]) {
  test(`Уровень ${level}: предел ${limit} при еде, бустерах и поглощении`, () => {
    const arena = new Arena({ etherCount: 0 }),
      p = arena.addPlayer(0, "a");
    p.level = level;
    assert.equal(massLimitForLevel(level), limit);
    const position = (mass) =>
      Object.assign(p, { mass, radius: radiusForMass(mass), x: 1200, y: 800, protectedUntil: 0 });
    position(limit - 2);
    arena.ether = [{ id: "food", x: p.x, y: p.y, value: 10 }];
    arena.collectEther();
    assert.equal(p.mass, limit);
    assert.equal(p.radius, radiusForMass(limit));
    arena.ether = [{ id: "cap-food", x: p.x, y: p.y, value: 10 }];
    arena.collectEther();
    assert.equal(arena.ether.length, 0);
    assert.equal(p.mass, limit);
    const command = { boosterId: "donut", spawnSerial: p.spawnSerial };
    assert.throws(() => arena.prepareBooster(p.id, command, 5000), /предел массы/);
    assert.equal(p.boostersUsed, 0);
    position(limit - 1);
    arena.prepareBooster(p.id, command, 5000)();
    assert.equal(p.mass, limit);
    assert.equal(p.boosterUses.donut, 1);
    position(limit - 3);
    const victim = arena.addPlayer(0, "b");
    Object.assign(victim, { x: p.x, y: p.y, protectedUntil: 0 });
    const events = arena.resolveAbsorptions(5000);
    assert.equal(events.length, 1);
    assert.equal(events[0].gain, 3);
    assert.equal(p.mass, limit);
    assert.equal(arena.snapshot(5000).players[0].massLimit, limit);
  });
}
test("Лимит применяется к каждой части: общий старый предел снят, бустер не переносится с главного", () => {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    p = arena.addPlayer(0, "p");
  p.level = 26;
  p.parts = [17999, 17999].map((mass, i) => ({
    id: i ? "other" : "p",
    mass,
    radius: radiusForMass(mass),
    x: i ? 8000 : 2000,
    y: 5000,
    vx: 0,
    vy: 0,
  }));
  arena.syncParts(p);
  arena.prepareBooster(p.id, { boosterId: "donut", spawnSerial: 0 }, 5000)();
  assert.equal(p.mass, 35999);
  assert.deepEqual(
    p.parts.map((b) => b.mass),
    [18000, 17999],
  );
  p.parts[1].mass = 100;
  p.parts[1].radius = radiusForMass(100);
  arena.syncParts(p);
  assert.throws(
    () => arena.prepareBooster(p.id, { boosterId: "candy", spawnSerial: 0 }, 5000),
    /предел массы главного/,
  );
  assert.equal(p.parts[1].mass, 100);
  arena.ether = [{ id: "food", x: 8000, y: 5000, value: 10 }];
  arena.collectEther();
  assert.equal(p.parts[1].mass, 110);
});
test("Торт ограничивает каждую часть, не переносит излишек и не вводит общий потолок", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p");
  p.level = 501;
  p.parts = [29999, 20000, 10000].map((mass, i) => ({
    id: i ? "other" + i : "p",
    mass,
    radius: radiusForMass(mass),
    x: 500,
    y: 500,
  }));
  arena.syncParts(p);
  arena.boosterEffects.grow(p, 1000);
  assert.deepEqual(
    p.parts.map((b) => b.mass),
    [30000, 20333, 10167],
  );
  assert.equal(p.mass, 60500);
});
test("Соединение и Губка сжигают избыток над пределом одного шара, сохраняя главную часть", () => {
  for (const sponge of [false, true]) {
    for (const [level, cap] of [
      [1, 5000],
      [26, 18000],
      [121, 24000],
      [501, 30000],
    ]) {
      const arena = new Arena({ etherCount: 0 }),
        p = arena.addPlayer(0, "p");
      p.stopped = true;
      p.targetX = p.targetY = 500;
      p.level = level;
      p.parts = [cap * 0.6, cap * 0.5].map((mass, i) => ({
        id: i ? "other" : "p",
        mass,
        radius: radiusForMass(mass),
        x: 500,
        y: 500,
        vx: 0,
        vy: 0,
      }));
      arena.syncParts(p);
      if (sponge) {
        arena.boosterEffects.startSponge(p, 30000);
        arena.moveParts(p, 35000, 0);
      } else arena.moveParts(p, 35000, 0);
      assert.equal(p.parts, null);
      assert.equal(p.mass, cap);
      assert.equal(p.mainPartId, "p");
      assert.equal(p.radius, radiusForMass(cap));
      assert.equal(p.x, 500);
      assert.equal(p.y, 500);
      assert.equal(p.mergeVersion, 1);
      assert.deepEqual(arena.progressEvents, []);
      assert.equal(arena.snapshot(35000).players[0].mass, cap);
    }
  }
});
test("Соединение ниже предела не теряет массу", () => {
  for (const sponge of [false, true]) {
    const arena = new Arena({ etherCount: 0 }),
      p = arena.addPlayer(0, "p");
    p.stopped = true;
    p.parts = [2000, 1500].map((mass, i) => ({
      id: i ? "other" : "p",
      mass,
      radius: radiusForMass(mass),
      x: 500,
      y: 500,
      vx: 0,
      vy: 0,
    }));
    arena.syncParts(p);
    if (sponge) {
      arena.boosterEffects.startSponge(p, 30000);
      arena.moveParts(p, 35000, 0);
    } else arena.moveParts(p, 35000, 0);
    assert.equal(p.parts, null);
    assert.equal(p.mass, 3500);
    assert.equal(p.mainPartId, "p");
  }
});
