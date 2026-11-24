"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const A = require("../../src/server/arena/accessory-abilities"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  catalog = require("../../public/shared/accessory-catalog");
test("каждый аксессуар имеет работающий бонус или способность; новые ускорения соблюдают предел", () => {
  const passives = require("../../src/server/arena/accessory-passives");
  const supported = new Set(["xp", "massXp", "killXp", "food", "foodRadius", "decayReduction", "lightSpeed", "feedSpeed", "shieldSpeed", "petTime", "freezeReduction", "speed", "positive", "negativeReduction", "attack", "completeKillXp", "spawnMass", "minuteMass", "potionFactor", "halfMinuteMass", "generatorFactor", "fireBlock", "boosterCritical", "shieldResistance"]);
  for (const item of catalog.items) {
    assert.ok(["star_pilot", "velvet_trick"].includes(item.id) || item.ability || Object.values(item.bonus).some(n => n > 0), item.id);
    for (const [stat, value] of Object.entries(item.bonus)) { assert.ok(supported.has(stat), stat); assert.ok(Number.isFinite(value) && value > 0); }
  }
  const p = { id: "test", mass: 100, outfit: { hat: "rabbit_ears", bow: "forge_spark" } };
  assert.equal(passives.speed(p, 0), .25);
  passives.shieldBroken(p, 1, "enemy");
  assert.equal(passives.speed(p, 1), .25);
  assert.equal(passives.speed({ ...p, mass: 5000 }, 1), .25);
  assert.equal(passives.speed(p, 3002), .25);
  assert.equal(passives.petReserve(10000, { hat: "title_sage_hat" }), 1000);
});
function fixture() {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "accessory");
  p.level = 121;
  const profile = {
    outfit: { hat: "rabbit_ears", bow: "carrot_bow" },
    easter: { trophies: [{ collectionVersion: 2 }] },
  };
  A.start(p, profile);
  const message = {
    accessoryId: "carrot_bow",
    spawnSerial: p.spawnSerial,
    requestId: randomUUID(),
  };
  return { arena, p, profile, message };
}
test("надетая заработанная бабочка выдаёт три яйца, пасхальные ушки ускоряют лёгкого игрока", () => {
  const { p, profile } = fixture();
  assert.deepEqual(catalog.item("rabbit_ears").bonus, { speed: 25 });
  assert.equal(catalog.item("rabbit_ears").ability, undefined);
  assert.equal(A.snapshot(p)[0].count, 3);
  for (const outfit of [{ hat: "rabbit_ears" }, {}, { bow: "novice_bow" }]) {
    const q = {};
    A.start(q, { ...profile, outfit });
    assert.deepEqual(A.snapshot(q), []);
  }
  const forged = {};
  A.start(forged, { outfit: profile.outfit });
  assert.deepEqual(A.snapshot(forged), []);
});
test("E использует отдельный запас без лимита обычного слота, повтор не возобновляет эффект", () => {
  const { arena, p, profile, message } = fixture();
  p.boosterUses.easter_egg = 1000;
  assert.equal(A.use(arena, p, message, 0).remaining, 2);
  assert.equal(p.effects.easter_egg, 10000);
  assert.equal(p.boosterUses.easter_egg, 1000);
  assert.equal(p.boostersUsed, 1);
  assert.equal(A.use(arena, p, message, 5000).replay, true);
  assert.equal(p.effects.easter_egg, 10000);
  assert.equal(p.boostersUsed, 1);
  A.start(p, profile);
  assert.equal(A.snapshot(p)[0].count, 2);
  assert.equal(A.use(arena, p, { ...message, requestId: randomUUID() }, 11000).remaining, 1);
  assert.equal(A.use(arena, p, { ...message, requestId: randomUUID() }, 22000).remaining, 0);
  assert.throws(
    () => A.use(arena, p, { ...message, requestId: randomUUID() }, 33000),
    /использован/,
  );
  assert.throws(
    () => A.use(arena, p, { ...message, accessoryId: "rabbit_ears" }, 33000),
    /другого/,
  );
  arena.resetPlayer(p, 34000);
  A.start(p, profile);
  assert.equal(A.snapshot(p)[0].count, 3);
  assert.throws(() => A.use(arena, p, message, 34000), /этой жизни/);
  assert.equal(A.use(arena, p, { ...message, spawnSerial: p.spawnSerial }, 34000).remaining, 2);
});
test("ошибка применения не забирает заряд; каждая часть получает 50 раз в 2 секунды, всего пять раз", () => {
  const { arena, p, message } = fixture();
  arena.gainMass(p, 1000 - p.mass);
  arena.boosterEffects.split(p, arena.mainBody(p), 2, 0);
  p.effects.easter_egg = 1000;
  assert.throws(() => A.use(arena, p, {...message, spawnSerial: 999}, 0), /жизни/);
  assert.equal(A.snapshot(p)[0].count, 3);
  delete p.effects.easter_egg;
  const before = arena.bodies(p).map((b) => b.mass);
  A.use(arena, p, message, 0);
  for (let tick = 1; tick <= 5; tick++) {
    arena.boosterEffects.tick(p, tick * 2000 - 1);
    assert.deepEqual(
      arena.bodies(p).map((b) => b.mass),
      before.map((m) => m + (tick - 1) * 50),
    );
    arena.boosterEffects.tick(p, tick * 2000);
    assert.deepEqual(
      arena.bodies(p).map((b) => b.mass),
      before.map((m) => m + tick * 50),
    );
  }
});
test("мёртвая модель, оставленное тело и поддельный запрос не активируют E", () => {
  const { arena, p, message } = fixture();
  for (const field of ["dead", "isRemnant"]) {
    p[field] = true;
    assert.throws(() => A.use(arena, p, message, 0), /недоступен/);
    p[field] = false;
  }
  assert.throws(() => A.use(arena, p, { ...message, requestId: "?" }, 0), /Некорректный/);
  assert.equal(A.snapshot(p)[0].count, 3);
});
