/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Motion, Renderer, appearance } = require("../../public/shared/projectile-renderer"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const petRules = require("../../public/shared/pet-rules");

test("Питомцевые снаряды загружаются в Canvas, Q использует изображение и поворот обычного огня", () => {
  const OriginalImage = global.Image;
  global.Image = class {
    set src(url) {
      this.url = url;
    }
  };
  try {
    const renderer = new Renderer();
    renderer.setCatalog([...BOOSTERS.values(), ...Object.values(petRules.abilities)]);
    for (const ability of ["fire", "claw", "glove"]) {
      const { id, icon } = petRules.abilities[ability];
      assert.equal(renderer.icons.get(id), icon);
      assert.ok(renderer.images.has(icon));
    }
    assert.equal(renderer.icons.get("pet_fire"), renderer.icons.get("fire"));
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      assert.deepEqual(
        appearance({ boosterId: "pet_fire", heading }, 1),
        appearance({ boosterId: "fire", heading }, 1),
      );
    }
  } finally {
    global.Image = OriginalImage;
  }
});
const shot = (extra = {}) => ({
  id: "shot",
  boosterId: "rocket",
  x: 100,
  y: 100,
  dx: 1,
  dy: 0,
  landed: false,
  moving: true,
  ...extra,
});

test("Вихрь рисует зону у сглаженного центра, без большой иконки над статусами", () => {
  const renderer = new Renderer(),
    positions = [],
    radii = [];
  const ctx = {
    save() {},
    restore() {},
    rotate() {},
    beginPath() {},
    stroke() {},
    fill() {},
    drawImage() {
      assert.fail("большая иконка Вихря не должна рисоваться");
    },
    translate(x, y) {
      positions.push([x, y]);
    },
    arc(x, y, r) {
      radii.push(r);
    },
  };
  renderer.icons.set("vortex", "vortex.png");
  renderer.images.set("vortex.png", { complete: true, naturalWidth: 64 });
  renderer.sync(
    [
      shot({
        boosterId: "vortex",
        ownerId: "owner",
        followOwner: true,
        landed: true,
        areaRadius: 250,
      }),
    ],
    0,
  );
  const options = {
    now: 50,
    scale: 1,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1000,
    ownerFor: (id) => (id === "owner" ? { x: 650, y: 450 } : null),
  };
  renderer.draw(ctx, options);
  assert.deepEqual(positions, [[650, 450]]);
  assert.ok(radii.includes(250));
  renderer.draw(ctx, { ...options, ownerFor: () => null });
  assert.equal(positions.length, 1);
});

test("Обычный и питомцевый Огонь развёрнуты на 180 градусов во всех направлениях", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const oldAngle = heading + Math.PI / 2;
    for (const boosterId of ["fire", "pet_fire"]) {
      const current = appearance({ boosterId, heading }, 1).rotation;
      assert.ok(Math.abs(Math.cos(current - oldAngle) + 1) < 1e-10);
    }
  }
});

test("Полёт плавный между серверными координатами, без предсказания попаданий", () => {
  const motion = new Motion();
  motion.sync([shot()], 0);
  motion.sync([shot({ x: 110 })], 50);
  assert.equal(motion.values(50)[0].x, 100);
  assert.equal(motion.values(75)[0].x, 105);
  assert.equal(motion.values(100)[0].x, 110);
  assert.equal(motion.values(500)[0].x, 110);
  motion.sync([], 501);
  assert.equal(motion.values(501).length, 0);
});

test("Зоны Вихря следуют за отдельными сглаженными частями; исчезновение части убирает её зону", () => {
  const renderer = new Renderer(),
    positions = [],
    radii = [];
  const ctx = {
    save() {},
    restore() {},
    rotate() {},
    beginPath() {},
    stroke() {},
    fill() {},
    translate(x, y) {
      positions.push([x, y]);
    },
    arc(x, y, radius) {
      radii.push(radius);
    },
  };
  renderer.sync(
    ["small", "large"].map((id, i) =>
      shot({
        id,
        boosterId: "vortex",
        ownerId: "owner",
        partId: id,
        followPart: true,
        landed: true,
        areaRadius: i ? 320 : 140,
      }),
    ),
    0,
  );
  const parts = new Map([
    ["small", { x: 150, y: 250 }],
    ["large", { x: 650, y: 450 }],
  ]);
  const options = {
    now: 50,
    scale: 1,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1000,
    bodyFor: (owner, id) => (owner === "owner" ? parts.get(id) : null),
  };
  renderer.draw(ctx, options);
  assert.deepEqual(positions, [
    [150, 250],
    [650, 450],
  ]);
  assert.ok(radii.includes(140) && radii.includes(320));
  parts.delete("small");
  positions.length = 0;
  renderer.draw(ctx, options);
  assert.deepEqual(positions, [[650, 450]]);
});

