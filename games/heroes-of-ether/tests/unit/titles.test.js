/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { temporary } = require("../temp");
const {
  TITLES,
  awardTitles,
  publicTitle,
  validateHonors,
} = require("../../src/server/progression/title-chest-rewards");
const {
  applyEvent,
  successfulBooster,
} = require("../../src/server/progression/experience-progression");
const { grantCoins } = require("../../scripts/development/grant-coins");
function setup() {
  const store = new ProfileStore(),
    a = store.open();
  return { store, a, p: () => store.find(a.token) };
}

test("Звания: десять границ, Мудрец IV, Мастер V, без величия за звание, до 100 звания нет", () => {
  assert.deepEqual(
    TITLES.slice(3, 5).map((t) => t.id),
    ["sage", "master"],
  );
  assert.deepEqual(
    TITLES.map((t) => t.threshold),
    [100, 5000, 25000, 100000, 250000, 500000, 750000, 1000000, 1500000, 2000000],
  );
  assert.deepEqual(
    TITLES.map((t) => t.reward),
    Array(10).fill(0),
  );
  const { p } = setup();
  assert.equal(publicTitle(p()), null);
  for (const [i, t] of TITLES.entries()) {
    p().honors = {
      claimed: i,
      chests: Object.fromEntries(TITLES.slice(0, i).map((x) => [x.id, "closed"])),
    };
    p().greatness = t.threshold - 1;
    awardTitles(p());
    assert.equal(p().honors.claimed, i);
    p().greatness = t.threshold;
    awardTitles(p());
    assert.equal(p().honors.claimed, i + 1);
    assert.equal(p().greatness, t.threshold + t.reward + [0,0,10,0,30,0,0,50,0,100][i]);
    // Title accessories also settle the corresponding Fashionista degree.
    assert.equal(publicTitle(p()).name, t.name);
    validateHonors(p());
  }
});
test("Звания: переход, промежуточные сундуки, повтор и потеря величия", () => {
  const { p } = setup();
  p().greatness = 4999;
  awardTitles(p());
  assert.equal(p().greatness, 4999);
  assert.equal(p().honors.claimed, 1);
  assert.deepEqual(p().honors.chests, { novice: "closed" });
  p().greatness = 2000000;
  awardTitles(p());
  assert.equal(p().greatness, 2000190);
  assert.equal(p().activity.claimed.fashionista, 4);
  assert.equal(p().honors.claimed, 10);
  const snapshot = structuredClone(p());
  awardTitles(p());
  assert.deepEqual(p(), snapshot);
  p().greatness = 0;
  awardTitles(p());
  assert.equal(publicTitle(p()).id, "boss");
  p().greatness = 1000000;
  awardTitles(p());
  assert.equal(p().greatness, 1000000);
  validateHonors(p());
});
test("Четыре цепочки дают 970 величия, первый титул выдаёт сундук без добавки", () => {
  const { p } = setup();
  Object.assign(p().progress, { kills: 2000, absorptionKills: 2000, absorbedMass: 66000, boosterUses: 6599 });
  successfulBooster(p(), 375000);
  assert.equal(p().greatness, 970);
  assert.equal(p().progress.claimed.king, 5);
  assert.equal(p().honors.claimed, 1);
  assert.equal(p().honors.chests.novice, "closed");
  assert.deepEqual(p().wallet, { coins: 100, crystals: 10, bucks: 0 });
  assert.deepEqual(p().inventory, {});
});
test("Новичок: выдан именно подготовленный состав; XP, масса, счётчики и слоты не награда", () => {
  const { store, a, p } = setup();
  store.buy(a.token, "candy", randomUUID());
  p().greatness = 100;
  awardTitles(p());
  store.prepareChest(a.token, "novice", randomUUID());
  const before = structuredClone(p()),
    id = randomUUID(),
    result = store.openChest(a.token, "novice", id);
  assert.deepEqual(result.profile.wallet, { coins: 590, crystals: 60, bucks: 5 });
  const expected = { ...before.inventory };
  for (const [id, n] of Object.entries(before.honors.pending.items))
    expected[id] = (expected[id] || 0) + n;
  assert.deepEqual(p().inventory, expected);
  assert.deepEqual(p().progress, before.progress);
  assert.deepEqual(p().quickSlots, before.quickSlots);
  assert.equal(p().greatness, 100);
  const opened = structuredClone(p());
  assert.equal(store.openChest(a.token, "novice", id).replay, true);
  assert.deepEqual(p(), opened);
  assert.throws(() => store.openChest(a.token, "novice", randomUUID()), /уже открыт/);
  assert.deepEqual(p(), opened);
});
test("Закрытые и незаслуженные сундуки, неверные ID и подмена номера операции не выдают награды", () => {
  const { store, a, p } = setup();
  const before = structuredClone(p());
  for (const id of ["novice", "experienced", "__proto__", null])
    assert.throws(() => store.openChest(a.token, id, randomUUID()));
  assert.deepEqual(p(), before);
  p().greatness = 2000000;
  awardTitles(p());
  const full = structuredClone(p());
  for (const t of TITLES.slice(1))
    assert.throws(
      () => store.openChest(a.token, t.id, randomUUID()),
      t.reason ? /пока закрыт/ : /подтверди/,
    );
  assert.deepEqual(p(), full);
  store.prepareChest(a.token, "novice", randomUUID());
  const id = randomUUID();
  store.openChest(a.token, "novice", id);
  assert.throws(() => store.openChest(a.token, "experienced", id), /номер/);
});
test("Ошибка диска и переполнение откатывают всё содержимое сундука", () => {
  const { store, a, p } = setup();
  p().greatness = 100;
  awardTitles(p());
  store.prepareChest(a.token, "novice", randomUUID());
  const before = structuredClone(p()),
    save = store.save,
    id = randomUUID();
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => store.openChest(a.token, "novice", id), /disk full/);
  assert.deepEqual(p(), before);
  store.save = save;
  const item = Object.keys(p().honors.pending.items)[0];
  p().inventory[item] = Number.MAX_SAFE_INTEGER;
  const overflow = structuredClone(p());
  assert.throws(() => store.openChest(a.token, "novice", id), /баланс/);
  assert.deepEqual(p(), overflow);
  p().inventory[item] = 0;
  store.openChest(a.token, "novice", id);
  assert.equal(p().wallet.bucks, 5);
});
test("Звание и сундук сохраняются вместе с достижением; повтор пакета безопасен", () => {
  const { store, a, p } = setup();
  p().greatness = 99;
  const before = structuredClone(store.data),
    save = store.save,
    id = randomUUID();
  const events = [{ type: "massPeak", profileId: a.profile.id, mass: 25000 }];
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => store.applyArenaProgress(id, events, 1000000), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save;
  store.applyArenaProgress(id, events, 1000000);
  const awarded = structuredClone(store.data);
  store.applyArenaProgress(id, events, 1000000);
  assert.deepEqual(store.data, awarded);
  assert.equal(p().greatness, 109);
  assert.equal(p().honors.claimed, 1);
  assert.equal(p().progress.claimed.maximum, 1);
  assert.deepEqual(p().honors.chests, { novice: "closed" });
  assert.deepEqual(p().wallet, { coins: 100, crystals: 10, bucks: 0 });
});
test("Миграция v4: существующее величие, баланс, инвентарь и незавершённый XP сохраняются без повторных наград", (t) => {
  const filePath = path.join(temporary(t, "titles"), "profiles.json"),
    { store, a, p } = setup();
  p().wallet = { coins: 100, crystals: 20, bucks: 0 };
  p().greatness = 4999;
  p().inventory.candy = 7;
  p().progress.session = { id: "old-life", xp: 15 };
  const old = structuredClone(store.data);
  old.version = 4;
  for (const value of Object.values(old.profiles)) {
    delete value.transactions;
    delete value.honors;
    delete value.wallet.bucks;
  }
  fs.writeFileSync(filePath, JSON.stringify(old));
  let disk = new ProfileStore({ filePath });
  assert.equal(disk.data.version, 13);
  assert.equal(disk.find(a.token).greatness, 4999);
  assert.equal(disk.find(a.token).progress.xp, 15);
  assert.equal(disk.find(a.token).inventory.candy, 7);
  assert.equal(disk.find(a.token).wallet.bucks, 0);
  disk.prepareChest(a.token, "novice", randomUUID());
  const candy = disk.find(a.token).honors.pending.items.candy || 0;
  const id = randomUUID();
  disk.openChest(a.token, "novice", id);
  disk = new ProfileStore({ filePath });
  assert.equal(disk.openChest(a.token, "novice", id).replay, true);
  assert.equal(disk.find(a.token).greatness, 4999);
  assert.equal(disk.find(a.token).inventory.candy, 7 + candy);
  assert.equal(disk.find(a.token).wallet.coins, 600);
  assert.equal(disk.find(a.token).wallet.bucks, 5);
  assert.equal(disk.find(a.token).honors.chests.experienced, undefined);
});
test("Повреждённые сундуки и эфир не перезаписываются пустым сохранением", (t) => {
  const filePath = path.join(temporary(t, "titles-invalid"), "profiles.json"),
    { store, a, p } = setup();
  p().greatness = 100;
  awardTitles(p());
  for (const corrupt of [
    (q) => (q.wallet.bucks = -1),
    (q) => (q.honors.chests.experienced = "invalid"),
    (q) => delete q.honors.chests.novice,
    (q) => (q.honors.claimed = 11),
  ]) {
    const data = structuredClone(store.data);
    corrupt(Object.values(data.profiles)[0]);
    const raw = JSON.stringify(data);
    fs.writeFileSync(filePath, raw);
    assert.throws(() => new ProfileStore({ filePath }), /Повреждены титулы/);
    assert.equal(fs.readFileSync(filePath, "utf8"), raw);
  }
  assert.equal(store.find(a.token).honors.chests.novice, "closed");
});
test("Звание не добавляет величия игроку и клану, личные сундуки не публикуются", () => {
  const { store, a, p } = setup(),
    clans = new ClanService(store);
  grantCoins(store, a.profile.id, 1500);
  p().level = 12;
  p().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  clans.mutate(a.token, {
    action: "create",
    requestId: randomUUID(),
    name: "Лес",
    prefix: "Л",
    emblem: "grove",
  });
  p().greatness = 99;
  applyEvent(p(), { type: "massPeak", mass: 25000 }, 0);
  const top = clans.state(a.token);
  assert.equal(top.mine.greatness, 109);
  assert.equal(top.playerLeaders[0].greatness, 109);
  assert.equal(top.playerLeaders[0].title.id, "novice");
  assert.equal(top.playerLeaders[0].honors, undefined);
  assert.equal(top.playerLeaders[0].wallet, undefined);
});
