/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, RULES, radiusForMass } = require("../../src/server/arena/arena-simulation");
function scene(mass = 5000) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    p = arena.addPlayer(0, "a");
  Object.assign(p, {
    mass,
    radius: radiusForMass(mass),
    x: 5000,
    y: 5000,
    targetX: 6000,
    targetY: 5000,
    protectedUntil: 0,
    lastMoveAt: 5000,
  });
  return {
    arena,
    p,
    split: (sequence, now = 5000) =>
      arena.handleInput(p.id, { type: "split", sequence, spawnSerial: p.spawnSerial }, now),
  };
}

test("Усиленный прыжок направлен к курсору, плавно затухает и сохраняет массу", () => {
  const { arena, p, split } = scene(100);
  p.targetX = p.x + 300;
  p.targetY = p.y + 400;
  split(1);
  const child = p.parts.find((b) => b.id !== p.mainPartId);
  assert.ok(Math.abs(Math.hypot(child.vx, child.vy) - 18 * 1.15) < 1e-9);
  assert.ok(Math.abs(child.vx / child.vy - 3 / 4) < 1e-9);
  p.stopped = true;
  const x = child.x,
    y = child.y;
  arena.moveParts(p, 5050, 1);
  assert.ok(child.x > x && child.y > y);
  assert.ok(Math.abs(Math.hypot(child.vx, child.vy) - RULES.SPLIT_IMPULSE * 0.8) < 1e-9);
  assert.equal(p.mass, 100);
});
test("Пробел делит все части: 5000 → 2×2500 → 4×1250; максимум 16, масса сохраняется", () => {
  const { arena, p, split } = scene();
  const life = p.lifeId;
  p.boosterUses.candy = 3;
  p.boostersUsed = 3;
  split(1);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [2500, 2500],
  );
  split(2);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [1250, 1250, 1250, 1250],
  );
  split(3);
  split(4);
  split(5);
  assert.equal(p.parts.length, 16);
  assert.equal(p.mass, 5000);
  assert.equal(
    p.parts.reduce((sum, part) => sum + part.mass, 0),
    5000,
  );
  assert.equal(new Set(p.parts.map((part) => part.id)).size, 16);
  assert.ok(p.parts.every((part) => part.radius === radiusForMass(part.mass)));
  assert.equal(p.lifeId, life);
  assert.equal(p.lifeStartedAt, 0);
  assert.equal(p.boosterUses.candy, 3);
  const visible = arena.snapshot(5000).players[0];
  assert.equal(visible.parts.length, 16);
  assert.equal(visible.canSplit, false);
  arena.resetPlayer(p, 6000);
  assert.equal(p.parts, null);
  assert.deepEqual(p.boosterUses, {});
});
test("Округление сохраняет остаток, части меньше 4 не делятся; повтор команды и старая жизнь игнорируются", () => {
  const { arena, p, split } = scene(51);
  split(1);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [26, 25],
  );
  split(1);
  assert.equal(p.parts.length, 2);
  split(2);
  assert.equal(p.parts.length, 4);
  assert.equal(p.mass, 51);
  split(3);
  assert.equal(p.parts.length, 8);
  assert.equal(p.mass, 51);
  split(4);
  assert.equal(p.parts.length, 16);
  const before = JSON.stringify(p.parts);
  arena.handleInput(p.id, { type: "split", sequence: 4, spawnSerial: 999, mass: 100000 }, 5000);
  assert.equal(JSON.stringify(p.parts), before);
  for (const sequence of [NaN, -1, 1.1, Infinity]) split(sequence);
  assert.equal(JSON.stringify(p.parts), before);
  for (const mass of [2, 3]) {
    const small = scene(mass);
    small.split(1);
    assert.equal(small.p.parts, null);
    assert.equal(small.arena.snapshot(5000).players[0].canSplit, false);
  }
  const ten = scene(10);
  assert.equal(ten.arena.snapshot(5000).players[0].canSplit, true);
  ten.split(1);
  assert.deepEqual(
    ten.p.parts.map((p) => p.mass),
    [5, 5],
  );
  const mixed = scene(13);
  mixed.p.parts = [
    { id: "small", mass: 3, radius: radiusForMass(3), x: 1000, y: 1000 },
    { id: "large", mass: 10, radius: radiusForMass(10), x: 1500, y: 1000 },
  ];
  mixed.arena.syncParts(mixed.p);
  mixed.split(1);
  assert.deepEqual(
    mixed.p.parts.map((p) => p.mass).sort((a, b) => a - b),
    [3, 5, 5],
  );
});
test("Соединение: 30 секунд, глубокое перекрытие и сближение после остановки", () => {
  const { arena, p, split } = scene(100);
  split(1, 5000);
  split(2, 6000);
  assert.equal(p.mergeAt, 36000);
  for (const part of p.parts) {
    part.x = 5000;
    part.y = 5000;
    part.vx = part.vy = 0;
  }
  p.stopped = true;
  arena.moveParts(p, 35999, 1);
  assert.equal(p.parts.length, 4);
  // Касания краями недостаточно: части должны сойтись центрами.
  p.targetX = 5000;
  p.targetY = 5000;
  arena.moveParts(p, 36000, 1);
  assert.equal(p.parts.length, 4);
  for (let i = 0; p.parts && i < 100; i++) arena.moveParts(p, 36000, 1);
  assert.equal(p.parts, null);
  assert.equal(p.mass, 100);
  assert.equal(p.radius, radiusForMass(100));
  assert.ok(p.mainPartId);
  assert.ok(p.mergeVersion > 0);
  assert.equal(arena.snapshot(36000).players[0].parts[0].id, p.mainPartId);
});
test("Бустер получает главный шар до его предела; общая масса после деления может расти дальше", () => {
  const { arena, p, split } = scene(4999);
  split(1);
  arena.prepareBooster(p.id, { boosterId: "donut", spawnSerial: p.spawnSerial }, 5000)();
  assert.equal(p.mass, 5499);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [3000, 2499],
  );
  arena.gainMass(p, 2000);
  assert.equal(p.mass, 7499);
  assert.throws(
    () => arena.prepareBooster(p.id, { boosterId: "candy", spawnSerial: p.spawnSerial }, 5000),
    /предел/,
  );
  const other = scene(100);
  other.split(1);
  other.arena.moveParts(other.p, 5200, 1);
  const part = other.p.parts[1];
  other.arena.ether = [{ id: "food", x: part.x, y: part.y, value: 10 }];
  other.arena.collectEther();
  assert.equal(other.p.mass, 110);
  assert.equal(part.mass, 60);
});
test("Все бустеры массы усиливают только крупнейший текущий шар после повторных делений", () => {
  const { arena, p, split } = scene(1000);
  split(1);
  split(2);
  arena.gainMass(p, 300, p.parts[1]);
  const main = arena.mainBody(p),
    siblings = p.parts.filter((part) => part !== main);
  const before = siblings.map((part) => part.mass);
  for (const [id, amount] of [
    ["ice_cream", 200],
    ["candy", 150],
    ["donut", 500],
    ["meat", 700],
  ]) {
    const mass = main.mass;
    arena.prepareBooster(p.id, { boosterId: id, spawnSerial: 0 }, 5000)();
    assert.equal(main.mass, mass + amount);
    assert.equal(p.mainPartId, main.id);
    assert.deepEqual(
      siblings.map((part) => part.mass),
      before,
    );
  }
  assert.equal(p.mass, 2850);
});

