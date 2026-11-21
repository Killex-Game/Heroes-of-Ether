/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto");
const {
  TITLES,
  POOLS,
  RARITY_SHARES,
  randomItems,
  legacyReward,
  awardTitles,
  validateHonors,
  publicHonors,
} = require("../../src/server/progression/title-chest-rewards");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp");
const NOW = Date.UTC(2026, 9, 19, 12);
const NEW_TOTALS = [50, 125, 250, 1250, 2500, 3750, 3750, 7500, 12500, 250000];
const V3_TOTALS = [200, 500, 1000, 5000, 10000, 15000, 15000, 30000, 50000, 1000000];
const OLD_TOTALS = [100, 500, 1000, 2500, 5000, 7500, 7500, 10000, 25000, 500000];
const EXPECTED_RARITIES = [
  { common: 50 },
  { common: 63, advanced: 62 },
  { common: 75, advanced: 175 },
  { common: 125, advanced: 500, rare: 625 },
  { advanced: 750, rare: 1000, clan: 750 },
  { advanced: 375, rare: 1500, clan: 1875 },
  { advanced: 188, rare: 1125, clan: 2437 },
  { rare: 2250, clan: 5250 },
  { advanced: 125, rare: 3625, clan: 8750 },
  { clan: 250000 },
];
function fixture(filePath) {
  const store = new ProfileStore({ filePath, now: () => NOW }),
    auth = store.open(),
    p = () => store.find(auth.token);
  p().greatness = TITLES.at(-1).threshold;
  awardTitles(p(), NOW);
  return { store, auth, p };
}

test("Число бустеров всех десяти сундуков уменьшено вчетверо, аккаунты не влияют на состав", () => {
  assert.deepEqual(
    TITLES.map((t) => t.boosters),
    NEW_TOTALS,
  );
  assert.deepEqual(
    NEW_TOTALS,
    V3_TOTALS.map((n) => n / 4),
  );
  for (const status of [1, 2, 3, 4]) {
    const multiplier = 1;
    const { store, auth, p } = fixture();
    p().account = {
      ...require("../../src/server/accounts/account-benefits").fresh(),
      vipUntil: [2, 4].includes(status) ? NOW + 86400000 : 0,
      premiumUntil: status >= 3 ? NOW + 86400000 : 0,
    };
    for (const [i, title] of TITLES.entries()) {
      store.prepareChest(auth.token, title.id, randomUUID());
      const reward = p().honors.pending;
      assert.equal(reward.version, 6);
      assert.equal(reward.multiplier, multiplier);
      assert.equal(
        Object.values(reward.items).reduce((a, b) => a + b, 0),
        NEW_TOTALS[i] * multiplier,
      );
      assert.equal(publicHonors(p(), NOW).tiers[i].boosters, NEW_TOTALS[i] * multiplier);
      validateHonors(p());
      delete p().honors.pending;
    }
  }
});

test("Все десять сундуков: целые количества, округлённые доли и точный итог при разных источниках случайности", () => {
  for (const [index, title] of TITLES.entries()) {
    const variants = [];
    for (const random of [(n) => 0, (n) => n - 1, (n) => Math.floor(n / 2)]) {
      const items = randomItems(title, random),
        totals = {};
      variants.push(items);
      for (const [id, n] of Object.entries(items)) {
        assert.ok(Number.isSafeInteger(n) && n > 0);
        const tier = Object.keys(POOLS).find((t) => POOLS[t].includes(id));
        totals[tier] = (totals[tier] || 0) + n;
      }
      assert.deepEqual(totals, EXPECTED_RARITIES[index]);
      assert.equal(
        Object.values(totals).reduce((a, b) => a + b, 0),
        title.boosters,
      );
      for (const [tier, percent] of Object.entries(RARITY_SHARES[title.id]))
        assert.ok(Math.abs(totals[tier] - (title.boosters * percent) / 100) < 1);
    }
    assert.notDeepEqual(variants[0], variants[1]);
  }
});

test("Случайная награда сохраняется на диске, не меняется после повторного Да или чтения профиля", (t) => {
  const filePath = path.join(temporary(t, "random-chests"), "profiles.json"),
    { store, auth, p } = fixture(filePath);
  p().account = {
    ...require("../../src/server/accounts/account-benefits").fresh(),
    vipUntil: NOW + 86400000,
    premiumUntil: NOW + 86400000,
  };
  store.prepareChest(auth.token, "emperor", randomUUID());
  const reward = structuredClone(p().honors.pending);
  assert.equal(reward.version, 6);
  assert.equal(reward.multiplier, 1);
  for (let i = 0; i < 3; i++) {
    store.prepareChest(auth.token, "emperor", randomUUID());
    const view = publicHonors(p(), NOW);
    assert.equal(view.tiers[8].items, undefined);
    assert.deepEqual(view.pending, reward);
  }
  const disk = new ProfileStore({ filePath, now: () => NOW });
  assert.deepEqual(disk.find(auth.token).honors.pending, reward);
  const inventory = structuredClone(disk.find(auth.token).inventory);
  disk.openChest(auth.token, "emperor", randomUUID());
  for (const [id, n] of Object.entries(reward.items)) inventory[id] = (inventory[id] || 0) + n;
  assert.deepEqual(disk.find(auth.token).inventory, inventory);
});

