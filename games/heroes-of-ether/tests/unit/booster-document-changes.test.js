"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const { appearance } = require("../../public/shared/projectile-renderer");

function scene(mass = 100) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  for (const [p, x] of [
    [a, 1000],
    [b, 1160],
  ])
    Object.assign(p, {
      x,
      y: 5000,
      targetX: x,
      targetY: 5000,
      stopped: true,
      protectedUntil: 0,
      mass,
      radius: radiusForMass(mass),
      level: 501,
    });
  return { arena, a, b };
}
function use(arena, p, id, now = 5000) {
  arena.prepareBooster(
    p.id,
    { boosterId: id, spawnSerial: p.spawnSerial, aimX: id === "mine" ? 0 : 9000, aimY: 5000 },
    now,
  )();
}
function hit(arena, a, b, id, now = 5000) {
  return arena.combat.impact(
    {
      boosterId: id,
      ownerId: a.id,
      ownerLife: a.lifeId,
      launchedAt: 4000,
      x: b.x,
      y: b.y,
      dx: 1,
      dy: 0,
      landed: false,
    },
    b,
    now,
  );
}

test("Заморозка держится 10 секунд после попадания, даже после времени полёта", () => {
  const { arena, a, b } = scene();
  b.x = 1260;
  use(arena, a, "freeze");
  assert.equal(arena.combat.shots[0].landsAt, 10000);
  arena.combat.update(5500);
  assert.equal(b.effects.freeze, undefined);
  arena.combat.update(6000);
  assert.equal(b.effects.freeze, 16000);
  assert.equal(arena.hasEffect(b, "slow", 15999), true);
  assert.equal(arena.hasEffect(b, "slow", 16000), false);
});

for (const id of ["web", "mine"])
  test(id + ": срабатывает в полёте до приземления", () => {
    const { arena, a, b } = scene();
    use(arena, a, id);
    assert.equal(arena.combat.shots[0].landsAt, 6000);
    arena.combat.update(5800);
    assert.equal(arena.combat.shots.length, 0);
    if (id === "web") assert.equal(b.effects.web, 12800);
    else {
      assert.equal(b.parts.length, 8);
      assert.equal(b.mass, 100);
    }
  });

test("Камень срабатывает в полёте, Паутина и Камень действуют параллельно без сложения времени", () => {
  const { arena, a, b } = scene();
  use(arena, a, "stone");
  arena.combat.update(5500);
  assert.equal(b.effects.stone, 15500);
  assert.equal(arena.combat.shots.length, 0);
  delete b.effects.stone;
  hit(arena, a, b, "web", 6000);
  hit(arena, a, b, "stone", 6500);
  hit(arena, a, b, "web", 7000);
  assert.equal(b.effects.stone, 16500);
  assert.equal(b.effects.web, 14000);
  assert.equal(arena.hasEffect(b, "root", 16499), true);
  assert.equal(arena.hasEffect(b, "root", 16500), false);
});

test("Ракета делит 20 на 16/2/2, не создаёт части ниже минимума и не действует на 19", () => {
  for (const mass of [19, 20]) {
    const { arena, a, b } = scene(mass);
    hit(arena, a, b, "rocket");
    assert.equal(b.mass, mass);
    if (mass === 19) assert.equal(b.parts, null);
    else
      assert.deepEqual(
        b.parts.map((p) => p.mass),
        [16, 2, 2],
      );
  }
});

test("Огонь уничтожает массу до 50 включительно, без награды за поглощение", () => {
  for (const mass of [49, 50, 51, 299]) {
    const { arena, a, b } = scene(mass);
    hit(arena, a, b, "fire");
    if (mass <= 50) assert.equal(b.dead, true);
    else {
      assert.equal(b.dead, false);
      assert.equal(b.mass, Math.ceil(mass / 2));
    }
    assert.equal(a.mass, mass);
    assert.ok(arena.combatEvents.every((e) => e.type === "burned"));
  }
});

