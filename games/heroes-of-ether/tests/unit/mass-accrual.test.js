"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const accrual = require("../../src/server/arena/mass-accrual");
const progression = require("../../src/server/progression/experience-progression");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
function fixture(vip = false, premium = false, mass = 50000) {
  const store = new ProfileStore(), opened = store.open(), p = store.find(opened.token);
  p.level = 501;
  p.progress = progression.freshProgress(501);
  p.account = { vipUntil: vip ? 1e9 : 0, premiumUntil: premium ? 1e9 : 0 };
  progression.applyEvent(p, { type: "lifeStarted", lifeId: "life" }, 0);
  const actor = { id: "actor", lifeId: "life", mass, account: { vip, premium } };
  accrual.reset(actor, 0);
  const step = (at, force = false, population = 1) => {
    const event = accrual.sample(actor, at, force, population);
    if (event) progression.applyEvent(p, event, at);
    return event;
  };
  const run = (from, to, population = 1) => {
    let last;
    for (let at = from + 50; at <= to; at += 50) last = step(at, false, population) || last;
    return last;
  };
  return { p, actor, step, run };
}
for (const [vip, premium, factor] of [[false, false, 1], [true, false, 2], [false, true, 3], [true, true, 3]]) {
  test(`30 секунд: только база умножается на аккаунт ${vip}/${premium}`, () => {
    for (const mass of [20, 5000, 15000, 29999, 30000, 75000, 1000000]) {
      for (const n of [1, 17, 35]) {
        const { p, step, run } = fixture(vip, premium, mass);
        run(0, 29950, n);
        assert.equal(p.progress.session.xp, 0);
        assert.equal(p.progress.session.kills, 0);
        step(30000, false, n);
        const bonus = mass >= 30000 ? n : 0;
        assert.equal(p.progress.session.xp, (mass >= 30000 ? 50 : 25) * factor + bonus, `mass=${mass}, n=${n}`);
        assert.equal(p.progress.session.kills, (mass >= 30000 ? 2 : 1) * factor + bonus, `mass=${mass}, n=${n}`);
        assert.equal(p.progress.session.massXpRemainder, 0);
        assert.equal(p.progress.session.massKillRemainder, 0);
        progression.validateProgress(p);
      }
    }
  });
}
test("Число участников меняет только наблюдаемый интервал, дробный остаток сохраняется", () => {
  const { p, run } = fixture(true);
  run(0, 15000, 10);
  const e = run(15000, 30000, 35);
  assert.equal(p.progress.session.xp, 122);
  assert.equal(p.progress.session.kills, 26);
  assert.equal(e.xpUnits / accrual.XP_DENOMINATOR, 122.5);
  assert.equal(e.killUnits / accrual.KILL_DENOMINATOR, 26.5);
  p.progress = JSON.parse(JSON.stringify(p.progress));
  run(30000, 45000, 35);
  run(45000, 60000, 10);
  assert.equal(p.progress.session.xp, 245);
  assert.equal(p.progress.session.kills, 53);
  assert.equal(p.progress.session.massXpRemainder, 0);
  assert.equal(p.progress.session.massKillRemainder, 0);
});
test("Рост массы не пересчитывает прошлое, пауза и выход не оплачиваются", () => {
  const { p, actor, run, step } = fixture(false, false, 20);
  run(0, 30000, 35);
  assert.equal(p.progress.session.xp, 25);
  assert.equal(p.progress.session.kills, 1);
  run(30000, 45000, 35);
  actor.mass = 30000;
  const e = run(45000, 60000, 35);
  assert.ok(e.xpUnits / accrual.XP_DENOMINATOR > 54.8 && e.xpUnits / accrual.XP_DENOMINATOR <= 55);
  assert.ok(e.killUnits / accrual.KILL_DENOMINATOR > 18.9 && e.killUnits / accrual.KILL_DENOMINATOR <= 19);
  const before = p.progress.session.xp;
  assert.equal(step(900000, false, 35), null);
  assert.equal(p.progress.session.xp, before);
  run(900000, 901000, 35);
  step(901000, true);
  assert.equal(actor.massAccrual.xpUnits, 0);
  assert.equal(p.progress.session.xp, before);
});
test("Окончание аккаунта не пересчитывает уже накопленное и не умножает n", () => {
  const { p, actor, run } = fixture(true, true);
  run(0, 15000, 35);
  actor.account = {};
  run(15000, 30000, 35);
  assert.equal(p.progress.session.xp, 135);
  assert.equal(p.progress.session.kills, 39);
});
test("Шапка сохраняет 10% опыта, поглощения начисляются отдельно", () => {
  const { p, run } = fixture();
  p.wardrobeState.legacyNovice = true;
  p.outfit = { hat: "novice_hat" };
  run(0, 90000);
  assert.equal(p.progress.session.xp, 168);
  assert.equal(p.progress.session.kills, 9);
  for (let i = 0; i < 10; i++)
    progression.applyEvent(p, { type: "absorbed", victimProfileId: "v" + i, gain: 20 }, 91000 + i);
  assert.equal(p.progress.session.xp, 201);
  assert.equal(p.progress.session.accessoryXpRemainder, 0);
  progression.validateProgress(p);
});
test("Повтор пакета, старая жизнь и предел XP не выдают повторную награду", () => {
  const { p, run } = fixture(true);
  const event = run(0, 30000);
  assert.equal(p.progress.session.xp, 101);
  const saved = JSON.stringify(p.progress);
  progression.applyEvent(p, event, 30000);
  progression.applyEvent(p, { ...event, sequence: 2, lifeId: "old" }, 30000);
  assert.equal(JSON.stringify(p.progress), saved);
  p.progress.arenaXpTarget = p.progress.xp + 175;
  run(30000, 60000);
  assert.equal(p.progress.session.xp, 175);
  const credited = p.progress.kills;
  run(60000, 90000);
  assert.equal(p.progress.session.xp, 175);
  assert.equal(p.progress.kills, credited);
  assert.equal(p.progress.session.kills, 15);
});
test("Реальное поглощение сохраняет 3/6/9/9 XP и один килл", () => {
  for (const [vip, premium, xp] of [[false, false, 3], [true, false, 6], [false, true, 9], [true, true, 9]]) {
    const { p } = fixture(vip, premium);
    progression.applyEvent(p, { type: "absorbed", victimProfileId: "other", lifeId: "v", gain: 20 }, 1000);
    assert.equal(p.progress.session.xp, xp);
    assert.equal(p.progress.session.kills, 1);
  }
});
for (const deathAt of [29950, 31500, 59950]) {
  test(`Завершение на ${deathAt} мс сохраняет только полные выплаты`, () => {
    const { p, actor, step, run } = fixture();
    run(0, deathAt);
    const before = structuredClone(p.progress);
    assert.equal(step(deathAt, true), null);
    assert.equal(actor.massAccrual.xpUnits, 0);
    assert.equal(actor.massAccrual.killUnits, 0);
    assert.deepEqual(p.progress, before);
    assert.equal(p.progress.session.xp, deathAt < 30000 ? 0 : 51);
    assert.equal(p.progress.session.kills, deathAt < 30000 ? 0 : 3);
    actor.dead = true;
    assert.equal(step(60000), null);
    actor.dead = false;
    actor.isRemnant = true;
    assert.equal(step(60000), null);
  });
}
test("Арены считают участников отдельно: части, погибшие и остатки лобби не увеличивают n", () => {
  for (const n of [2, 35]) {
    const arena = new Arena({ etherCount: 0, world: { width: 100000, height: 100000 } });
    for (let i = 0; i < n + 2; i++) {
      const p = arena.addPlayer(0, `p-${i}`);
      Object.assign(p, { mass: 30000, radius: radiusForMass(30000), x: 1000 + i * 2000,
        y: 1000, targetX: 1000 + i * 2000, targetY: 1000, stopped: true,
        nextMassDecayAt: Infinity, protectedUntil: Infinity, isBot: i > 0 });
      accrual.reset(p, 0);
    }
    arena.players.get(`p-${n}`).dead = true;
    Object.assign(arena.players.get(`p-${n + 1}`), { isRemnant: true, removeAt: 1e9 });
    const actor = arena.players.get("p-0");
    actor.parts = [10000, 20000].map((mass, i) => ({ id: `part-${i}`, mass, radius: radiusForMass(mass),
      x: 1000 + i * 200, y: 1000, vx: 0, vy: 0, mergeAt: 1e9 }));
    arena.syncParts(actor);
    assert.equal(arena.activePlayerCount(), n);
    for (let at = 50; at <= 30000; at += 50) arena.step(at);
    const event = arena.progressEvents.find((e) => e.type === "massAccrual" && e.playerId === actor.id);
    assert.equal(event.xpUnits / accrual.XP_DENOMINATOR, 50 + n);
    assert.equal(event.killUnits / accrual.KILL_DENOMINATOR, 2 + n);
    arena.removePlayer("p-1");
    for (let at = 30050; at <= 60000; at += 50) arena.step(at);
    const next = arena.progressEvents.find((e) => e.type === "massAccrual" && e.playerId === actor.id);
    assert.equal(next.xpUnits / accrual.XP_DENOMINATOR, 50 + n - 1);
  }
});
