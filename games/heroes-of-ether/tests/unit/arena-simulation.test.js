/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Arena,
  RULES,
  ETHER_COLORS,
  radiusForMass,
  absorptionGain,
  canAbsorb,
} = require("../../src/server/arena/arena-simulation");
function setup(entries) {
  const arena = new Arena({ etherCount: 0 });
  const players = entries.map(([id, mass, x = 500, y = 500]) => {
    const p = arena.addPlayer(0, id);
    Object.assign(p, {
      mass,
      radius: radiusForMass(mass),
      x,
      y,
      targetX: x,
      targetY: y,
      protectedUntil: 0,
      lastMoveAt: 5000,
    });
    return p;
  });
  return { arena, players };
}

test("Food IDs never repeat after refill or W, and remain local transport identifiers", () => {
  const arena = new Arena({ etherCount: 200 });
  const seen = new Set(arena.ether.map((orb) => orb.id));
  assert.equal(seen.size, 200);
  const player = arena.addPlayer(0, "test");
  Object.assign(player, { mass: 1000, radius: radiusForMass(1000) });
  for (let i = 1; i <= 20; i++) {
    arena.ether = [];
    arena.fillEther();
    assert.equal(
      arena.feedPlayer(
        player,
        {
          spawnSerial: player.spawnSerial,
          sequence: i,
          x: 100,
          y: 100,
        },
        i * 1000,
      ),
      true,
    );
    for (const orb of arena.ether) {
      assert.equal(typeof orb.id, "string");
      assert.equal(seen.has(orb.id), false);
      seen.add(orb.id);
    }
    assert.equal(arena.ether.filter((orb) => orb.ejected).length, 1);
  }
  assert.equal(player.mass, 900, "W still costs five mass per portion");
});