test("Потеря главного назначает крупнейший оставшийся; ID сохраняется после соединения и деления", () => {
  const { arena, p, split } = scene(400);
  split(1);
  split(2);
  const eater = arena.addPlayer(0, "eater");
  Object.assign(eater, {
    mass: 1000,
    radius: radiusForMass(1000),
    x: 1000,
    y: 1000,
    protectedUntil: 0,
  });
  Object.assign(arena.mainBody(p), { x: 1000, y: 1000 });
  const next = p.parts.find((part) => part.id !== p.mainPartId);
  arena.gainMass(p, 40, next);
  const nextId = next.id;
  arena.resolveAbsorptions(5000);
  assert.equal(p.dead, false);
  assert.equal(p.mainPartId, nextId);
  for (const part of p.parts) Object.assign(part, { x: 5000, y: 5000, vx: 0, vy: 0 });
  p.targetX = p.targetY = 5000;
  arena.moveParts(p, 35000, 1);
  assert.equal(p.parts, null);
  assert.equal(p.mainPartId, nextId);
  assert.equal(
    arena.snapshot(35000).players.find((player) => player.id === p.id).parts[0].id,
    nextId,
  );
  split(3, 36000);
  assert.equal(arena.mainBody(p).id, nextId);
});

test("Равные части соединяются при заходе на глубину поглощения без требования превосходства размера", () => {
  const { arena, p, split } = scene(100);
  split(1);
  const [a, b] = p.parts;
  Object.assign(a, { x: 5000, y: 5000, vx: 0, vy: 0 });
  Object.assign(b, { x: 5000 + a.radius, y: 5000, vx: 0, vy: 0 });
  p.stopped = true;
  arena.moveParts(p, 35000, 0);
  assert.equal(p.parts.length, 2);
  b.x = a.x + (a.radius * 2) / 3 + 0.001;
  arena.moveParts(p, 35000, 0);
  assert.equal(p.parts.length, 2);
  b.x = a.x + (a.radius * 2) / 3 - 0.001;
  arena.moveParts(p, 35000, 0);
  assert.equal(p.parts, null);
  assert.equal(p.mass, 100);
});