test("Торт растит на 3% текущей массы и сохраняет дробный остаток", () => {
  const { arena, a, b } = scene(1000);
  hit(arena, a, b, "cake");
  arena.boosterEffects.tick(b, 6000);
  assert.equal(b.mass, 1030);
  arena.boosterEffects.tick(b, 7000);
  assert.equal(b.mass, 1060);
  assert.ok(Math.abs(b.cakeRemainder - 0.9) < 1e-8);
});

test("Вихрь активируется без направления, следует за владельцем и работает 10 секунд", () => {
  const { arena, a, b } = scene();
  b.x = 1200;
  arena.ether = [{ id: "orb", x: 1150, y: 5000, value: 5 }];
  arena.prepareBooster(a.id, { boosterId: "vortex", spawnSerial: a.spawnSerial }, 5000)();
  const shot = arena.combat.snapshot()[0];
  assert.equal(BOOSTERS.get("vortex").target, "self");
  assert.equal(shot.landed, true);
  assert.equal(shot.x, 1000);
  assert.equal(
    shot.areaRadius,
    require("../../src/server/arena/projectile-combat").vortexRadius(a),
  );
  assert.equal(shot.ownerId, a.id);
  assert.equal(shot.followPart, true);
  const timing = require("../../public/shared/booster-cooldowns");
  const displayed = (at) => arena.snapshot(at).players.find((p) => p.id === a.id);
  assert.deepEqual(displayed(5000).effects, [{ id: "vortex", remainingMs: 10000 }]);
  assert.equal(timing.cooldown(BOOSTERS.get("vortex"), displayed(5000), 1000).ms, 9000);
  assert.equal(timing.label(timing.cooldown(BOOSTERS.get("vortex"), displayed(14000)).ms), "1");
  assert.equal(timing.cooldown(BOOSTERS.get("vortex"), displayed(15000)).ms, 0);
  a.x = 2000;
  arena.ether.push({ id: "near-owner", x: 2150, y: 5000, value: 5 });
  arena.combat.update(6000);
  assert.equal(b.x, 1200);
  assert.equal(arena.ether[0].x, 1150);
  assert.equal(arena.ether[1].x, 2050);
  assert.equal(arena.combat.shots[0].x, 2000);
  // Movement after combat must also be reflected in the network snapshot.
  a.x = 3000;
  assert.equal(arena.combat.snapshot()[0].x, 3000);
  arena.combat.update(14999);
  assert.equal(arena.combat.shots.length, 1);
  arena.combat.update(15000);
  assert.equal(arena.combat.shots.length, 0);
});

test("Вихрь заканчивается со смертью, выходом или сменой жизни владельца", () => {
  for (const end of ["death", "leave", "respawn"]) {
    const { arena, a, b } = scene();
    use(arena, a, "vortex");
    const before = b.x;
    if (end === "death") a.dead = true;
    if (end === "leave") arena.removePlayer(a.id);
    if (end === "respawn") arena.resetPlayer(a, 5500);
    assert.equal(arena.combat.snapshot().length, 0, end);
    arena.combat.update(6000);
    assert.equal(arena.combat.shots.length, 0, end);
    assert.equal(b.x, before, end);
  }
});

test("Вихрь следует за каждой частью владельца и не переносится на другого игрока", () => {
  const { arena, a, b } = scene();
  a.parts = [
    { id: a.mainPartId, x: 1000, y: 5000, mass: 100, radius: radiusForMass(100) },
    { id: "second", x: 1400, y: 5000, mass: 300, radius: radiusForMass(300) },
  ];
  arena.syncParts(a);
  a.effects.sphere = 20000;
  b.x = 1500;
  use(arena, a, "vortex");
  assert.deepEqual(
    arena.combat.snapshot().map((s) => s.x),
    [1000, 1400],
  );
  for (const part of a.parts) part.x += 300;
  arena.syncParts(a);
  arena.combat.update(6000);
  assert.deepEqual(
    arena.combat.snapshot().map((s) => s.x),
    [1300, 1700],
  );
  assert.equal(b.x, 1600); // Захват передаётся от меньшей части к более крупной.
});