test("Старые подготовленные награды всех шести сундуков выдаются без изменения после обновления", (t) => {
  const filePath = path.join(temporary(t, "legacy-rewards"), "profiles.json"),
    { store, auth, p } = fixture(filePath);
  for (const title of TITLES.slice(0, 6)) {
    const reward = legacyReward(title, 4);
    p().honors.pending = structuredClone(reward);
    store.save(store.data);
    const disk = new ProfileStore({ filePath, now: () => NOW });
    assert.deepEqual(disk.find(auth.token).honors.pending, reward);
    const before = structuredClone(disk.find(auth.token));
    disk.openChest(auth.token, title.id, randomUUID());
    const after = disk.find(auth.token);
    assert.equal(after.wallet.bucks, before.wallet.bucks + reward.bucks / reward.multiplier);
    for (const [id, n] of Object.entries(reward.items))
      assert.equal(after.inventory[id], (before.inventory[id] || 0) + n / reward.multiplier);
  }
});

for (const [version, totals] of [
  [2, OLD_TOTALS],
  [3, V3_TOTALS],
  [4, NEW_TOTALS],
])
  test(`Подготовленные v${version} всех десяти сундуков сохраняются и выдаются один раз с прежним количеством`, (t) => {
    const filePath = path.join(temporary(t, `v${version}-rewards`), "profiles.json"),
      { store, auth, p } = fixture(filePath);
    p().account = {
      ...require("../../src/server/accounts/account-benefits").fresh(),
      vipUntil: NOW + 86400000,
      premiumUntil: NOW + 86400000,
    };
    for (const [i, title] of TITLES.entries()) {
      store.prepareChest(auth.token, title.id, randomUUID());
      const reward = {
        ...p().honors.pending,
        version,
        ...(title.id === "boss" ? { accountDays: { vip: 180, premium: 180 } } : {}),
        multiplier: 4,
        coins: title.coins * 2 * 4,
        crystals: title.crystals * 2 * 4,
        bucks: title.bucks * 2 * 4,
        items: Object.fromEntries(
          Object.entries(randomItems({ ...title, boosters: totals[i] })).map(([id, n]) => [
            id,
            n * 4,
          ]),
        ),
      };
      p().honors.pending = structuredClone(reward);
      store.save(store.data);
      const disk = new ProfileStore({ filePath, now: () => NOW });
      disk.prepareChest(auth.token, title.id, randomUUID());
      const base = structuredClone(reward);
      for (const key of ["coins", "crystals", "bucks"]) base[key] /= 4;
      for (const key of Object.keys(base.items)) base.items[key] /= 4;
      base.multiplier = 1;
      assert.deepEqual(disk.find(auth.token).honors.pending, base);
      const before = structuredClone(disk.find(auth.token).inventory),
        requestId = randomUUID();
      disk.openChest(auth.token, title.id, requestId);
      const expected = { ...before };
      for (const [id, n] of Object.entries(reward.items))
        expected[id] = (expected[id] || 0) + n / reward.multiplier;
      assert.deepEqual(disk.find(auth.token).inventory, expected);
      disk.openChest(auth.token, title.id, requestId);
      assert.deepEqual(disk.find(auth.token).inventory, expected);
      assert.equal(
        Object.values(reward.items).reduce((a, b) => a + b, 0),
        totals[i] * 4,
      );
      delete p().honors.pending;
    }
  });

test("Повреждённые случайные награды не загружаются и не затирают сохранение", (t) => {
  const filePath = path.join(temporary(t, "corrupt-random"), "profiles.json"),
    { store, auth, p } = fixture(filePath);
  store.prepareChest(auth.token, "experienced", randomUUID());
  const original = structuredClone(store.data);
  for (const corrupt of [
    (r) => r.items[Object.keys(r.items)[0]]++,
    (r) => (r.items.fire = 1),
    (r) => (r.multiplier = 5),
    (r) => (r.accountDays.vip = 30),
    (r) => (r.version = 7),
    (r) => r.coins++,
    (r) => (r.extra = 1),
    (r) => (r.items = []),
  ]) {
    const data = structuredClone(original),
      profile = Object.values(data.profiles).find((p) => p.id === auth.profile.id);
    corrupt(profile.honors.pending);
    const raw = JSON.stringify(data);
    fs.writeFileSync(filePath, raw);
    assert.throws(
      () => new ProfileStore({ filePath, now: () => NOW }),
      /Повреждена подготовленная/,
    );
    assert.equal(fs.readFileSync(filePath, "utf8"), raw);
  }
  validateHonors(p());
});