test("Центра малой части на границе главного недостаточно; глубокое перекрытие сохраняет массу и ID", () => {
  for (const mainLast of [false, true]) {
    const { arena, p, split } = scene(5000);
    split(1);
    const main = arena.mainBody(p),
      small = p.parts.find((part) => part !== main);
    Object.assign(main, {
      mass: 4500,
      radius: radiusForMass(4500),
      x: 5000,
      y: 5000,
      vx: 0,
      vy: 0,
    });
    Object.assign(small, {
      mass: 500,
      radius: radiusForMass(500),
      x: 5000 + main.radius + 1,
      y: 5000,
      vx: 0,
      vy: 0,
    });
    if (mainLast) p.parts.reverse();
    p.stopped = true;
    arena.syncParts(p);
    arena.moveParts(p, 34999, 0);
    assert.equal(p.parts.length, 2);
    Object.assign(main, { x: 5000, y: 5000 });
    small.x = main.x + main.radius + 1;
    small.y = main.y;
    arena.moveParts(p, 35000, 0);
    assert.equal(p.parts.length, 2);
    small.x = main.x + main.radius;
    arena.moveParts(p, 35000, 0);
    assert.equal(p.parts.length, 2);
    small.x = main.x + main.radius - small.radius;
    arena.moveParts(p, 35000, 0);
    assert.equal(p.parts, null);
    assert.equal(p.mass, 5000);
    assert.equal(p.mainPartId, "a");
    assert.ok(p.mergeVersion > 0);
    assert.equal(p.x, 5000, "Меньшая часть не сдвигает центр главного шара при соединении");
  }
});

test("При сборке меньший шар идёт к главному; главный не смещается к меньшему", () => {
  for (const reverse of [false, true]) {
    const { arena, p, split } = scene(5000);
    split(1);
    const main = arena.mainBody(p),
      small = p.parts.find((part) => part !== main);
    Object.assign(main, {
      mass: 4500,
      radius: radiusForMass(4500),
      x: 5000,
      y: 5000,
      vx: 0,
      vy: 0,
    });
    Object.assign(small, { mass: 500, radius: radiusForMass(500), x: 5400, y: 5000, vx: 0, vy: 0 });
    if (reverse) p.parts.reverse();
    arena.syncParts(p);
    p.stopped = true;
    p.targetX = p.x;
    p.targetY = p.y;
    arena.moveParts(p, 35000, 1);
    assert.equal(main.x, 5000);
    assert.ok(small.x < 5400);
    for (let i = 0; p.parts && i < 500; i++) arena.moveParts(p, 35000, 1);
    assert.equal(p.parts, null);
    assert.equal(p.x, 5000);
    assert.equal(p.mass, 5000);
    assert.equal(p.mainPartId, main.id);
  }
});

