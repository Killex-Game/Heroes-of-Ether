/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass, canAbsorb } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS, BOOSTER_RULES } = require("../../src/server/boosters/booster-catalog");
function scene(mass = 1000) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  for (const [p, x] of [
    [a, 1000],
    [b, 1300],
  ])
    Object.assign(p, {
      x,
      y: 5000,
      targetX: x,
      targetY: 5000,
      protectedUntil: 0,
      stopped: true,
      level: 121,
      mass,
      radius: radiusForMass(mass),
    });
  return { arena, a, b };
}
function launch(arena, p, id, now = 5000) {
  arena.prepareBooster(
    p.id,
    // The stationary mine is thrown opposite to aim; keep this contact scene facing right.
    { boosterId: id, spawnSerial: p.spawnSerial, aimX: id === "mine" ? 0 : 9000, aimY: 5000 },
    now,
  )();
}
function hit(arena, a, b, id, now = 5000, part = arena.mainBody(b)) {
  arena.combat.impact(
    {
      boosterId: id,
      ownerId: a.id,
      ownerLife: a.lifeId,
      dx: 1,
      dy: 0,
      x: b.x - 50,
      y: b.y,
      launchedAt: now,
      landed: false,
    },
    b,
    now,
    part,
  );
}
for (const [id, speed, flight, range] of [
  ["rocket", 200, 5000, 400],
  ["glove", 100, 5000, 500],
  ["mine", 80, 1000, 80],
  ["axe", 200, 5000, 400],
  ["knuckles", 200, 5000, 400],
  ["poison", 160, 5000, 250],
  ["mega_poison", 200, 5000, 400],
  ["lock", 160, 5000, 400],
  ["fire", 200, 3000, 600],
  ["cake", 200, 5000, 400],
  ["warheads", 200, 5000, 400],
  ["awl", 200, 5000, 400],
  ["freeze", 200, 5000, 500],
])
  test(id + ": скорость, время и ограничение дальности", () => {
    const { arena, a, b } = scene(10);
    b.y = 9000;
    launch(arena, a, id);
    const shot = arena.combat.shots[0],
      origin = { x: shot.x, y: shot.y };
    arena.combat.update(5500);
    assert.ok(Math.abs(Math.hypot(shot.x - origin.x, shot.y - origin.y) - speed / 2) < 1e-6);
    arena.combat.update(5000 + Math.min(flight, (range / speed) * 1000));
    if (id === "mine") {
      assert.equal(shot.x, origin.x + 80);
      assert.equal(shot.landed, true);
    } else assert.equal(arena.combat.shots.length, 0);
  });

test("Огонь достигает 550 единиц со скоростью питомцевого огня и не поражает за пределом 600", () => {
  for (const contactDistance of [550, 601]) {
    const { arena, a, b } = scene(100);
    launch(arena, a, "fire");
    const shot = arena.combat.shots[0],
      start = shot.x;
    b.x = start + contactDistance + b.radius + BOOSTER_RULES.PROJECTILE_RADIUS;
    arena.combat.update(7500);
    assert.equal(shot.x - start, 500);
    assert.equal(arena.combat.shots.length, 1, "fire is still travelling at 2.5 seconds");
    assert.equal(b.mass, 100);
    arena.combat.update(8001);
    assert.equal(shot.x - start, 600);
    assert.equal(arena.combat.shots.length, 0);
    assert.equal(b.dead, contactDistance < 600);
  }
});

