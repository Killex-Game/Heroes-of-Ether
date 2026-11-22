"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const gifts = require("../../src/server/profiles/gift-effects");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const progression = require("../../src/server/progression/experience-progression");
const accrual = require("../../src/server/arena/mass-accrual");
function scene(outgoing = 1, incoming = 1) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  for (const [p, x] of [
    [a, 1000],
    [b, 1600],
  ])
    Object.assign(p, {
      level: 501,
      x,
      y: 5000,
      targetX: x,
      targetY: 5000,
      protectedUntil: 0,
      stopped: true,
      mass: 1000,
      radius: radiusForMass(1000),
      giftModifiers: { xp: 1, speed: 1, outgoing: 1, incoming: 1 },
    });
  a.giftModifiers.outgoing = outgoing;
  b.giftModifiers.incoming = incoming;
  const launch = (id, at = 5000) =>
    arena.prepareBooster(
      a.id,
      { boosterId: id, spawnSerial: a.spawnSerial, aimX: 9000, aimY: 5000 },
      at,
    )();
  const hit = (id) => {
    launch(id);
    const shot = arena.combat.shots.at(-1);
    arena.combat.impact(shot, b, 5000, b);
    return shot;
  };
  return { arena, a, b, launch, hit };
}
test("Подарки: независимые сроки, компенсация и истечение без изменения сохранений", () => {
  const p = {
    social: {
      giftEffects: { clover: 100, skull: 200, swift_boot: 300, ward_shield: 100, black_mark: 100 },
    },
  };
  assert.equal(gifts.modifiers(p, 0).xp, 1);
  assert.equal(gifts.modifiers(p, 0).speed, 1.25);
  assert.equal(gifts.modifiers(p, 0).incoming, 1);
  assert.equal(gifts.modifiers(p, 100).xp, 0.75);
  assert.equal(gifts.modifiers(p, 200).xp, 1);
  assert.equal(gifts.modifiers(p, 300).speed, 1);
  const next = { ...p, social: { giftEffects: { ...p.social.giftEffects, clover: 400 } } };
  assert.equal(gifts.modifiers(next, 300).xp, 1.25);
  assert.equal(p.social.giftEffects.clover, 100);
});
test("Огонь инвентаря использует процент активного питомца, без питомца сохраняет 50%", () => {
  for (const [percent, remaining] of [
    [0, 5000],
    [50, 5000],
    [90, 1000],
  ]) {
    const s = scene();
    Object.assign(s.b, { mass: 10000, radius: radiusForMass(10000) });
    if (percent) s.a.pet = { id: "manya", vitalityMs: 10000, stats: { firePercent: percent } };
    s.hit("fire");
    assert.equal(s.b.mass, remaining);
  }
  const s = scene();
  s.a.pet = { id: "manya", vitalityMs: 0, accessoryPetMs: 0, stats: { firePercent: 90 } };
  s.hit("fire");
  assert.equal(s.b.mass, 500);
});
test("Подарки меняют урон Огня и сопротивление, сохраняя дальность и скорость полёта", () => {
  for (const [outgoing, incoming, remaining] of [
    [1.25, 1, 375],
    [0.75, 1, 625],
    [1, 0.75, 625],
    [1, 1.25, 375],
    [1.25, 0.75, 532],
  ]) {
    const s = scene(outgoing, incoming),
      shot = s.hit("fire");
    assert.equal(s.b.mass, remaining);
    assert.equal(shot.speed, 200);
    assert.equal(shot.maxDistance, 600);
    assert.equal(shot.landsAt - shot.launchedAt, 3000);
  }
  const s = scene(1.25);
  Object.assign(s.b, { mass: 10000, radius: radiusForMass(10000) });
  s.a.pet = { id: "manya", vitalityMs: 1, stats: { firePercent: 70 } };
  s.hit("fire");
  assert.equal(s.b.mass, 1250, "Огонь 70% с Кристаллом сжигает 87,5%");
  const strong = scene(1.25);
  strong.a.pet = { id: "drakosha", vitalityMs: 1, stats: { firePercent: 90 } };
  strong.hit("fire");
  assert.equal(strong.b.dead, true, "полное сгорание не оставляет часть с 2 массы");
});
test("Перчатка проверяет щит при касании, уже полученный толчок сохраняется", () => {
  for (const shield of ["colorful_shield", "sphere", "golden_shield", "clan_shield"]) {
    const s = scene();
    s.b.effects[shield] = 7000;
    s.hit("glove");
    assert.equal(s.arena.combat.pulls.has(s.b.id), false);
    const u = scene();
    u.hit("glove");
    assert.equal(u.arena.combat.pulls.has(u.b.id), true);
    u.b.effects[shield] = 7000;
    const x = u.b.x;
    u.arena.combat.movePull(u.b, 5500);
    assert.equal(u.b.x, x + 400);
    assert.equal(u.arena.combat.pulls.has(u.b.id), false);
  }
});
test("Срок щита истекает между контактом с Перчаткой и концом серверного шага", () => {
  const s = scene();
  s.launch("glove");
  const shot = s.arena.combat.shots[0];
  const radius = require("../../src/server/boosters/booster-catalog").BOOSTER_RULES
    .PROJECTILE_RADIUS;
  Object.assign(shot, { x: s.b.x - s.b.radius - radius - 3, y: s.b.y, dx: 1, dy: 0 });
  s.b.effects.colorful_shield = 5050;
  s.arena.combat.update(5100);
  assert.equal(s.arena.combat.pulls.has(s.b.id), false);
  assert.equal(s.arena.combat.shots.length, 0);
});

