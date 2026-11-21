"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");

function scene() {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    p = arena.addPlayer(0, "moving");
  Object.assign(p, { x: 5000, y: 5000, targetX: 5000, targetY: 5000, protectedUntil: 0 });
  return { arena, p };
}

test("После потери фокуса сохраняется направление, а не конечная точка; новая команда его заменяет", () => {
  const { arena, p } = scene();
  arena.handleInput(p.id, { type: "move", x: 5030, y: 5040, keepDirection: true }, 5000);
  for (let now = 7000; now <= 10000; now += 50) arena.step(now);
  assert.ok(
    p.x > 5030 && p.y > 5040,
    "движение продолжается за первоначальную цель без новых пакетов",
  );
  assert.ok(Math.abs((p.x - 5000) / (p.y - 5000) - 3 / 4) < 1e-9);
  assert.equal(p.stopped, false);
  arena.handleInput(p.id, { type: "move", x: p.x - 100, y: p.y }, 10001);
  assert.equal(p.moveDirection, null);
  const before = p.x;
  arena.step(10050);
  assert.ok(p.x < before);
  arena.handleInput(p.id, { type: "move", x: 0, y: 0, keepDirection: true }, 10100);
  arena.handleInput(p.id, { type: "stop" }, 10101);
  const stopped = { x: p.x, y: p.y };
  arena.step(20000);
  assert.deepEqual({ x: p.x, y: p.y }, stopped);
  assert.equal(p.moveDirection, null);
});

test("Сохранённое направление соблюдает обездвиживание, границы мира и номер жизни", () => {
  const { arena, p } = scene();
  arena.handleInput(p.id, { type: "move", x: 9000, y: 5000, keepDirection: true }, 5000);
  p.effects.stone = 9000;
  p.stopped = true;
  const x = p.x;
  arena.step(6000);
  assert.equal(p.x, x);
  arena.step(9000);
  assert.ok(p.x > x);
  p.x = 10000;
  arena.step(9050);
  assert.ok(p.x <= 10000);
  const serial = p.spawnSerial;
  arena.resetPlayer(p, 10000);
  assert.equal(p.moveDirection, null);
  arena.handleInput(
    p.id,
    { type: "move", x: 0, y: 0, keepDirection: true, spawnSerial: serial },
    10001,
  );
  assert.equal(p.moveDirection, null);
});

for (const departure of [false, true])
  test(departure ? "Выход в лобби фиксирует каждую часть до исчезновения" : "При остановке части собираются и сливаются в свой срок", () => {
    const { arena, p } = scene();
    p.parts = [-300, 300].map((dx, i) => ({
      id: i ? "second" : p.mainPartId,
      x: 5000 + dx,
      y: 5000,
      mass: 100,
      radius: radiusForMass(100),
      vx: 0,
      vy: 0,
      mergeAt: 35000,
    }));
    p.mergeAt = 35000;
    arena.syncParts(p);
    arena.handleInput(p.id, { type: "stop" }, 5000);
    const model = departure ? arena.leaveRemnant(p, 5000) : p;
    if (departure) arena.removePlayer(p.id);
    if (departure) {
      const positions = model.parts.map(({ x, y }) => [x, y]);
      for (const part of model.parts) part.mergeAt = 5000;
      for (let now = 5050; now < model.removeAt; now += 50) {
        arena.step(now);
        assert.deepEqual(model.parts.map(({ x, y }) => [x, y]), positions);
      }
      return;
    }
    arena.step(5050);
    assert.equal(model.parts[0].x, 4700, "главная часть остаётся центром сборки");
    assert.ok(model.parts[1].x < 5300);
    for (let now = 5100; now < 15000; now += 50) arena.step(now);
    assert.equal(model.parts.length, 2, "слияние не происходит раньше срока");
    assert.ok(model.parts[1].x - model.parts[0].x < 100, "части собираются в плотную группу");
    assert.equal(model.mass, 200);
    assert.equal(model.parts[0].x, 4700, "малые части не отталкивают главную до срока слияния");
    assert.equal(model.y, 5000);
    for (let now = 35000; model.parts && now < 37000; now += 50) arena.step(now);
    assert.equal(model.parts, null);
    assert.equal(model.mass, 200);
  });