test("Ракета сохраняет массу, владельца и главную часть; пределы 2/16", () => {
  const { arena, a, b } = scene(1003);
  hit(arena, a, b, "rocket");
  assert.deepEqual(
    b.parts.map((x) => x.mass),
    [803, 100, 100],
  );
  assert.equal(b.mass, 1003);
  assert.equal(b.mainPartId, "b");
  assert.equal(b.mergeAt, 35000);
  const tiny = b.parts[1];
  tiny.mass = 19;
  tiny.radius = radiusForMass(19);
  arena.syncParts(b);
  hit(arena, a, b, "rocket", 6000, tiny);
  assert.equal(b.parts.length, 3);
  for (let i = 0; i < 20; i++) hit(arena, a, b, "rocket", 7000 + i, arena.mainBody(b));
  assert.ok(b.parts.length <= 16);
  assert.ok(b.parts.every((p) => p.mass >= 2));
});
test("Секира делит поражённую часть на 4; Мина на 8 и переживает владельца", () => {
  const { arena, a, b } = scene(1003);
  hit(arena, a, b, "axe");
  assert.deepEqual(
    b.parts.map((x) => x.mass),
    [253, 250, 250, 250],
  );
  arena.resetPlayer(b, 0);
  Object.assign(b, {
    mass: 800,
    radius: radiusForMass(800),
    x: 1000 + a.radius + 10 + 80,
    y: 9000,
    protectedUntil: 0,
  });
  launch(arena, a, "mine");
  arena.removePlayer(a.id);
  arena.combat.update(6000);
  assert.equal(b.parts, null);
  b.y = 5000;
  arena.combat.update(6100);
  assert.equal(b.parts.length, 8);
  assert.equal(b.mass, 800);
  assert.equal(arena.combat.shots.length, 0);
});
test("Кастет сразу делит до лимита, повтор не наносит урон и не оставляет эффекта", () => {
  const { arena, a, b } = scene(640);
  hit(arena, a, b, "knuckles", 5000);
  assert.equal(b.parts.length, 16);
  assert.equal(b.mass, 640);
  assert.equal(b.effects.knuckles, undefined);
  hit(arena, a, b, "knuckles", 11000);
  assert.equal(b.parts.length, 16);
  assert.equal(b.mass, 640);
});