test("Указанные в документе снаряды вращаются как Торт, остановка и reduced motion отключают вращение", () => {
  for (const boosterId of [
    "cake",
    "freeze",
    "web",
    "mine",
    "lock",
    "axe",
    "stone",
    "poison",
    "mega_poison",
  ]) {
    const shot = { boosterId, spinMs: 900, heading: 0, landed: false };
    assert.equal(appearance(shot, 1).rotation, Math.PI / 2, boosterId);
    assert.equal(appearance({ ...shot, landed: true }, 1).rotation, 0);
    assert.notEqual(appearance(shot, 1, true).rotation, Math.PI / 2);
  }
});

for (const [id, fraction, duration] of [
  ["poison", 0.35, 10000],
  ["mega_poison", 0.5, 15000],
]) {
  test(
    id + ": точный урон за заданный срок, интервалы 1,5 с и 15% потери превращается в еду",
    () => {
      const { arena, a, b } = scene(1000);
      hit(arena, a, b, id);
      arena.boosterEffects.tick(b, 6499);
      assert.equal(b.mass, 1000);
      arena.boosterEffects.tick(b, 6500);
      assert.equal(b.mass, 1000 - Math.floor((1000 * fraction * 1500) / duration));
      const lastTick = (Math.ceil(duration / 1500) - 1) * 1500;
      arena.boosterEffects.tick(b, 5000 + duration - 1);
      assert.equal(b.mass, 1000 - Math.floor((1000 * fraction * lastTick) / duration));
      arena.boosterEffects.tick(b, 5000 + duration);
      assert.equal(b.mass, 1000 * (1 - fraction));
      assert.equal(
        arena.ether.reduce((sum, orb) => sum + orb.value, 0),
        Math.floor(1000 * fraction * 0.15),
      );
      assert.ok(arena.ether.every((orb) => orb.ejected && orb.value > 0 && orb.value <= 5));
      arena.boosterEffects.tick(b, 90000);
      assert.equal(
        arena.ether.reduce((sum, orb) => sum + orb.value, 0),
        Math.floor(1000 * fraction * 0.15),
      );
    },
  );
}

test("Замена яда не дублирует урон или еду, минимум массы не превращается в лишнюю еду", () => {
  const { arena, a, b } = scene(1000);
  hit(arena, a, b, "mega_poison");
  arena.boosterEffects.tick(b, 6500);
  assert.equal(b.mass, 950);
  hit(arena, a, b, "poison", 6500);
  arena.boosterEffects.tick(b, 26500);
  assert.equal(b.mass, 618);
  assert.equal(
    arena.ether.reduce((sum, orb) => sum + orb.value, 0),
    57,
  );
  b.mass = 2;
  b.radius = radiusForMass(2);
  hit(arena, a, b, "mega_poison", 30000);
  arena.boosterEffects.tick(b, 50000);
  assert.equal(b.mass, 2);
  assert.equal(
    arena.ether.reduce((sum, orb) => sum + orb.value, 0),
    57,
  );
});

test("Ядовитая еда ограничена по числу частиц без потери выброшенной массы", () => {
  const { arena, a, b } = scene(1000);
  arena.ether = Array.from({ length: 1024 }, (_, i) => ({
    id: String(i),
    ejected: true,
    value: 1,
    x: 500,
    y: 5000,
    expiresAt: 60000,
  }));
  hit(arena, a, b, "poison");
  arena.boosterEffects.tick(b, 25000);
  assert.equal(arena.ether.length, 1024);
  assert.equal(
    arena.ether.reduce((sum, orb) => sum + orb.value, 0),
    1076,
  );
});

test("Золотой щит ускоряет ровно на 20% и теряет бонус при смене щита", () => {
  const { arena, a, b } = scene();
  a.y = a.targetY = 1000;
  use(arena, b, "golden_shield");
  for (const p of [a, b])
    Object.assign(p, { targetX: p.x + 500, lastMoveAt: 6000, stopped: false });
  const ax = a.x,
    bx = b.x;
  arena.step(6050);
  assert.ok(Math.abs((b.x - bx) / (a.x - ax) - 1.2) < 1e-8);
  use(arena, b, "sphere", 6100);
  assert.equal(b.effects.golden_shield, undefined);
  assert.equal(b.effects.sphere, 36100);
});

