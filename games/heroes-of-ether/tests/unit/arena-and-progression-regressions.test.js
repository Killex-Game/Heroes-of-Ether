/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { Arena, radiusForMass, canAbsorb } = require("../../src/server/arena/arena-simulation"),
  { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  progress = require("../../src/server/progression/experience-progression"),
  extra = require("../../src/server/progression/activity-achievements"),
  details = require("../../src/server/profiles/profile-validation");
function profile() {
  const store = new ProfileStore(),
    user = store.open();
  return { store, user, p: store.find(user.token) };
}
function scene() {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  for (const p of [a, b])
    Object.assign(p, {
      x: 2000,
      y: 2000,
      targetX: 9000,
      targetY: 2000,
      mass: 1000,
      radius: radiusForMass(1000),
      protectedUntil: 0,
    });
  return { arena, a, b };
}
test("Меч удерживается 5 секунд, следует курсору и крупнейшей части, не летит", () => {
  const { arena, a } = scene();
  arena.combat.prepare(a, BOOSTERS.get("fire_sword"), { aimX: 9000, aimY: 2000 }, 5000)();
  assert.equal(arena.combat.shots.length, 0);
  assert.equal(arena.combat.snapshot()[0].held, true);
  const r = radiusForMass(1000);
  assert.ok(arena.combat.snapshot()[0].x > a.x + r);
  a.targetX = 2000;
  a.targetY = 9000;
  arena.combat.update(5100);
  assert.equal(arena.combat.snapshot()[0].dx, 0);
  assert.equal(arena.combat.snapshot()[0].dy, 1);
  a.parts = [
    { id: "part1", mass: 100, radius: radiusForMass(100), x: 2000, y: 2000 },
    { id: "part2", mass: 2000, radius: radiusForMass(2000), x: 4000, y: 4000 },
  ];
  arena.syncParts(a);
  arena.combat.update(9999);
  assert.equal(arena.combat.snapshot()[0].partId, "part2");
  arena.combat.update(10000);
  assert.equal(arena.combat.snapshot().length, 0);
});
test("Непрерывное касание мечом ждёт повторного удара; щит и смерть работают", () => {
  const { arena, a, b } = scene();
  b.x = a.x + a.radius + 80;
  arena.combat.prepare(a, BOOSTERS.get("fire_sword"), { aimX: 9000, aimY: 2000 }, 5000)();
  b.effects.golden_shield = 6000;
  arena.combat.update(5500);
  assert.equal(b.swordBurns.length, 0);
  arena.combat.update(6001);
  assert.equal(b.swordBurns.length, 1);
  arena.combat.update(6100);
  assert.equal(b.swordBurns[0].until, 7001);
  a.dead = true;
  arena.combat.update(6200);
  assert.equal(arena.combat.snapshot().length, 0);
});
test("Размер и глубина поглощения применяются к полному кругу каждой части", () => {
  for (const [larger, smaller] of [
    [10, 2],
    [50, 10],
    [1000, 500],
    [25000, 15000],
    [34000, 20000],
  ]) {
    const a = { id: "a", mass: larger, radius: radiusForMass(larger), x: 0, y: 0 },
      b = { id: "b", mass: smaller, radius: radiusForMass(smaller), x: 0, y: 0 };
    const distance = a.radius - b.radius / 3;
    b.x = distance - 0.001;
    assert.equal(canAbsorb(a, b, 5000), true);
    b.x = distance + 0.001;
    assert.equal(canAbsorb(a, b, 5000), false);
    b.x = 0;
    a.mass = smaller;
    a.radius = b.radius;
    assert.equal(canAbsorb(a, b, 5000), false);
  }
});
test("Следующая степень требует полный новый порог; Карьера сохраняет общий счёт", () => {
  const { p } = profile();
  p.progress.absorptionKills = 50;
  progress.applyEvent(p, { type: "massPeak", mass: p.progress.maxMass }, Date.now());
  assert.equal(p.progress.claimed.king, 1);
  let king = () => progress.publicProgress(p).achievements.find((a) => a.id === "king");
  assert.equal(king().value, 0);
  p.progress.absorptionKills = 199;
  progress.applyEvent(p, { type: "massPeak", mass: p.progress.maxMass }, Date.now());
  assert.equal(king().claimed, 1);
  assert.equal(king().value, 149);
  p.progress.absorptionKills = 200;
  progress.applyEvent(p, { type: "massPeak", mass: p.progress.maxMass }, Date.now());
  assert.equal(king().claimed, 2);
  assert.equal(king().value, 0);
  p.activity.values.investment = 5;
  extra.awardExtra(p);
  assert.equal(extra.publicExtra(p).find((a) => a.id === "investment").value, 0);
  p.activity.values.investment = 14;
  extra.awardExtra(p);
  assert.equal(p.activity.claimed.investment, 1);
  p.activity.values.investment = 15;
  extra.awardExtra(p);
  assert.equal(p.activity.claimed.investment, 2);
  progress.validateProgress(p);
  extra.validateActivity(p);
});
test("Миграция сохраняет степени, Царь начинает счёт поглощений, серия дней сбрасывает текущую степень", () => {
  const { p } = profile();
  delete p.progress.stageSpent;
  delete p.progress.absorptionKills;
  delete p.progress.absorptionVictims;
  delete p.progress.kingLegacyDegrees;
  p.progress.claimed.king = 2;
  p.progress.kills = 70;
  const before = p.greatness;
  progress.applyEvent(p, { type: "massPeak", mass: p.progress.maxMass }, Date.now());
  assert.equal(p.greatness, before);
  assert.equal(progress.publicProgress(p).achievements.find((a) => a.id === "king").value, 0);
  const at = p.activity.trackedAt;
  p.activity.lastVisitDay = extra.localDay(at);
  p.activity.streak = 10;
  p.activity.values.regular = 10;
  p.activity.claimed.regular = 1;
  p.activity.stageSpent.regular = 7;
  extra.refreshCalendar(p, at + 3 * extra.DAY, true);
  assert.equal(p.activity.claimed.regular, 1);
  assert.equal(p.activity.stageSpent.regular, 0);
  assert.equal(p.activity.values.regular, 1);
  extra.validateActivity(p);
});
test("Публичный профиль исключает секреты, VK допускает только прямой HTTPS адрес", () => {
  const { store, p } = profile();
  p.personal = { nameSet: true, gender: "male", vkUrl: "https://vk.com/test" };
  p.progress.bestAbsorptions = 12;
  const view = store.publicPlayer(p.id);
  assert.equal(view.bestAbsorptions, 12);
  assert.equal(view.rank, 1);
  assert.equal(view.vkUrl, p.personal.vkUrl);
  for (const key of [
    "wallet",
    "receipts",
    "inventory",
    "personal",
    "progress",
    "quickSlots",
    "token",
  ])
    assert.equal(key in view, false, key);
  assert.equal(details.vkLink("https://m.vk.com/id123/"), "https://vk.com/id123");
  for (const value of [
    "javascript:alert(1)",
    "https://vk.com.evil.com/id1",
    "https://vk.com@evil.com/id1",
    "http://vk.com/id1",
    "https://vk.com/id1?redirect=bad",
    "https://vk.com/a/b",
  ])
    assert.throws(() => details.vkLink(value));
});
test("Рекорд поглощений исключает массовый бонус и всё после лимита XP", () => {
  const { p } = profile();
  progress.applyEvent(p, { type: "lifeStarted", lifeId: "life" }, 1000);
  progress.applyEvent(p, { type: "massBonus", lifeId: "life", sequence: 1, kills: 20 }, 2000);
  assert.equal(p.progress.bestAbsorptions, 0);
  progress.applyEvent(p, { type: "absorbed", victimProfileId: randomUUID(), gain: 10 }, 3000);
  assert.equal(p.progress.bestAbsorptions, 1);
  p.progress.session.xp = p.progress.arenaXpTarget - p.progress.xp;
  progress.applyEvent(p, { type: "absorbed", victimProfileId: randomUUID(), gain: 10 }, 4000);
  assert.equal(p.progress.bestAbsorptions, 1);
});