test("Яды: сроки 15/10 с, обновление текущей базой, замена сильного слабым", () => {
  const { arena, a, b } = scene(1000);
  hit(arena, a, b, "mega_poison", 5000);
  arena.boosterEffects.tick(b, 15000);
  assert.equal(b.mass, 700);
  hit(arena, a, b, "poison", 15000);
  assert.equal(b.effects.mega_poison, undefined);
  arena.gainMass(b, 100);
  arena.boosterEffects.tick(b, 35000);
  assert.equal(b.mass, 555);
  arena.boosterEffects.tick(b, 60000);
  assert.equal(b.mass, 555);
});
test("Меч складывает поджоги, яд действует независимо, шар до 300 сгорает", () => {
  const { arena, a, b } = scene(1000);
  hit(arena, a, b, "poison");
  hit(arena, a, b, "fire_sword");
  hit(arena, a, b, "fire_sword");
  arena.boosterEffects.tick(b, 12000);
  assert.equal(b.mass, 390); // Два удара по 200 и 210 от яда за четыре шага.
  arena.boosterEffects.tick(b, 25000);
  assert.equal(b.mass, 250);
  for (let i = 0; i < 5; i++) hit(arena, a, b, "fire_sword", 26000);
  arena.boosterEffects.tick(b, 27000);
  assert.equal(b.dead, true);
  assert.equal(arena.combatEvents.filter(e=>e.type==="burned").length, 1);
});
test("Замок продлевается, блокирует еду и поглощение, разрешает собственную массу", () => {
  const { arena, a, b } = scene(1000);
  hit(arena, a, b, "lock", 5000);
  hit(arena, a, b, "lock", 6000);
  assert.equal(b.effects.lock, 25000);
  arena.ether = [{ id: "food", x: b.x, y: b.y, value: 10 }];
  arena.collectEther(24000);
  assert.equal(arena.ether.length, 1);
  assert.equal(canAbsorb(b, { ...a, x: b.x, mass: 10, radius: radiusForMass(10) }, 24000), false);
  launch(arena, b, "candy", 7000);
  assert.equal(b.mass, 1150);
  arena.collectEther(25000);
  assert.equal(arena.ether.length, 0);
  assert.equal(b.mass, 1160);
});
test("Торт: пропорциональные 3%, лимит 1000 на группу, перезапуск и дробные остатки", () => {
  const { arena, a, b } = scene(1000);
  hit(arena, a, b, "rocket");
  hit(arena, a, b, "cake");
  arena.boosterEffects.tick(b, 6000);
  assert.deepEqual(
    b.parts.map((p) => p.mass),
    [824, 103, 103],
  );
  hit(arena, a, b, "cake", 7000);
  assert.equal(b.effects.cake, 47000);
  const c = arena.addPlayer(0, "c");
  c.level = 501;
  c.parts = Array.from({ length: 5 }, (_, i) => ({
    id: i ? "c" + i : c.mainPartId,
    mass: 20000,
    radius: radiusForMass(20000),
    x: 5000,
    y: 5000,
  }));
  arena.syncParts(c);
  hit(arena, a, c, "cake");
  arena.boosterEffects.tick(c, 6000);
  assert.equal(c.mass, 101000);
  const d = arena.addPlayer(0, "d");
  hit(arena, a, d, "cake");
  arena.boosterEffects.tick(d, 7000);
  assert.equal(d.mass, 21);
  d.mass = 4999;
  d.radius = radiusForMass(d.mass);
  arena.boosterEffects.tick(d, 8000);
  assert.equal(d.mass, 5000);
});
test("Повторный Торт заново запускает 40 секунд без сложения длительности и тиков роста", () => {
  const { arena, a, b } = scene(1000);
  hit(arena, a, b, "cake", 5000);
  arena.boosterEffects.tick(b, 7000);
  assert.equal(b.mass, 1060);
  assert.ok(b.cakeRemainder > 0);

  hit(arena, a, b, "cake", 7500);
  hit(arena, b, b, "cake", 7500);
  assert.equal(b.effects.cake, 47500);
  assert.equal(b.nextCakeAt, 8500);
  assert.equal(b.cakeRemainder, 0);
  assert.deepEqual(
    arena
      .snapshot(7500)
      .players.find((p) => p.id === b.id)
      .effects.filter((e) => e.id === "cake"),
    [{ id: "cake", remainingMs: 40000 }],
  );
  arena.boosterEffects.tick(b, 8499);
  assert.equal(b.mass, 1060, "первый прирост через секунду после нового попадания");
  arena.boosterEffects.tick(b, 8500);
  assert.equal(b.mass, 1091, "единственный прирост 3%, без второго потока роста");
  let expected = 1060,
    remainder = 0;
  for (let i = 0; i < 40; i++) {
    const raw = expected * 0.03 + remainder;
    expected += Math.floor(raw);
    remainder = raw % 1;
  }
  arena.boosterEffects.tick(b, 47500);
  assert.equal(b.mass, expected, "новый эффект даёт ровно 40 приростов");
  arena.boosterEffects.tick(b, 90000);
  assert.equal(b.mass, expected, "старая длительность не добавляется после окончания эффекта");

  hit(arena, a, b, "cake", 91000);
  arena.boosterEffects.tick(b, 91999);
  assert.equal(b.mass, expected);
  arena.boosterEffects.tick(b, 92000);
  assert.equal(b.mass, expected + Math.floor(expected * 0.03));
});
test("Перчатка переносит всю группу на 400 за 0,5 с, даже остановленную Камнем", () => {
  const { arena, a, b } = scene(1000);
  hit(arena, a, b, "rocket");
  const old = b.parts.map((p) => p.x);
  b.effects.stone = 12000;
  hit(arena, a, b, "glove", 5000);
  arena.combat.movePull(b, 5250);
  b.parts.forEach((p, i) => assert.ok(Math.abs(p.x - old[i] - 200) < 1e-6));
  arena.combat.movePull(b, 5500);
  b.parts.forEach((p, i) => assert.ok(Math.abs(p.x - old[i] - 400) < 1e-6));
  assert.equal(b.effects.stone, 12000);
});
test("Шило снимает любой щит, сохраняя перезарядки и остальные эффекты", () => {
  for (const id of ["colorful_shield", "sphere", "golden_shield", "clan_shield"]) {
    const { arena, a, b } = scene();
    launch(arena, b, id);
    hit(arena, a, b, "poison");
    assert.equal(b.effects.poison, undefined);
    b.effects.poison = 20000;
    b.boosterReadyAt = 7000;
    const shieldReadyAt = { ...b.shieldReadyAt };
    hit(arena, a, b, "awl", 6000);
    assert.equal(b.effects[id], undefined);
    assert.deepEqual(b.shieldReadyAt, shieldReadyAt);
    assert.equal(b.effects.poison, 20000);
    assert.equal(b.boosterReadyAt, 7000);
    assert.doesNotThrow(() => launch(arena, b, "web", 6000));
    assert.doesNotThrow(() => launch(arena, b, id, 6000));
  }
  const { arena, b } = scene();
  launch(arena, b, "golden_shield");
  launch(arena, b, "clan_shield");
  assert.doesNotThrow(() => launch(arena, b, "golden_shield", 6000));
});