for (const shield of ["colorful_shield", "sphere", "golden_shield", "clan_shield"])
  test(`Перчатка: включение ${shield} настоящим действием не обрывает толчок в Arena.step`, () => {
    for (const count of [1, 4, 16]) {
      const { arena, a, b, hit } = scene();
      b.x = b.targetX = 5000;
      if (count > 1) {
        b.parts = Array.from({ length: count }, (_, i) => ({
          id: `target-${i}`, x: 5000, y: 2000 + i * 200,
          mass: 100, radius: radiusForMass(100), vx: 0, vy: 0, mergeAt: 100000,
        }));
        b.mainPartId = "target-0";
        arena.syncParts(b);
      }
      const initial = arena.bodies(b).map(part => ({ x: part.x, y: part.y }));
      hit("glove");
      arena.combat.shots = [];
      arena.step(5100);
      const push = arena.combat.pulls.get(b.id);
      assert.ok(push);
      arena.prepareBooster(b.id, {
        boosterId: shield, spawnSerial: b.spawnSerial, aimX: a.x, aimY: a.y,
      }, 5100)();
      assert.equal(arena.combat.pulls.get(b.id), push, "щит не заменяет импульс");
      for (let at = 5150; at <= 5500; at += 50) {
        arena.step(at);
        assert.equal(arena.bodies(b).length, count);
        arena.bodies(b).forEach((part, i) => {
          const expected = initial[i].x + 400 * (at - 5000) / 500;
          assert.ok(Math.abs(part.x - expected) < 1e-7, `${shield}, ${count}, ${at}: ${part.x} != ${expected}`);
          assert.equal(part.y, initial[i].y);
        });
        assert.ok(arena.hasEffect(b, "shield", at), "щит продолжает действовать");
      }
      assert.equal(arena.combat.pulls.has(b.id), false);
    }
  });
test("Яд и замедление: сила и срок масштабируются, период урона и механика эфира сохраняются", () => {
  const s = scene(1.25, 0.75);
  s.hit("poison");
  const e = s.b.damageTicks[0];
  assert.equal(e.budget, 328); // floor(1000 × 35% × 1.25 × 0.75).
  assert.equal(e.until - e.start, 9375); // 10 seconds, scaled by both gifts.
  s.arena.boosterEffects.tick(s.b, e.until);
  assert.equal(s.b.mass, 672);
  assert.equal(
    s.arena.ether.reduce((sum, o) => sum + o.value, 0),
    49,
  );
  const f = scene(1.25, 0.75);
  f.hit("freeze");
  assert.equal(f.b.effects.freeze - 5000, 9375);
  assert.ok(Math.abs(f.b.effectStrengths.freeze - 0.71875) < 1e-9);
});
test("Положительные бустеры: масса, щит, скорость, яйцо и Торт получают эффект отправителя", () => {
  const s = scene(1.25);
  s.launch("meat");
  assert.equal(s.a.mass, 1875);
  s.launch("colorful_shield", 6000);
  assert.equal(s.a.effects.colorful_shield, 31000);
  s.launch("speed", 8000);
  assert.equal(s.a.effectStrengths.speed, 1.625);
  const egg = scene(1.25);
  egg.launch("easter_egg");
  egg.arena.boosterEffects.tick(egg.a, 17000);
  assert.equal(egg.a.mass, 1372);
  assert.equal(egg.a.effects.easter_egg, 17500);
  const cake = scene(1.25, 1.25);
  cake.hit("cake");
  assert.equal(cake.b.effects.cake, 55000);
  cake.arena.boosterEffects.tick(cake.b, 6000);
  assert.equal(cake.b.mass, 1037, "защита от негативных эффектов не усиливает чужой Торт");
});
test("Опыт подарков: 30-секундные пакеты, компенсация и сгорание незачисленного остатка", () => {
  const store = new ProfileStore(),
    opened = store.open(),
    p = store.find(opened.token);
  p.level = 501;
  p.progress = progression.freshProgress(501);
  p.social = { giftEffects: { clover: 999999 } };
  progression.applyEvent(p, { type: "lifeStarted", lifeId: "life" }, 0);
  const actor = {
    id: "a",
    lifeId: "life",
    mass: 50000,
    account: {},
    giftModifiers: gifts.modifiers(p, 0),
  };
  accrual.reset(actor, 0);
  for (let at = 50; at <= 90000; at += 50) {
    const e = accrual.sample(actor, at);
    if (e) progression.applyEvent(p, e, at);
  }
  assert.equal(p.progress.session.xp, 191);
  assert.equal(p.progress.session.kills, 9);
  for (let at = 90050; at <= 95000; at += 50) assert.equal(accrual.sample(actor, at), null);
  accrual.sample(actor, 95000, true);
  assert.equal(actor.massAccrual.xpUnits, 0);
  assert.equal(p.progress.session.xp, 191);
  for (let i = 0; i < 4; i++)
    progression.applyEvent(p, { type: "absorbed", victimProfileId: "v" + i, gain: 20 }, 95001 + i);
  assert.equal(p.progress.session.xp, 206, "поглощения: четыре раза по 3 опыта с +25%");
  progression.validateProgress(p);
});