test("Дальность ограничивает путь независимо от максимального времени полёта", () => {
  for (const [id, distance, speed] of [
    ["rocket", 400, 200],
    ["poison", 250, 160],
    ["warheads", 400, 200],
    ["fire", 600, 200],
    ["awl", 400, 200],
  ]) {
    const { arena, a, b } = scene(10);
    b.y = 9000;
    use(arena, a, id);
    const shot = arena.combat.shots[0],
      origin = { x: shot.x, y: shot.y };
    const end = 5000 + (distance / speed) * 1000;
    arena.combat.update(end - 1);
    assert.ok(arena.combat.shots.length > 0, id);
    arena.combat.update(end + 1);
    assert.equal(arena.combat.shots.length, 0, id);
    assert.ok(Math.abs(Math.hypot(shot.x - origin.x, shot.y - origin.y) - distance) < 1e-7, id);
  }
});

test("Гарпун при попадании и промахе даёт полный рывок, точка контакта задаёт направление", () => {
  for (const mode of ["miss", "hit", "shield"]) {
    const { arena, a, b } = scene(10);
    b.x = mode === "miss" ? 5000 : 1200;
    if (mode === "shield") b.effects.sphere = 15000;
    use(arena, a, "harpoon");
    const shot = arena.combat.shots[0],
      start = a.x;
    arena.combat.update(7100);
    assert.equal(arena.combat.shots.length, 0);
    arena.combat.movePull(a, 8100);
    assert.ok(Math.abs(a.x - start - 612) < 1e-8);
  }
});

test("Боеголовки сохраняют массу при исключении 10 → 6/2/2", () => {
  const { arena, a, b } = scene(10);
  hit(arena, a, b, "warheads");
  assert.deepEqual(
    b.parts.map((p) => p.mass),
    [6, 2, 2],
  );
  assert.equal(b.mass, 10);
});

test("Меч наносит 20% за секунду, складывает отдельные удары и повторяет контакт раз в 2 с", () => {
  const { arena, a, b } = scene(1000);
  b.x = a.x + a.radius + 80;
  a.targetX = 9000;
  use(arena, a, "fire_sword");
  arena.combat.updateSwords(5000);
  arena.boosterEffects.tick(b, 5500);
  assert.equal(b.mass, 900);
  arena.combat.updateSwords(5500);
  assert.equal(b.swordBurns.length, 1);
  arena.boosterEffects.tick(b, 6000);
  assert.equal(b.mass, 800);
  arena.combat.updateSwords(6999);
  assert.equal(b.swordBurns.length, 0);
  arena.combat.updateSwords(7000);
  assert.equal(b.swordBurns.length, 1);
  arena.boosterEffects.tick(b, 8000);
  assert.equal(b.mass, 640);
  const separate = scene(1000);
  hit(separate.arena, separate.a, separate.b, "fire_sword");
  hit(separate.arena, separate.a, separate.b, "fire_sword");
  separate.arena.boosterEffects.tick(separate.b, 6000);
  assert.equal(separate.b.mass, 600);
});

test("Клановый щит поглощает лежащую ловушку без нового полёта", () => {
  const { arena, a, b } = scene(10);
  b.x = 1250;
  a.effects.clan_shield = b.effects.clan_shield = 30000;
  use(arena, a, "mine");
  const shot = arena.combat.shots[0];
  shot.x = 1250;
  shot.y = 5000;
  shot.landed = true;
  shot.landsAt = shot.lastAt = 5000;
  arena.combat.update(6000);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(shot.ownerId, a.id);
  assert.equal(shot.landed, true);
  assert.equal(shot.landsAt, 5000);
  assert.equal(a.parts, null);
  assert.equal(b.parts, null);
});