test("Шило без щита сохраняет ускорение; новое применение обновляет срок", () => {
  const { arena, a, b } = scene();
  launch(arena, b, "speed", 5000);
  hit(arena, a, b, "awl", 5500);
  assert.equal(b.boosterReadyAt, 0);
  assert.equal(b.effects.speed, 20000);
  launch(arena, b, "sphere", 5500);
  const readyAt = b.boosterReadyAt;
  hit(arena, a, b, "awl", 5501);
  assert.equal(b.boosterReadyAt, readyAt);
  assert.equal(b.effects.speed, 20000);
  launch(arena, b, "speed", 5501);
  assert.equal(b.effects.speed, 20501);
  launch(arena, b, "speed", 6000);
  assert.equal(b.effects.speed, 21000);
});
test("Клановый щит отражает повторно, скорость 200 и исходный срок сохраняются", () => {
  const { arena, a, b } = scene(10);
  b.x = 1200;
  a.effects.clan_shield = b.effects.clan_shield = 35000;
  launch(arena, a, "mega_poison");
  arena.combat.update(7100);
  let s = arena.combat.shots[0];
  assert.equal(s.ownerId, b.id);
  assert.equal(s.speed, 200);
  assert.equal(s.landsAt, 10000);
  arena.combat.update(7900);
  s = arena.combat.shots[0];
  assert.equal(s.ownerId, a.id);
  assert.equal(s.landsAt, 10000);
  arena.combat.update(10000);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(a.effects.mega_poison, undefined);
  assert.equal(b.effects.mega_poison, undefined);
});
test("Наземную мину Клановый щит отражает, Торт пропускает, Меч блокирует", () => {
  const { arena, a, b } = scene();
  b.effects.clan_shield = 35000;
  arena.combat.impact({ boosterId: "mine", ownerId: a.id, landed: true }, b, 5000);
  assert.equal(b.parts, null);
  hit(arena, a, b, "cake");
  assert.equal(b.effects.cake, 45000);
  hit(arena, a, b, "fire_sword");
  assert.equal(b.effects.fire_sword, undefined);
});
test("Огонь поражает только пересечённые шары, один раз на снаряд, проходит щит и других игроков", () => {
  const { arena, a, b } = scene(500);
  b.parts = [
    { id: "b", x: 1250, y: 5000, mass: 500, radius: radiusForMass(500) },
    { id: "remote", x: 1250, y: 5500, mass: 500, radius: radiusForMass(500) },
  ];
  arena.syncParts(b);
  b.effects.clan_shield = 20000;
  const c = arena.addPlayer(0, "c");
  Object.assign(c, { x: 1380, y: 5000, mass: 49, radius: radiusForMass(49), protectedUntil: 0 });
  launch(arena, a, "fire");
  arena.combat.update(8000);
  assert.equal(b.parts[0].mass, 250);
  assert.equal(b.parts[1].mass, 500);
  arena.combat.update(8100);
  assert.equal(b.parts[0].mass, 250);
  arena.combat.update(10000);
  assert.equal(c.dead, true);
  assert.deepEqual(
    arena.combatEvents.map((e) => e.type),
    ["burned"],
  );
  assert.equal(a.mass, 500);
});
test("Огонь уничтожает часть с массой 50 сразу, заменяет главную часть без события поглощения", () => {
  const { arena, a, b } = scene(50);
  hit(arena, a, b, "fire");
  assert.equal(b.dead, true);
  assert.equal(arena.combatEvents[0].type, "burned");
  arena.resetPlayer(b, 0);
  Object.assign(b, { mass: 1000, radius: radiusForMass(1000) });
  hit(arena, a, b, "rocket");
  const main = arena.mainBody(b);
  main.mass = 50;
  main.radius = radiusForMass(50);
  arena.syncParts(b);
  hit(arena, a, b, "fire", 6000, main);
  assert.equal(b.dead, false);
  assert.notEqual(b.mainPartId, "b");
  assert.equal(b.mass, 200);
});
test("Боеголовки: 7 отдельных ракет, один расход, веер −20…+20 градусов", () => {
  const { arena, a } = scene();
  launch(arena, a, "warheads");
  assert.equal(arena.combat.shots.length, 7);
  assert.equal(a.boosterUses.warheads, 1);
  assert.ok(
    Math.abs(
      (Math.atan2(arena.combat.shots[0].dy, arena.combat.shots[0].dx) * 180) / Math.PI + 20,
    ) < 1e-8,
  );
});
test("Вихрь притягивает еду и незащищённые части, без массы, в течение 10 с", () => {
  const { arena, a, b } = scene(10);
  b.x = 1150;
  b.y = 5050;
  arena.ether = [{ id: "food", x: 1130, y: 5000, value: 3 }];
  launch(arena, a, "vortex");
  arena.combat.update(5000);
  const before = b.x;
  arena.combat.update(6000);
  assert.ok(b.x < before);
  assert.equal(arena.ether[0].x, 1030);
  assert.equal(b.mass, 10);
  b.effects.golden_shield = 30000;
  const protectedX = b.x;
  arena.combat.update(7000);
  assert.equal(b.x, protectedX);
  arena.combat.update(15000);
  assert.equal(arena.combat.shots.length, 0);
});
test("Вихрь двигает природную еду из fillEther, включая повторное заполнение", () => {
  const arena = new Arena({ etherCount: 10, random: () => 0.5, world: { width: 10000, height: 10000 } });
  const p = arena.addPlayer(0, "vortex-natural-food");
  Object.assign(p, { x: 4900, y: 5000, targetX: 4900, targetY: 5000,
    protectedUntil: 0, stopped: true, level: 121, mass: 10, radius: radiusForMass(10) });
  launch(arena, p, "vortex");
  arena.combat.update(5000);
  const beforeVortex=arena.snapshot(5000).ether;
  const savedBefore=structuredClone(beforeVortex);
  arena.combat.update(5500);
  assert.equal(arena.ether[0].x, 4950);
  assert.equal(arena.ether[0].y, 5000);
  assert.deepEqual(beforeVortex,savedBefore,'older network snapshots keep their original positions');
  const moved=arena.snapshot(5500).ether;
  assert.equal(moved[0].x,4950);
  assert.notEqual(moved[0],beforeVortex[0]);
  assert.equal(arena.snapshot(5500).ether[0],moved[0],'unchanged presentation value is reusable');
  arena.ether.length = 0;
  arena.fillEther();
  arena.combat.update(6000);
  assert.equal(arena.ether[0].x, 4950);
  assert.equal(p.mass, 10);
});
test("Губка снимает ожидание, не переносит части и не обходит неподвижность Паутины", () => {
  const { arena, a, b } = scene();
  hit(arena, a, b, "rocket");
  b.parts.forEach((part, i) => {
    part.x = 1300 + i * 300;
    part.vx = part.vy = 0;
  });
  arena.syncParts(b);
  b.nextMassDecayAt = Infinity;
  b.effects.web = 20000;
  const before = b.parts.map(({ id, x, y, mass, vx, vy }) => ({ id, x, y, mass, vx, vy }));
  const mainId = b.mainPartId;
  launch(arena, b, "sponge", 5000);
  assert.deepEqual(
    b.parts.map(({ id, x, y, mass, vx, vy }) => ({ id, x, y, mass, vx, vy })),
    before,
  );
  assert.ok(b.parts.every((part) => part.mergeAt <= 5000));
  assert.equal(b.mergeAt, 5000);
  assert.doesNotThrow(() => launch(arena, b, "sponge", 6000));
  for (let at = 5000; at <= 11000; at += 1000) arena.step(at);
  assert.deepEqual(
    b.parts.map(({ id, x, y, mass, vx, vy }) => ({ id, x, y, mass, vx, vy })),
    before,
    "Даже после пяти секунд части не переносятся в одну точку",
  );
  assert.equal(b.effects.sponge, undefined);
  delete b.effects.web;
  const main = arena.mainBody(b),
    x = main.x,
    y = main.y;
  for (let i = 0; b.parts && i < 500; i++) arena.moveParts(b, 11050 + i * 50, 1);
  assert.equal(b.parts, null, "После окончания эффекта обычное соединение продолжается");
  assert.equal(b.mass, 1000);
  assert.equal(b.mainPartId, mainId);
  assert.equal(b.x, x);
  assert.equal(b.y, y);
});