test("Даже небольшой поворот маршрута не срезает угол сквозь шар", () => {
  const motion = new Motion();
  motion.sync([shot({ motionVersion: 0 })], 0);
  motion.sync([shot({ x: 110, motionVersion: 0 })], 50);
  motion.sync([shot({ x: 115, y: 102, dy: 0.2, motionVersion: 1 })], 75);
  assert.equal(motion.values(75)[0].x, 115);
  assert.equal(motion.values(75)[0].y, 102);
});

test("Поворот отражённого снаряда, остановка у стены и приземление сохраняют положение", () => {
  const motion = new Motion();
  motion.sync([shot()], 0);
  motion.sync([shot({ x: 110 })], 50);
  motion.sync([shot({ x: 114, dx: -1 })], 75);
  assert.equal(motion.values(75)[0].x, 114);
  assert.equal(motion.values(75)[0].heading, Math.PI);
  motion.sync([shot({ x: 0, dx: -1, moving: false })], 100);
  assert.equal(motion.values(100)[0].x, 0);
  motion.sync([shot({ x: 0, dx: -1, landed: true, moving: false })], 150);
  assert.equal(appearance(motion.values(150)[0], 1).rotation, 0);
  motion.clear();
  assert.equal(motion.values(200).length, 0);
});

test("Веер имеет отдельные траектории, повторное чтение кадра не двигает снаряд", () => {
  const motion = new Motion(),
    shots = Array.from({ length: 7 }, (_, i) => shot({ id: String(i), dy: (i - 3) * 0.1 }));
  motion.sync(shots, 0);
  motion.sync(
    shots.map((s, i) => ({ ...s, x: 110, y: 100 + i })),
    50,
  );
  const frame = motion.values(75);
  assert.equal(frame.length, 7);
  assert.equal(new Set(frame.map((s) => s.heading)).size, 7);
  for (let i = 0; i < 144; i++) motion.values(i);
  assert.deepEqual(motion.values(75), frame);
  assert.ok(frame.every((s) => s.x === 105 && s.y >= 100 && s.y <= 103));
});

test("Миниатюры читаемы при отдалении, направленные предметы поворачиваются, зелья остаются вертикальными", () => {
  for (const scale of [0.25, 0.5, 1, 2]) {
    const flight = appearance(shot({ heading: 0 }), scale),
      land = appearance(shot({ heading: 0, landed: true }), scale);
    assert.ok(flight.size * scale >= 22 && flight.size * scale <= 38);
    assert.ok(land.size * scale >= 30 && land.size * scale <= 48);
    assert.equal(flight.rotation, Math.PI / 4);
    assert.equal(appearance(shot({ boosterId: "poison", heading: Math.PI }), scale).rotation, 0);
  }
});

test("Сервер передаёт направление каждого запускаемого бустера и состояние движения без данных владельца", () => {
  for (const booster of BOOSTERS.values())
    if (booster.target === "direction" && booster.kind !== "sword") {
      const arena = new Arena({ etherCount: 0 }),
        p = arena.addPlayer(0, "a");
      Object.assign(p, { x: 800, y: 800, protectedUntil: 0 });
      arena.combat.prepare(p, booster, { aimX: 1100, aimY: 1200 }, 5000)();
      const packets = arena.combat.snapshot();
      assert.equal(packets.length, booster.fan || 1);
      for (const packet of packets) {
        assert.ok(Math.abs(Math.hypot(packet.dx, packet.dy) - 1) < 1e-10);
        assert.equal(packet.moving, true);
        assert.equal(packet.landed, false);
        assert.equal("ownerProfileId" in packet, false);
        assert.equal("ownerLife" in packet, false);
      }
      arena.combat.shots[0].boundary = true;
      assert.equal(arena.combat.snapshot()[0].moving, false);
      arena.combat.shots[0].landed = true;
      assert.equal(arena.combat.snapshot()[0].moving, false);
    }
});

test("После отражения направление в снимке сервера меняется сразу", () => {
  const arena = new Arena({ etherCount: 0 }),
    a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  Object.assign(a, { x: 800, y: 800, protectedUntil: 0 });
  Object.assign(b, { x: 1000, y: 800, protectedUntil: 0 });
  b.effects.clan_shield = 35000;
  arena.combat.prepare(a, BOOSTERS.get("rocket"), { aimX: 1400, aimY: 800 }, 5000)();
  const shot = arena.combat.shots[0];
  shot.x = 950;
  assert.equal(arena.combat.impact(shot, b, 6000), "reflected");
  const packet = arena.combat.snapshot()[0];
  assert.equal(packet.dx, -1);
  assert.equal(packet.dy, 0);
  assert.equal(packet.moving, true);
});