test("Кастет одним попаданием делит всю цель, исчезает и не переходит к соседу", () => {
  const { arena, a, b } = scene(1600);
  const c = arena.addPlayer(0, "c");
  Object.assign(c, { x: 1500, y: 5000, mass: 100, radius: radiusForMass(100), protectedUntil: 0 });
  use(arena, a, "knuckles");
  for (let at = 5050; !b.parts && at < 9000; at += 50) arena.combat.update(at);
  assert.equal(b.parts.length, 16);
  assert.equal(b.mass, 1600);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(c.parts, null);
  assert.equal(b.effects.knuckles, undefined);
  arena.combat.update(20000);
  assert.equal(c.parts, null);
});
for (const shield of ["colorful_shield", "sphere", "golden_shield", "clan_shield", "spawn"]) {
  test("Кастет отражается без наведения: " + shield, () => {
    const { arena, a, b } = scene(101);
    const c = arena.addPlayer(0, "c");
    Object.assign(c, {
      x: b.x + 20,
      y: b.y + 140,
      mass: 101,
      radius: radiusForMass(101),
      protectedUntil: 0,
    });
    if (shield === "spawn") b.protectedUntil = 30000;
    else b.effects[shield] = 30000;
    use(arena, a, "knuckles");
    const shot = arena.combat.shots[0];
    let at = 5000;
    while (at < 9000 && !shot.ricochetUntil) arena.combat.update((at += 50));
    const deadline = at + 15000;
    assert.equal(shot.landsAt, deadline);
    assert.equal(shot.ownerId, a.id);
    assert.ok(shot.dx < 0);
    assert.equal(shot.dy, 0);
    assert.equal(b.parts, null);
    assert.equal(shot.route, undefined);
    assert.equal(shot.knuckleTargetId, undefined);
    a.y += 500; // Let the reflection pass freely, without hitting the thrower.
    for (let i = 0; i < 10; i++) {
      arena.combat.update((at += 50));
      assert.equal(shot.dy, 0);
      assert.equal(shot.landsAt, deadline);
    }
    assert.equal(c.parts, null);
    arena.combat.update(deadline);
    assert.equal(arena.combat.shots.length, 0);
  });
}
test("Одновременное касание двух игроков выбирает только одного детерминированно", () => {
  const { arena, a, b } = scene(100);
  const c = arena.addPlayer(0, "c");
  Object.assign(c, { x: b.x, y: b.y, mass: b.mass, radius: b.radius, protectedUntil: 0 });
  use(arena, a, "knuckles");
  for (let at = 5050; !b.parts && at < 9000; at += 50) arena.combat.update(at);
  assert.equal(b.parts.length, 16);
  assert.equal(c.parts, null);
  assert.equal(arena.combat.shots.length, 0);
});
test("Попадание в одну часть делит и остальные части цели до общего лимита", () => {
  const { arena, a, b } = scene(100);
  b.parts = [-25, 25, 200].map((dy, i) => ({
    id: "part" + i,
    x: b.x,
    y: b.y + dy,
    mass: 100,
    radius: radiusForMass(100),
    vx: 0,
    vy: 0,
  }));
  arena.syncParts(b);
  use(arena, a, "knuckles");
  for (let at = 5050; b.parts.length === 3 && at < 9000; at += 50) arena.combat.update(at);
  assert.equal(b.parts.length, 16);
  assert.equal(b.mass, 300);
  assert.ok(b.parts.every((p) => p.mass >= 2));
  assert.equal(arena.combat.shots.length, 0);
});
test("Кастет между двумя щитами отражается многократно и исчезает в исходный срок", () => {
  const { arena, a, b } = scene();
  a.x = 700;
  b.x = 1000;
  b.effects.colorful_shield = 30000;
  use(arena, a, "knuckles");
  const shot = arena.combat.shots[0];
  let at = 5000;
  while (!shot.ricochetUntil && at < 9000) arena.combat.update((at += 50));
  const deadline = at + 15000;
  const c = arena.addPlayer(0, "c");
  Object.assign(c, { x: shot.x - 140, y: shot.y, protectedUntil: 0 });
  c.effects.clan_shield = 30000;
  while (at < deadline - 50) {
    arena.combat.update((at += 50));
    assert.equal(arena.combat.shots[0], shot);
    assert.equal(shot.ownerId, a.id);
    assert.equal(shot.landsAt, deadline);
  }
  assert.ok(arena.audioEvents.filter((e) => e.targetId === c.id).length >= 2);
  assert.ok(arena.audioEvents.filter((e) => e.targetId === b.id).length >= 2);
  assert.ok(!b.parts && !c.parts);
  arena.combat.update(deadline);
  assert.equal(arena.combat.shots.length, 0);
});