test("80% с округлением вниз, включая 57 -> 45 и 100 -> 80", () => {
  assert.equal(absorptionGain(57), 45);
  assert.equal(absorptionGain(100), 80);
  assert.equal(absorptionGain(10), 8);
  for (let m = 1; m <= 5000; m++) assert.equal(absorptionGain(m), Math.floor((m * 4) / 5));
});
test("Одинаковые сферы не поглощают друг друга даже в одной точке", () => {
  const { arena } = setup([
    ["a", 50],
    ["b", 50],
  ]);
  assert.equal(arena.resolveAbsorptions(5000).length, 0);
});
test("Поглощение требует преимущества радиуса строго больше 15% при любом размере", () => {
  const {
    players: [a, b],
  } = setup([
    ["a", 550],
    ["b", 500],
  ]);
  assert.equal(canAbsorb(a, b, 5000), false);
  for (const mass of [2, 10, 500, 5000, 30000]) {
    b.mass = mass;
    b.radius = radiusForMass(mass);
    for (const offset of [-0.001, 0, 0.001]) {
      a.radius = b.radius * 1.15 + offset;
      a.mass = ((a.radius - 16) / 2.5) ** 2;
      assert.equal(canAbsorb(a, b, 5000), offset > 0);
    }
  }
});
test("Касание краёв больше НЕ поглощает игрока", () => {
  const {
    arena,
    players: [a, b],
  } = setup([
    ["a", 100],
    ["b", 10],
  ]);
  b.x = a.x + a.radius + b.radius - 0.1;
  assert.equal(arena.resolveAbsorptions(5000).length, 0);
  assert.equal(a.mass, 100);
  assert.equal(b.mass, 10);
});
test("Точная граница поглощения — центр жертвы внутри R − r/3", () => {
  const {
    players: [a, b],
  } = setup([
    ["a", 100],
    ["b", 10],
  ]);
  const limit = a.radius - b.radius / 3;
  b.x = a.x + limit + 0.001;
  assert.equal(canAbsorb(a, b, 5000), false);
  b.x = a.x + limit - 0.001;
  assert.equal(canAbsorb(a, b, 5000), true);
});
test("Награда начисляется по массе ДО возрождения", () => {
  const {
    arena,
    players: [a, b],
  } = setup([
    ["a", 400],
    ["b", 57],
  ]);
  const events = arena.resolveAbsorptions(5000);
  assert.equal(events.length, 1);
  assert.equal(events[0].victimMass, 57);
  assert.equal(events[0].gain, 45);
  assert.equal(a.mass, 445);
  assert.equal(b.dead, true);
  assert.equal(b.mass, 57);
  assert.equal(b.spawnSerial, 0);
  assert.equal(
    arena.snapshot(5000).players.some((p) => p.id === b.id),
    false,
  );
  arena.resetPlayer(b, 6000);
  assert.equal(b.mass, 20);
  assert.equal(b.radius, radiusForMass(20));
  assert.equal(b.spawnSerial, 1);
});
test("Повторный проход того же тика не удваивает награду", () => {
  const {
    arena,
    players: [a, b],
  } = setup([
    ["a", 100],
    ["b", 10],
  ]);
  arena.resolveAbsorptions(5000);
  b.x = a.x;
  b.y = a.y;
  assert.equal(arena.resolveAbsorptions(5000).length, 0);
  assert.equal(a.mass, 108);
});
test("Защита появления двусторонняя и заканчивается ровно через 2 секунды", () => {
  const {
    players: [a, b],
  } = setup([
    ["a", 100],
    ["b", 10],
  ]);
  b.protectedUntil = 7000;
  assert.equal(canAbsorb(a, b, 6999), false);
  assert.equal(canAbsorb(a, b, 7000), true);
  b.protectedUntil = 0;
  a.protectedUntil = 7000;
  assert.equal(canAbsorb(a, b, 6999), false);
});
test("При конкуренции за жертву нет двойного поглощения или атаки уже съеденной сферы", () => {
  const {
    arena,
    players: [a, b, c],
  } = setup([
    ["a", 1000],
    ["b", 100],
    ["c", 10],
  ]);
  const events = arena.resolveAbsorptions(5000);
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map((e) => e.victimId)).size, 2);
  assert.ok(events.every((e) => e.eaterId === "a"));
  assert.equal(a.mass, 1088);
  assert.equal(b.dead, true);
  assert.equal(c.dead, true);
});
test("Порядок подключения не меняет результат столкновения трёх игроков", () => {
  for (const ids of [
    ["a", "b", "c"],
    ["c", "a", "b"],
    ["b", "c", "a"],
  ]) {
    const masses = { a: 1000, b: 100, c: 10 };
    const { arena } = setup(ids.map((id) => [id, masses[id]]));
    arena.resolveAbsorptions(5000);
    assert.equal(arena.players.get("a").mass, 1088);
  }
});
test("Новый игрок и возрождённый получают одинаковый радиус при массе 10", () => {
  const a = new Arena({ etherCount: 0 });
  const p = a.addPlayer(0);
  const r = p.radius;
  a.resetPlayer(p, 10);
  assert.equal(p.radius, r);
  assert.equal(p.protectedUntil, 2010);
});
test("Возрождение не выбирает первую опасную точку, если есть свободная", () => {
  const { arena } = setup([["a", 500, 1200, 800]]);
  let i = 0;
  arena.random = () => [0.5, 0.5, 0, 0][Math.min(i++, 3)];
  const pos = arena.chooseSpawn("b");
  assert.ok(Math.hypot(pos.x - 1200, pos.y - 800) > 500);
});
test("Сервер не принимает массу, награду и радиус от клиента; null и массив безопасны", () => {
  const {
    arena,
    players: [a],
  } = setup([["a", 10]]);
  for (const m of [
    null,
    [],
    { type: "mass", mass: 999 },
    { type: "move", x: NaN, y: 0 },
    { type: "move", x: 1, y: 1, mass: 999, radius: 999 },
  ])
    arena.handleInput(a.id, m, 5000);
  assert.equal(a.mass, 10);
  assert.equal(a.radius, radiusForMass(10));
  assert.equal(a.x, 500);
});
test("Устаревшая команда движения после возрождения отбрасывается", () => {
  const {
    arena,
    players: [a],
  } = setup([["a", 10]]);
  const serial = a.spawnSerial;
  arena.resetPlayer(a, 5000);
  const x = a.targetX;
  arena.handleInput(a.id, { type: "move", x: 0, y: 0, spawnSerial: serial }, 5010);
  assert.equal(a.targetX, x);
  arena.handleInput(a.id, { type: "move", x: 0, y: 0, spawnSerial: a.spawnSerial }, 5020);
  assert.equal(a.targetX, 0);
});

