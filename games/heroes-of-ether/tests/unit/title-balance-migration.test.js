"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  accounts = require("../../src/server/accounts/account-benefits"),
  titles = require("../../src/server/progression/title-chest-rewards");
const NOW = Date.UTC(2026, 9, 21, 12);
const CURRENCIES = [
  [500, 50, 5],
  [2500, 125, 125],
  [5000, 250, 250],
  [7500, 500, 375],
  [15000, 1250, 500],
  [25000, 2500, 500],
  [37500, 3750, 1250],
  [50000, 5000, 2500],
  [125000, 12500, 5000],
  [250000, 25000, 10000],
];

test("Валюты всех десяти сундуков: новые половинные суммы, точное начисление и множители аккаунтов", () => {
  for (const status of [1, 2, 3, 4]) {
    const multiplier = 1;
    const store = new ProfileStore({ now: () => NOW }),
      auth = store.open(),
      p = () => store.find(auth.token);
    p().greatness = 2000000;
    titles.awardTitles(p(), NOW);
    for (const [i, title] of titles.TITLES.entries()) {
      p().account = {
        ...accounts.fresh(),
        vipUntil: [2, 4].includes(status) ? NOW + 86400000 : 0,
        premiumUntil: status >= 3 ? NOW + 86400000 : 0,
      };
      const preview = titles.publicHonors(p(), NOW).tiers[i];
      const before = structuredClone(p().wallet);
      store.prepareChest(auth.token, title.id, randomUUID());
      const reward = p().honors.pending;
      for (const [j, key] of ["coins", "crystals", "bucks"].entries()) {
        assert.equal(title[key], CURRENCIES[i][j]);
        assert.equal(preview[key], CURRENCIES[i][j] * multiplier);
        assert.equal(reward[key], preview[key]);
      }
      const requestId = randomUUID();
      store.openChest(auth.token, title.id, requestId);
      for (const key of ["coins", "crystals", "bucks"])
        assert.equal(p().wallet[key], before[key] + reward[key]);
      const after = structuredClone(p());
      store.openChest(auth.token, title.id, requestId);
      assert.deepEqual(p(), after);
    }
  }
});

function oldSave(t, greatness = 5653) {
  const filePath = path.join(temporary(t, "title-balance"), "profiles.json"),
    store = new ProfileStore({ now: () => NOW }),
    auth = store.open(),
    p = store.find(auth.token);
  store.data.version = 8;
  delete p.transactions;
  p.greatness = greatness;
  p.honors = {
    claimed: 4,
    chests: {
      novice: "opened",
      experienced: "opened",
      expert: "closed",
      sage: "closed",
    },
  };
  p.wallet = { coins: 9876, crystals: 543, bucks: 21 };
  p.inventory = { candy: 7 };
  const title = titles.TITLES[3];
  p.honors.pending = {
    version: 4,
    id: "sage",
    multiplier: 1,
    coins: 15000,
    crystals: 1000,
    bucks: 750,
    items: titles.randomItems(title),
    accountDays: { vip: 7 },
  };
  fs.writeFileSync(filePath, JSON.stringify(store.data));
  return { filePath, auth, before: structuredClone(p) };
}

test("v8 → v9: пересчёт звания, блокировка старших сундуков, перезапуск и повторное достижение без дублей", (t) => {
  const { filePath, auth, before } = oldSave(t);
  let disk = new ProfileStore({ filePath, now: () => NOW });
  const p = () => disk.find(auth.token);
  assert.equal(disk.data.version, 13);
  assert.equal(titles.publicTitle(p()).id, "experienced");
  assert.deepEqual(p().honors.chests, { novice: "opened", experienced: "opened" });
  assert.deepEqual(p().honors.deferredChests, { expert: "closed", sage: "closed" });
  assert.equal(p().honors.pending, undefined);
  assert.deepEqual(p().wallet, before.wallet);
  assert.deepEqual(p().inventory, before.inventory);
  assert.equal(p().greatness, before.greatness);
  assert.throws(() => disk.prepareChest(auth.token, "sage", randomUUID()), /Сначала получи/);
  assert.equal(titles.publicHonors(p(), NOW).tiers[3].state, "unearned");
  disk.save(disk.data);
  const snapshot = structuredClone(p());
  disk = new ProfileStore({ filePath, now: () => NOW });
  assert.deepEqual(p(), snapshot);
  p().greatness = 25000;
  titles.awardTitles(p(), NOW);
  assert.equal(p().greatness, 25010, "Титул не даёт величия; новые аксессуары закрывают Модника I");
  assert.equal(p().honors.chests.expert, "closed");
  disk.prepareChest(auth.token, "expert", randomUUID());
  assert.equal(p().honors.pending.coins, 5000);
  disk.openChest(auth.token, "expert", randomUUID());
  assert.throws(() => disk.openChest(auth.token, "expert", randomUUID()), /уже открыт/);
  p().greatness = 100000;
  titles.awardTitles(p(), NOW);
  assert.equal(p().greatness, 100000);
  assert.equal(p().honors.deferredChests, undefined);
  titles.validateHonors(p());
});

test("Снятое звание с уже открытым сундуком не даёт второй сундук или величие", (t) => {
  const { filePath, auth } = oldSave(t, 99),
    disk = new ProfileStore({ filePath, now: () => NOW }),
    p = disk.find(auth.token);
  assert.equal(titles.publicTitle(p), null);
  assert.equal(p.honors.claimed, 0);
  assert.equal(titles.publicHonors(p, NOW).tiers[0].state, "unearned");
  p.greatness = 5000;
  titles.awardTitles(p, NOW);
  assert.equal(p.greatness, 5000);
  assert.equal(p.honors.claimed, 2);
  assert.equal(p.honors.chests.novice, "opened");
  assert.equal(p.honors.chests.experienced, "opened");
  assert.throws(() => disk.prepareChest(auth.token, "experienced", randomUUID()), /уже открыт/);
  titles.validateHonors(p);
});

test("Пересчёт не скрывает повреждённую старую награду и не перезаписывает файл", (t) => {
  const { filePath } = oldSave(t),
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  Object.values(data.profiles)[0].honors.pending.coins++;
  const raw = JSON.stringify(data);
  fs.writeFileSync(filePath, raw);
  assert.throws(() => new ProfileStore({ filePath, now: () => NOW }), /Повреждена подготовленная/);
  assert.equal(fs.readFileSync(filePath, "utf8"), raw);
});