test("Единое правило соединения для всех частей независимо от главной и соотношения радиусов", () => {
  const { arena, p, split } = scene(5000);
  split(1);
  split(2);
  p.stopped = true;
  const main = arena.mainBody(p),
    other = p.parts.find((part) => part !== main),
    tiny = p.parts.find((part) => part !== main && part !== other);
  // 176 и 88 — проверка ровно половины радиуса, без погрешности квадратного корня.
  Object.assign(main, { mass: 4096, radius: 176, x: 1000, y: 1000, vx: 0, vy: 0 });
  Object.assign(other, { mass: 830, radius: 88.01, x: 1176, y: 1000, vx: 0, vy: 0 });
  Object.assign(tiny, { mass: 10, radius: radiusForMass(10), x: 7000, y: 7000, vx: 0, vy: 0 });
  Object.assign(p.parts[3], {
    mass: 2000,
    radius: radiusForMass(2000),
    x: 7000 + radiusForMass(2000),
    y: 7000,
    vx: 0,
    vy: 0,
  });
  arena.syncParts(p);
  arena.moveParts(p, 35000, 0);
  assert.equal(p.parts.length, 4);
  other.x = main.x;
  arena.moveParts(p, 35000, 0);
  assert.equal(p.parts.length, 3);
  const large = p.parts.find((part) => part.mass === 2000);
  large.x = tiny.x;
  arena.moveParts(p, 35000, 0);
  assert.equal(p.parts.length, 2);
  assert.equal(p.mainPartId, "a");
});

test("Поглощение одной части сохраняет жизнь, таймер и бустеры; последняя часть завершает жизнь", () => {
  const { arena, p: eater } = scene(1000),
    victim = arena.addPlayer(0, "b");
  Object.assign(victim, {
    mass: 200,
    radius: radiusForMass(200),
    x: 5000,
    y: 5000,
    targetX: 6000,
    targetY: 5000,
    protectedUntil: 0,
  });
  arena.handleInput(victim.id, { type: "split", sequence: 1, spawnSerial: 0 }, 5000);
  const life = victim.lifeId;
  victim.boosterUses.web = 2;
  Object.assign(victim.parts[0], { x: 5000, y: 5000 });
  Object.assign(victim.parts[1], { x: 8000, y: 8000 });
  arena.syncParts(victim);
  let events = arena.resolveAbsorptions(5000);
  assert.equal(events.length, 1);
  assert.equal(events[0].gain, 80);
  assert.equal(events[0].victimDefeated, false);
  assert.equal(eater.mass, 1080);
  assert.equal(victim.mass, 100);
  assert.equal(victim.dead, false);
  assert.equal(victim.lifeId, life);
  assert.equal(victim.lifeStartedAt, 0);
  assert.equal(victim.boosterUses.web, 2);
  Object.assign(eater, { x: victim.x, y: victim.y });
  events = arena.resolveAbsorptions(6000);
  assert.equal(events.length, 1);
  assert.equal(events[0].victimDefeated, true);
  assert.equal(victim.dead, true);
  assert.equal(eater.mass, 1160);
});
test("Для поглощения сравниваются размеры отдельных частей, а не суммарная масса", () => {
  const { arena, p, split } = scene();
  split(1);
  split(2);
  split(3);
  const b = arena.addPlayer(0, "b");
  Object.assign(b, {
    mass: 1000,
    radius: radiusForMass(1000),
    x: p.parts[0].x,
    y: p.parts[0].y,
    protectedUntil: 0,
  });
  const events = arena.resolveAbsorptions(5000);
  assert.ok(events.every((event) => event.victimId !== b.id));
  assert.equal(b.dead, false);
});
test("Деление не снимает защиту появления и не позволяет вырваться из обездвиживания", () => {
  const { arena, p, split } = scene(100);
  p.protectedUntil = 7000;
  split(1);
  assert.equal(p.protectedUntil, 7000);
  p.effects.web = 20000;
  split(2);
  assert.equal(p.parts.length, 2);
  const positions = p.parts.map((part) => [part.x, part.y]);
  arena.step(6000);
  assert.deepEqual(
    p.parts.map((part) => [part.x, part.y]),
    positions,
  );
  assert.equal(RULES.MIN_PART_MASS, 2);
  assert.equal(RULES.MIN_SPLIT_MASS, 4);
  assert.equal(RULES.START_MASS, 20);
});
