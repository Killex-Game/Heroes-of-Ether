/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp");
const {
  applyEvent,
  publicProgress,
  validateProgress,
} = require("../../src/server/progression/experience-progression");
const {
    TITLES,
    RARITY_SHARES,
    randomItems,
    awardTitles,
    validateHonors,
  } = require("../../src/server/progression/title-chest-rewards"),
  { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const accounts = require("../../src/server/accounts/account-benefits"),
  { Arena, radiusForMass, canAbsorb } = require("../../src/server/arena/arena-simulation");
const NOW = Date.UTC(2026, 9, 19, 12);
function fixture(filePath) {
  const store = new ProfileStore({ filePath, now: () => NOW }),
    a = store.open(),
    p = () => store.find(a.token);
  return { store, a, p };
}
test("Килл, достигший XP-предела, зачтён; дальнейшие растут только визуально, с прежним антифармом", () => {
  const { p } = fixture();
  p().progress.xp = 496;
  const send = (e) => applyEvent(p(), e, NOW);
  send({ type: "lifeStarted", lifeId: "life" });
  send({ type: "absorbed", victimProfileId: "a", gain: 10 });
  send({ type: "absorbed", victimProfileId: "b", gain: 20 });
  send({ type: "absorbed", victimProfileId: "c", gain: 30 });
  send({ type: "absorbed", victimProfileId: "c", gain: 30 });
  const v = publicProgress(p());
  assert.equal(v.arenaXp, 4);
  assert.equal(v.arenaXpMax, true);
  assert.equal(v.arenaKills, 3);
  assert.equal(v.arenaCreditedKills, 2);
  assert.equal(p().progress.kills, 2);
  assert.equal(p().progress.absorbedMass, 60);
  validateProgress(p());
  send({ type: "lifeEnded", lifeId: "life", durationSeconds: 80, reason: "absorbed" });
  assert.equal(p().progress.lastLife.kills, 2);
  assert.equal(p().progress.lastLife.visualKills, 3);
  send({ type: "lifeStarted", lifeId: "continue", newArena: false });
  send({ type: "absorbed", victimProfileId: "d", gain: 20 });
  assert.equal(publicProgress(p()).arenaKills, 1);
  assert.equal(publicProgress(p()).arenaCreditedKills, 0);
  send({ type: "lifeEnded", lifeId: "continue", durationSeconds: 10, reason: "left" });
  send({ type: "lifeStarted", lifeId: "from-lobby" });
  send({ type: "absorbed", victimProfileId: "e", gain: 20 });
  assert.equal(p().progress.kills, 3);
  assert.equal(publicProgress(p()).arenaXp, 3);
});
test("Минутный XP закрывает зачёт всех следующих бонусов; пакет, достигший предела, засчитывается целиком", () => {
  const { p } = fixture();
  p().progress.xp = 499;
  applyEvent(p(), { type: "lifeStarted", lifeId: "x" }, NOW);
  applyEvent(p(), { type: "massBonus", lifeId: "x", sequence: 1, kills: 10 }, NOW);
  assert.equal(p().progress.kills, 10);
  assert.equal(p().progress.claimed.king, 0);
  assert.equal(p().progress.absorptionKills, 0);
  applyEvent(p(), { type: "massBonus", lifeId: "x", sequence: 2, kills: 20 }, NOW);
  applyEvent(p(), { type: "massBonus", lifeId: "x", sequence: 2, kills: 20 }, NOW);
  assert.equal(p().progress.kills, 10);
  assert.equal(p().progress.session.kills, 30);
  const { p: q } = fixture();
  q().progress.xp = 499;
  applyEvent(q(), { type: "lifeStarted", lifeId: "q" }, NOW);
  applyEvent(q(), { type: "survivalMinute", mass: 500, minutes: 1 }, NOW);
  applyEvent(q(), { type: "absorbed", victimProfileId: "other", gain: 8 }, NOW);
  assert.equal(q().progress.kills, 0);
  assert.equal(q().progress.session.kills, 1);
});
test("Перезапуск сохраняет зачтённый итог и старые жизни без нового поля", (t) => {
  const filePath = path.join(temporary(t, "kill-limit"), "profiles.json"),
    { store, a, p } = fixture(filePath);
  p().progress.xp = 499;
  store.startLife(a.profile.id, "life");
  for (let i = 0; i < 3; i++)
    store.applyArenaProgress(
      randomUUID(),
      [{ type: "absorbed", profileId: a.profile.id, victimProfileId: "v" + i, gain: 8 }],
      NOW,
    );
  const disk = new ProfileStore({ filePath, now: () => NOW });
  assert.equal(disk.find(a.token).progress.lastLife.kills, 1);
  assert.equal(disk.find(a.token).progress.lastLife.visualKills, 3);
  const old = structuredClone(store.data),
    profile = Object.values(old.profiles)[0];
  delete profile.progress.session.creditedKills;
  fs.writeFileSync(filePath, JSON.stringify(old));
  assert.equal(
    new ProfileStore({ filePath, now: () => NOW }).find(a.token).progress.lastLife.kills,
    3,
  );
});
test("Поглощение и соединение используют одну глубину R − r/3; размер проверяется у каждой части", () => {
  const arena = new Arena({ etherCount: 0 }),
    a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  Object.assign(a, { x: 700, y: 700, mass: 1000, radius: radiusForMass(1000), protectedUntil: 0 });
  Object.assign(b, { x: 700, y: 700, mass: 500, radius: radiusForMass(500), protectedUntil: 0 });
  const low = a.radius - b.radius / 3;
  b.x = a.x + low + 0.001;
  assert.equal(canAbsorb(a, b, 5000), false);
  assert.equal(arena.canMerge(a, a, b), false);
  b.x = a.x + low - 0.001;
  assert.equal(canAbsorb(a, b, 5000), true);
  assert.equal(arena.canMerge(a, a, b), true);
  assert.equal(arena.canMerge(a, b, a), true);
  a.parts = [
    { id: "a", mass: 540, radius: radiusForMass(540), x: 700, y: 700 },
    { id: "a2", mass: 5000, radius: radiusForMass(5000), x: 1800, y: 700 },
  ];
  b.x = 700;
  arena.syncParts(a);
  assert.equal(arena.resolveAbsorptions(5000).length, 0);
  a.parts[0].mass = 1000;
  a.parts[0].radius = radiusForMass(1000);
  arena.syncParts(a);
  assert.equal(arena.resolveAbsorptions(5000).length, 1);
});
test("Десять составов сундуков: точные суммы и согласованные доли редкостей", () => {
  assert.equal(Object.keys(RARITY_SHARES).length, 10);
  for (const t of TITLES.filter((t) => !t.reason)) {
    const items = randomItems(t);
    assert.equal(
      Object.values(items).reduce((a, b) => a + b, 0),
      t.boosters,
    );
    assert.ok(Object.keys(items).every((id) => BOOSTERS.get(id)?.ready));
    assert.ok(t.chestName.startsWith("Сундук "));
    const totals = {};
    for (const [id, n] of Object.entries(items)) {
      const tier = BOOSTERS.get(id).tier;
      totals[tier] = (totals[tier] || 0) + n;
    }
    assert.equal(
      Object.values(totals).reduce((a, b) => a + b, 0),
      t.boosters,
    );
    assert.deepEqual(Object.keys(totals).sort(), Object.keys(RARITY_SHARES[t.id]).sort());
    for (const [tier, percent] of Object.entries(RARITY_SHARES[t.id]))
      assert.ok(Math.abs(totals[tier] - (t.boosters * percent) / 100) < 1);
  }
  assert.equal(TITLES.at(-1).contents, "Клановые 100%");
});
test("Сундуки 2–10: получение после подтверждения, сроки от момента получения, продление без заказа недель, защита от повторов", (t) => {
  const filePath = path.join(temporary(t, "six-chests"), "profiles.json"),
    { store, a, p } = fixture(filePath);
  p().greatness = TITLES.at(-1).threshold;
  awardTitles(p(), NOW);
  let vip = NOW,
    premium = NOW;
  for (const title of TITLES.slice(1)) {
    const before = structuredClone(p()),
      prep = randomUUID();
    store.prepareChest(a.token, title.id, prep);
    const r = structuredClone(p().honors.pending);
    assert.deepEqual(p().wallet, before.wallet);
    assert.deepEqual(p().account, before.account);
    assert.equal(store.prepareChest(a.token, title.id, prep).replay, true);
    const id = randomUUID();
    store.openChest(a.token, title.id, id);
    assert.equal(p().wallet.coins, before.wallet.coins + r.coins);
    for (const [item, n] of Object.entries(r.items))
      assert.equal(p().inventory[item], (before.inventory[item] || 0) + n);
    vip += (r.accountDays.vip || 0) * 86400000;
    premium += (r.accountDays.premium || 0) * 86400000;
    assert.equal(p().account.vipUntil, vip === NOW ? 0 : vip);
    assert.equal(p().account.premiumUntil, premium === NOW ? 0 : premium);
    assert.equal(p().activity.values.vip, 0);
    assert.equal(p().activity.values.premium, 0);
    const result = structuredClone(p());
    store.openChest(a.token, title.id, id);
    assert.deepEqual(p(), result);
    validateHonors(p());
  }
  const disk = new ProfileStore({ filePath, now: () => NOW });
  for (const title of TITLES.slice(1))
    assert.equal(disk.find(a.token).honors.chests[title.id], "opened");
});
test("Множитель сундука фиксируется на Да, дни статуса не умножаются; подмена и ошибка записи откатываются", () => {
  const { store, a, p } = fixture();
  p().greatness = 5000;
  awardTitles(p(), NOW);
  p().account = {
    ...accounts.fresh(),
    vipUntil: NOW + accounts.WEEK,
    premiumUntil: NOW + accounts.WEEK,
  };
  store.prepareChest(a.token, "experienced", randomUUID());
  assert.equal(p().honors.pending.multiplier, 1);
  assert.equal(p().honors.pending.accountDays.vip, 3);
  const forged = structuredClone(p());
  forged.honors.pending.accountDays.vip = 999;
  assert.throws(() => validateHonors(forged), /Повреждена/);
  const before = structuredClone(p()),
    save = store.save,
    id = randomUUID();
  store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => store.openChest(a.token, "experienced", id), /disk/);
  assert.deepEqual(p(), before);
  store.save = save;
  store.openChest(a.token, "experienced", id);
  assert.equal(p().account.vipUntil, NOW + 10 * 86400000);
});