test("Остановка использует текущую серверную позицию и отклоняет прошлую жизнь", () => {
  const {
    arena,
    players: [a],
  } = setup([["a", 10]]);
  arena.handleInput(a.id, { type: "move", x: 900, y: 500 }, 5000);
  arena.step(5050);
  const x = a.x,
    y = a.y;
  arena.handleInput(a.id, { type: "stop", x: 500, y: 500, spawnSerial: a.spawnSerial }, 5051);
  arena.step(5100);
  assert.equal(a.x, x);
  assert.equal(a.y, y);
  const oldSerial = a.spawnSerial;
  arena.resetPlayer(a, 6000);
  arena.handleInput(a.id, { type: "move", x: 900, y: 500, spawnSerial: a.spawnSerial }, 6001);
  arena.handleInput(a.id, { type: "stop", spawnSerial: oldSerial }, 6002);
  assert.equal(a.targetX, 900);
  assert.equal(a.targetY, 500);
});
test("Сбор частицы единственный и серверный; радиус сразу меняется", () => {
  const {
    arena,
    players: [a],
  } = setup([["a", 10]]);
  arena.ether = [{ id: "f", x: 500, y: 500, value: 1 }];
  arena.collectEther();
  arena.collectEther();
  assert.equal(a.mass, 11);
  assert.equal(arena.ether.length, 0);
  assert.equal(a.radius, radiusForMass(11));
});

test("Еда: 180/75/30/15 частиц, семь цветов и восстановление номиналов после сбора", () => {
  let seed = 17;
  const arena = new Arena({ random: () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32 });
  const counts = () =>
    [1, 3, 5, 10].map((value) => arena.ether.filter((orb) => orb.value === value).length);
  assert.deepEqual(counts(), [180, 75, 30, 15]);
  assert.equal(new Set(arena.ether.map((orb) => orb.color)).size, 7);
  for (const orb of arena.ether) {
    assert.ok(ETHER_COLORS.includes(orb.color));
    assert.ok(
      orb.x >= 30 &&
        orb.x <= arena.world.width - 30 &&
        orb.y >= 30 &&
        orb.y <= arena.world.height - 30,
    );
  }
  const radii = [1, 3, 5, 10].map((value) => arena.ether.find((orb) => orb.value === value).radius);
  assert.ok(radii.every((radius, i) => !i || radius > radii[i - 1]));
  for (let round = 0; round < 20; round++) {
    arena.ether = arena.ether.filter((orb) => orb.value !== (round % 2 ? 1 : 10));
    arena.fillEther();
    assert.deepEqual(counts(), [180, 75, 30, 15]);
  }
  assert.equal(new Arena({ etherCount: 0 }).ether.length, 0);
  assert.equal(new Arena({ etherCount: 7 }).ether.length, 7);
});

test("Частицы 1/3/5/10 дают ровно 19 массы победителю спора и расходуются один раз", () => {
  const {
    arena,
    players: [a, b],
  } = setup([
    ["a", 100],
    ["b", 10],
  ]);
  arena.ether = [1, 3, 5, 10].map((value) => ({ id: String(value), x: 500, y: 500, value }));
  arena.collectEther();
  arena.collectEther();
  assert.equal(a.mass, 119);
  assert.equal(b.mass, 10);
  assert.equal(a.radius, radiusForMass(119));
  assert.equal(arena.ether.length, 0);
});
test("Движение ограничено скоростью, границами и устареванием ввода", () => {
  const {
    arena,
    players: [a],
  } = setup([["a", 10]]);
  arena.handleInput(a.id, { type: "move", x: 999999, y: -999999 }, 5000);
  arena.step(5050);
  assert.ok(Math.hypot(a.x - 500, a.y - 500) < 5);
  a.x = -100;
  a.y = -100;
  arena.clampPlayer(a);
  assert.equal(a.x, arena.bodyBounds(a).minX);
  assert.equal(a.y, arena.bodyBounds(a).minY);
  const x = a.x;
  arena.step(7000);
  assert.equal(a.x, x);
});
test("Снимок не раскрывает серверные управляющие поля и содержит поколение возрождения", () => {
  const a = new Arena({ etherCount: 0 });
  a.addPlayer(0, "test");
  const p = a.snapshot(100).players[0];
  assert.equal(p.spawnSerial, 0);
  assert.equal(p.shieldMs, 1900);
  assert.equal(p.targetX, undefined);
  assert.equal(p.protectedUntil, undefined);
});