test("Губка не ускоряет дальние части и не сводит их по истечении пяти секунд", () => {
  const { arena, a, b } = scene();
  hit(arena, a, b, "rocket");
  b.parts.forEach((part, i) => Object.assign(part, { x: 1300 + i * 4000, vx: 0, vy: 0 }));
  arena.syncParts(b);
  const count = b.parts.length,
    main = arena.mainBody(b),
    mainX = main.x;
  launch(arena, b, "sponge", 5000);
  for (let at = 5000; at <= 11000; at += 50) {
    const previous = b.parts.map((part) => ({ x: part.x, y: part.y }));
    arena.moveParts(b, at, 1);
    assert.equal(b.parts.length, count);
    b.parts.forEach((part, i) => {
      assert.ok(Math.hypot(part.x - previous[i].x, part.y - previous[i].y) < 20);
    });
  }
  assert.equal(main.x, mainX);
  assert.ok(Math.abs(b.parts[1].x - main.x) > 1000);
});

test("Новое добровольное и принудительное деление после Губки получает обычную задержку", () => {
  for (const forced of [false, true]) {
    const { arena, b } = scene();
    arena.boosterEffects.split(b, b, 2, 5000);
    launch(arena, b, "sponge", 5000);
    const main = arena.mainBody(b),
      untouched = b.parts.find((part) => part !== main);
    if (forced) arena.boosterEffects.split(b, main, 2, 6000);
    else arena.splitPlayer(b, { spawnSerial: b.spawnSerial, sequence: 1 }, 6000);
    for (const part of b.parts) {
      assert.equal(part.mergeAt, forced && part === untouched ? 5000 : 36000);
      Object.assign(part, { x: 5000, y: 5000, vx: 0, vy: 0 });
    }
    const count = b.parts.length;
    arena.moveParts(b, 10000, 0);
    assert.equal(b.parts.length, count, "Новые части не наследуют досрочное соединение");
  }
});
test("Губка без частей не расходуется; конец жизни снимает все эффекты", () => {
  const { arena, a, b } = scene();
  assert.throws(() => launch(arena, b, "sponge"), /нужны разделённые/);
  hit(arena, a, b, "poison");
  hit(arena, a, b, "cake");
  arena.resetPlayer(b, 30000);
  arena.boosterEffects.tick(b, 100000);
  assert.equal(b.mass, 20);
  assert.deepEqual(b.effects, {});
});
