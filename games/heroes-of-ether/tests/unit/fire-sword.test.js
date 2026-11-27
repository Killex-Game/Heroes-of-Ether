
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS, publicCatalog } = require("../../src/server/boosters/booster-catalog");

function fixture(mass = 1000) {
  const arena = new Arena({ etherCount: 0, world: { width: 4000, height: 4000 } });
  const a = arena.addPlayer(0, "thrower"), b = arena.addPlayer(0, "target");
  for (const [p, x] of [[a, 1000], [b, 1280]])
    Object.assign(p, { x, y: 1000, targetX: 2500, targetY: 1000, level: 121,
      mass, radius: radiusForMass(mass), stopped: true, protectedUntil: 0 });
  return { arena, a, b };
}
function fire(arena, owner, id = "fire_sword", aimX = 3000, aimY = 1000) {
  arena.prepareBooster(owner.id, { boosterId: id, spawnSerial: owner.spawnSerial, aimX, aimY }, 5000)();
  return arena.combat.shots.at(-1);
}

test("Меч в существующем слоте использует полёт Секиры и прежнюю перезарядку", () => {
  const { arena, a } = fixture();
  const sword = BOOSTERS.get("fire_sword"), axe = BOOSTERS.get("axe");
  for (const key of ["flightMs", "flightSpeed", "maxDistance"]) assert.equal(sword[key], axe[key]);
  const visible = publicCatalog().items.find(item => item.id === sword.id);
  assert.equal(visible.name, "Меч");
  assert.match(visible.icon, /\/sword\.webp/);
  fire(arena, a);
  const message = { boosterId: sword.id, spawnSerial: a.spawnSerial, aimX: 3000, aimY: 1000 };
  assert.throws(() => arena.prepareBooster(a.id, message, 5499), /Подожди/);
  arena.prepareBooster(a.id, message, 5500)();
  assert.equal(arena.combat.shots.length, 2);
});

for (const shield of [null, "colorful_shield", "golden_shield", "sphere"])
  test("Меч сохраняет массу и запускает 70% по направлению удара, защита " + shield, () => {
    const { arena, a, b } = fixture(1001);
    if (shield) b.effects[shield] = 12000;
    fire(arena, a);
    arena.combat.update(5700);
    assert.deepEqual(b.parts.map(part => part.mass), [300, 701]);
    assert.ok(b.parts[1].vx > 0 && Math.abs(b.parts[1].vy) < 1e-8);
    assert.equal(b.parts[0].vx, 0);
    assert.equal(b.parts[1].birth.parentId, b.parts[0].id);
    if (shield) assert.equal(b.effects[shield], 12000);
    arena.boosterEffects.tick(b, 18000);
    assert.equal(b.mass, 1001);
    assert.equal(arena.combat.shots.length, 0);
  });

test("Клановый щит возвращает Меч бросившему, разлёт идёт в обратную сторону", () => {
  const { arena, a, b } = fixture();
  b.effects.clan_shield = 15000;
  const shot = fire(arena, a);
  arena.combat.update(5800);
  assert.equal(shot.ownerId, b.id);
  assert.ok(shot.dx < 0);
  assert.equal(b.mass, 1000);
  assert.equal(arena.bodies(b).length, 1);
  arena.combat.update(6500);
  assert.deepEqual(a.parts.map(p => p.mass), [300, 700]);
  assert.ok(a.parts[1].vx < 0);
  assert.equal(arena.combat.shots.length, 0);
});

test("Клановый щит и защита появления не пробиваются при одновременном обычном щите", () => {
  const { arena, a, b } = fixture();
  b.protectedUntil = 5900;
  b.effects.golden_shield = b.effects.clan_shield = 11000;
  fire(arena, a);
  arena.combat.update(5800);
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(arena.bodies(b).length, 1);
});

test("Меч не превышает лимит частей, минимальная масса сохраняется", () => {
  for (const [mass, maxParts, expected] of [[1000,1,[1000]], [3,16,[3]], [4,16,[2,2]], [7,16,[2,5]]]) {
    const { arena, a, b } = fixture(mass);
    arena.maxParts = maxParts;
    fire(arena, a);
    arena.combat.update(6800);
    assert.deepEqual(arena.bodies(b).map(p => p.mass), expected);
  }
});

test("Деление пробелом поперёк летящей Секиры бота срабатывает в такте прыжка", () => {
  const { arena, a, b } = fixture(1000);
  a.isTestBot = true;
  b.nextMassDecayAt = 10000;
  assert.equal(arena.splitPlayer(b, { sequence: 1, spawnSerial: b.spawnSerial }, 5000), true);
  const child = b.parts[1];
  const endX = child.x + 18, endY = child.y - child.radius - 9.4;
  a.x = endX; a.y = endY - a.radius - 20;
  const shot = fire(arena, a, "axe", endX, endY + 200);
  assert.ok(Math.hypot(endX - child.x, endY - child.y) > child.radius + 10);
  const before = b.mass;
  arena.step(5050);
  assert.ok(!arena.combat.shots.includes(shot));
  assert.equal(b.parts.length, 5);
  assert.equal(b.mass, before);
});

test("Летящая Секира продолжает путь после поглощения бросившего бота", () => {
  const { arena, a, b } = fixture();
  fire(arena, a, "axe");
  a.dead = true;
  arena.combat.update(5800);
  assert.equal(arena.bodies(b).length, 4);
  assert.equal(b.mass, 1000);
});

test("У границы все направленные бустеры отражаются с сохранением пути и срока", () => {
  for (const item of BOOSTERS.values()) {
    if (item.target !== "direction") continue;
    const { arena, a, b } = fixture();
    b.y = 2300; a.x = 3940;
    const aimX = item.id === "mine" ? 0 : 4000;
    const shot = fire(arena, a, item.id, aimX);
    // Centre of a fan, or the single shot. Keep clear of the thrower's body while testing walls.
    const central = arena.combat.shots[Math.floor(arena.combat.shots.length / 2)];
    a.x = 1000;
    const { landsAt, speed, x } = central;
    assert.ok(central.dx > 0.99, item.id);
    arena.combat.update(5050);
    assert.ok(central.dx < 0, item.id);
    assert.ok(Math.abs(central.x - (8000 - x - speed * 0.05)) < 1e-7, item.id);
    assert.equal(central.landsAt, landsAt);
    assert.equal(shot.ownerId, a.id);
  }
});

test("Угол отражает обе координаты, последующее попадание возможно в том же такте", () => {
  const {arena, a, b} = fixture(20);
  a.x = a.y = 3970;
  const shot = fire(arena, a, "freeze", 4000, 4000);
  a.x = a.y = 1000;
  b.x = b.y = 3920;
  arena.combat.update(5800);
  assert.ok(shot.dx < 0 && shot.dy < 0);
  assert.equal(b.effects.freeze, 15800);
});
