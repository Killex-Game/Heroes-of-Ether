/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
function scene() {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  for (const [p, x] of [
    [a, 1000],
    [b, 1600],
  ])
    Object.assign(p, {
      level: 25,
      x,
      y: 5000,
      targetX: x,
      targetY: 5000,
      protectedUntil: 0,
      stopped: true,
    });
  return { arena, a, b };
}
function launch(arena, p, id, now = 5000, aim = { x: 9000, y: 5000 }) {
  arena.prepareBooster(
    p.id,
    { boosterId: id, spawnSerial: p.spawnSerial, aimX: aim.x, aimY: aim.y },
    now,
  )();
}
test("Одиночный выстрел и все 5 ракет начинаются за краем ближайшей к курсору части", () => {
  const { arena, a } = scene();
  a.parts = [
    { id: "a", mass: 400, radius: radiusForMass(400), x: 2000, y: 3000 },
    { id: "secondary", mass: 1000, radius: radiusForMass(1000), x: 8000, y: 7000 },
  ];
  arena.syncParts(a);
  const main = a.parts[0];
  assert.notEqual(main, arena.mainBody(a));
  for (const [id, at, count] of [
    ["freeze", 5000, 1],
    ["warheads", 7000, 5],
  ]) {
    arena.combat.shots = [];
    launch(arena, a, id, at, { x: 2500, y: 3500 });
    assert.equal(arena.combat.shots.length, count);
    for (const shot of arena.combat.shots) {
      assert.ok(Math.abs(Math.hypot(shot.x - main.x, shot.y - main.y) - (main.radius + 10)) < 1e-8);
      assert.ok(Math.abs((shot.x - main.x) * shot.dy - (shot.y - main.y) * shot.dx) < 1e-8);
      assert.equal(shot.launchedAt, at);
    }
  }
});
test("Запуск с края у стены остаётся внутри карты и сохраняет направление веера", () => {
  const { arena, a } = scene();
  a.x = 10000 - a.radius;
  a.y = 5000;
  launch(arena, a, "warheads", 5000, { x: 10000, y: 5001 });
  for (const s of arena.combat.shots) {
    assert.ok(s.x >= 0 && s.x <= 10000 && s.y >= 0 && s.y <= 10000);
    assert.ok(Math.abs((s.x - a.x) * s.dy - (s.y - a.y) * s.dx) < 1e-8);
  }
});
for (const [id, speed] of [
  ["freeze", 200],
  ["hook", 200],
  ["harpoon", 200],
  ["stone", 180],
])
  test(id + ": полёт со скоростью " + speed + " единиц/с", () => {
    const { arena, a, b } = scene();
    b.y = 1000;
    launch(arena, a, id);
    const origin = arena.combat.shots[0].x;
    arena.combat.update(6000);
    assert.equal(arena.combat.shots[0].x, origin + speed);
    assert.equal(arena.combat.shots[0].y, 5000);
    arena.combat.update(6500);
    assert.equal(arena.combat.shots[0].x, origin + speed * 1.5);
  });
test("Заморозка: направление фиксируется при запуске, попадание по первой части, 10 секунд после попадания", () => {
  const { arena, a, b } = scene(),
    c = arena.addPlayer(0, "c");
  Object.assign(c, { x: 2200, y: 5000, protectedUntil: 0 });
  b.x = 1300;
  launch(arena, a, "freeze");
  a.targetX = 0;
  a.targetY = 0;
  arena.combat.update(5500);
  assert.equal(b.effects.freeze, undefined);
  assert.equal(arena.combat.shots[0].y, 5000);
  arena.combat.update(8000);
  assert.equal(b.effects.freeze, 18000);
  assert.equal(c.effects.freeze, undefined);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(arena.hasEffect(b, "slow", 17999), true);
  assert.equal(arena.hasEffect(b, "slow", 18000), false);
});
test("Заморозка уменьшает реальную скорость на 30%, не меняя массу", () => {
  const { arena, a, b } = scene();
  b.effects.freeze = 15000;
  for (const p of [a, b])
    Object.assign(p, { targetX: p.x + 500, lastMoveAt: 6000, stopped: false });
  arena.step(6050);
  assert.ok(Math.abs((b.x - 1600) / (a.x - 1000) - 0.7) < 1e-8);
  assert.equal(b.mass, 20);
});
test("Полёт проходит между кадрами и не наводится на сменившего направление соперника", () => {
  const { arena, a, b } = scene();
  launch(arena, a, "freeze");
  b.y = 5200;
  arena.combat.update(6000);
  assert.equal(b.effects.freeze, undefined);
  b.x = 1400;
  b.y = 5000;
  arena.combat.update(9000);
  assert.equal(b.effects.freeze, 19000);
});
test("Щит поглощает выстрел, защита появления останавливает его; стоимость запуска не возвращается", () => {
  const { arena, a, b } = scene();
  b.x = 1300;
  b.effects.golden_shield = 15000;
  launch(arena, a, "freeze");
  arena.combat.update(8000);
  assert.equal(b.effects.freeze, undefined);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(a.boosterUses.freeze, 1);
  delete b.effects.golden_shield;
  b.protectedUntil = 12000;
  launch(arena, a, "freeze", 9000);
  arena.combat.update(12000 - 1);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(b.effects.freeze, undefined);
});
test("Снаряды исчезают по времени, у границы и при окончании жизни отправителя", () => {
  for (const id of ["freeze", "hook", "harpoon"]) {
    const { arena, a, b } = scene();
    b.y = 1000;
    launch(arena, a, id);
    const ttl = id === "harpoon" ? 2000 : 5000;
    arena.combat.update(5000 + ttl);
    assert.equal(arena.combat.shots.length, 0);
    launch(arena, a, id, 20000);
    a.dead = true;
    arena.combat.update(20001);
    assert.equal(arena.combat.shots.length, 0);
  }
  const { arena, a, b } = scene();
  a.x = 9990;
  b.y = 1000;
  launch(arena, a, "hook", 5000, { x: 10000, y: 5000 });
  arena.combat.update(5100);
  assert.equal(arena.combat.shots.length, 0);
});
for (const [id, flight, duration] of [
  ["web", 1000, 7000],
  ["stone", 4000, 5000],
])
  test(
    id +
      ": точный срок полёта и обездвиживания, ловушка переживает выход владельца и срабатывает один раз",
    () => {
      const { arena, a, b } = scene();
      b.y = 1000;
      launch(arena, a, id);
      const origin = arena.combat.shots[0].x;
      arena.removePlayer(a.id);
      const landing = 5000 + flight;
      arena.combat.update(landing - 1);
      const flying = arena.combat.shots[0];
      assert.equal(flying.landed, false);
      b.x = origin + (flight / 1000) * (id === "web" ? 80 : 180);
      b.y = 1000;
      arena.combat.update(landing - 1);
      assert.equal(b.effects[id], undefined);
      b.y = 1000;
      arena.combat.update(landing);
      assert.equal(arena.combat.shots.length, 1);
      const trap = arena.combat.shots[0];
      assert.equal(trap.landed, true);
      assert.ok(Math.abs(trap.x - (origin + (flight / 1000) * (id === "web" ? 80 : 180))) < 1e-8);
      const impact = landing + 100;
      b.x = trap.x;
      b.y = trap.y;
      arena.combat.update(impact);
      assert.equal(b.effects[id], impact + duration);
      assert.equal(arena.combat.shots.length, 0);
      arena.combat.update(impact + 500);
      assert.equal(b.effects[id], impact + duration);
      assert.equal(arena.hasEffect(b, id === "stone" ? "dizzy" : "root", impact + duration - 1), true);
      assert.equal(arena.hasEffect(b, "root", impact + duration), false);
    },
  );
test("Мина взрывается при касании в полёте: противник, собственный шар и другая своя часть", () => {
  for (const kind of ["enemy", "self", "sibling"]) {
    const { arena, a, b } = scene();
    b.y = 7000;
    Object.assign(a, { mass: 800, radius: radiusForMass(800) });
    if (kind === "sibling") {
      a.parts = [
        { id: a.mainPartId, x: 1000, y: 5000, mass: 800, radius: radiusForMass(800) },
        { id: "sibling", x: 1000, y: 5500, mass: 80, radius: radiusForMass(80) },
      ];
      arena.syncParts(a);
    }
    launch(arena, a, "mine");
    const shot = arena.combat.shots[0];
    if (kind === "sibling") Object.assign(a.parts[1], { x: shot.x + 20, y: shot.y });
    if (kind !== "sibling") {
      const hit = kind === "self" ? a : b;
      Object.assign(hit, { x: shot.x + 20, y: shot.y, mass: 80, radius: radiusForMass(80) });
    }
    arena.combat.update(5050);
    assert.equal(arena.combat.shots.length, 0, kind);
    assert.equal(arena.audioEvents.length, 1, kind);
    assert.equal(arena.audioEvents[0].targetId, kind === "enemy" ? b.id : a.id);
    assert.ok(arena.bodies(kind === "enemy" ? b : a).length > 1, kind);
    arena.combat.update(5100);
    assert.equal(arena.audioEvents.length, 1);
  }
});
test("Мина свободно покидает исходный шар, но взрывается при повторном касании до приземления", () => {
  const { arena, a, b } = scene();
  b.y = 7000;
  launch(arena, a, "mine");
  arena.combat.update(5100);
  assert.equal(arena.combat.shots.length, 1);
  const shot = arena.combat.shots[0];
  Object.assign(a, { x: shot.x, y: shot.y, mass: 80, radius: radiusForMass(80) });
  arena.combat.update(5200);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(a.parts.length, 8);
});
test("Владелец тоже попадает в свою ловушку; после приземления", () => {
  const { arena, a, b } = scene();
  b.y = 1000;
  launch(arena, a, "web");
  arena.combat.update(5999);
  const trap = arena.combat.shots[0];
  a.x = trap.x;
  a.y = trap.y;
  assert.equal(a.effects.web, undefined);
  arena.combat.update(6000);
  assert.equal(a.effects.web, 13000);
  assert.equal(arena.combat.shots.length, 0);
});
for (const id of ["harpoon"])
  test(id + ": перемещает все части с постоянной скоростью, сохраняя массу и расположение", () => {
    const { arena, a, b } = scene(),
      moving = id === "hook" ? b : a;
    moving.parts = [-50, 50].map((offset, i) => ({
      id: i ? "small" : moving.mainPartId,
      x: moving.x,
      y: moving.y + offset,
      mass: 20,
      radius: radiusForMass(20),
      vx: 0,
      vy: 0,
    }));
    arena.syncParts(moving);
    // Крюк направлен на одну из частей; перенос считает центр всего игрока.
    launch(arena, a, id, 5000, arena.mainBody(b));
    const projectile = arena.combat.shots[0];
    arena.combat.update(8100);
    assert.equal(arena.combat.pulls.has(moving.id), true);
    const x = moving.x,
      ys = moving.parts.map((p) => p.y),
      expected = projectile.dx * 612;
    const dy = projectile.dy * 612;
    const duration = arena.combat.pulls.get(moving.id).duration;
    arena.combat.movePull(moving, 8100 + duration / 2);
    assert.ok(Math.abs(moving.x - x - expected / 2) < 1e-6);
    arena.combat.movePull(moving, 8100 + duration + 0.001);
    assert.ok(Math.abs(moving.x - x - expected) < 1e-6);
    moving.parts.forEach((p, i) => assert.ok(Math.abs(p.y - ys[i] - dy) < 1e-8));
    assert.equal(moving.mass, 40);
    assert.equal(arena.combat.pulls.size, 0);
  });
test("Поглощение/новая жизнь прекращают притягивание прежней сферы", () => {
  const { arena, a, b } = scene();
  launch(arena, a, "hook");
  arena.combat.update(8100);
  arena.resetPlayer(b, 8200);
  arena.combat.update(8200);
  assert.equal(arena.combat.pulls.size, 0);
});
test("Ловушка у границы прекращает движение по обеим осям, не скользит вдоль стены", () => {
  const { arena, a, b } = scene();
  b.y = 1000;
  a.x = 9950;
  launch(arena, a, "web", 5000, { x: 10000, y: 5050 });
  arena.combat.update(6000);
  const shot = arena.combat.shots[0];
  assert.equal(shot.x, 10000);
  assert.ok(Math.abs(shot.y - 5050) < 1e-8);
  const stoppedY = shot.y;
  arena.combat.update(8000);
  assert.equal(shot.x, 10000);
  assert.equal(shot.y, stoppedY);
});
test("Камень не прибавляет оставшееся время Паутины", () => {
  const { arena, a, b } = scene();
  b.y = 1000;
  launch(arena, a, "stone");
  arena.combat.update(9000);
  const shot = arena.combat.shots[0];
  b.x = shot.x;
  b.y = shot.y;
  b.effects.web = 10000;
  arena.combat.update(9100);
  assert.equal(b.effects.web, 10000);
  assert.equal(b.effects.stone, 14100);
  assert.equal(arena.combat.shots.length, 0);
});
test("48 ловушек на профиль: общий предел двух типов, новых жизней и переподключений; чужие ловушки не мешают", () => {
  const { arena, a, b } = scene();
  a.profileId = "persistent-profile";
  a.level = 501;
  b.y = 1000;
  for (let i = 0; i < 48; i++) {
    a.x = 1000 + i * 100;
    launch(arena, a, i % 2 ? "stone" : "web", 5000 + i * 1000);
  }
  assert.equal(arena.combat.shots.length, 48);
  arena.resetPlayer(a, 60000);
  a.protectedUntil = 0;
  a.level = 501;
  assert.throws(() => launch(arena, a, "web", 63000), /48 ваших ловушек/);
  assert.deepEqual(a.boosterUses, {});
  arena.removePlayer(a.id);
  arena.combat.update(63000);
  const reconnected = arena.addPlayer(63000, "new-connection");
  Object.assign(reconnected, {
    profileId: "persistent-profile",
    x: 1000,
    y: 5000,
    protectedUntil: 0,
  });
  assert.throws(() => launch(arena, reconnected, "stone", 66000), /48 ваших ловушек/);
  launch(arena, b, "web", 66000);
  assert.equal(arena.combat.shots.length, 49);
  // Срабатывание одной из прежних ловушек освобождает место только её владельцу.
  const trap = arena.combat.shots[0];
  assert.equal(trap.landed, true);
  b.x = trap.x;
  b.y = trap.y;
  arena.combat.update(67000);
  assert.equal(arena.combat.shots.length, 48);
  launch(arena, reconnected, "web", 67000);
  assert.equal(arena.combat.shots.length, 49);
  assert.equal(reconnected.boosterUses.web, 1);
  assert.ok(arena.combat.snapshot().every((shot) => !("ownerProfileId" in shot)));
});
