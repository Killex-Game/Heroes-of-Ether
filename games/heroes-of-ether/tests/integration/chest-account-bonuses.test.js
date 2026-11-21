"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  accounts = require("../../src/server/accounts/account-benefits"),
  chests = require("../../src/server/clans/clan-chest-rewards"),
  titles = require("../../src/server/progression/title-chest-rewards"),
  { CHESTS, DAY } = require("../../public/shared/clan-competition-rules");
const NOW = Date.UTC(2026, 9, 21, 12);
const statuses = [
  ["обычный", false, false, 1, 0],
  ["VIP", true, false, 2, 5],
  ["Premium", false, true, 3, 10],
  ["оба", true, true, 3, 15],
];
function fixture(vip, premium, filePath = null) {
  let time = NOW;
  const store = new ProfileStore({ filePath, now: () => time }),
    auth = store.open(),
    p = () => store.find(auth.token);
  p().account = {
    ...accounts.fresh(),
    vipUntil: vip ? NOW + DAY : 0,
    premiumUntil: premium ? NOW + DAY : 0,
  };
  const act = (action, chestId, requestId = randomUUID()) =>
    store.clanChestAction(auth.token, { action, chestId, requestId });
  return { store, auth, p, act, setTime: (value) => (time = value) };
}
for (const [name, vip, premium, multiplier, bonus] of statuses)
  for (const tier of Object.keys(CHESTS))
    test(`${name}, ${tier}: множитель валют и бустеров, базовое величие + фиксированный бонус за каждый сундук`, () => {
      const f = fixture(vip, premium),
        spec = CHESTS[tier];
      for (let i = 0; i < 2; i++) {
        const id = chests.grant(f.p(), tier, NOW, { claimRequired: true }).id;
        const before = structuredClone(f.p());
        f.act("claim", id);
        f.act("claim", id);
        f.act("prepare", id);
        const reward = structuredClone(
          f.p().clanChests.items.find((item) => item.id === id).reward,
        );
        assert.equal(reward.multiplier, multiplier);
        assert.equal(reward.greatness, spec.greatness + bonus);
        assert.equal(reward.greatnessBonus, bonus);
        assert.equal(reward.greatnessMultiplier, undefined);
        assert.equal(f.p().greatness, before.greatness, "Просмотр награды ещё ничего не начисляет");
        assert.deepEqual(f.p().wallet, before.wallet);
        for (const key of ["coins", "crystals"])
          assert.ok(
            reward[key] >= spec[key][0] * multiplier && reward[key] <= spec[key][1] * multiplier,
          );
        assert.equal(
          Object.values(reward.items).reduce((a, b) => a + b, 0),
          spec.boosters * multiplier,
        );
        f.act("claim", id);
        f.act("prepare", id);
        assert.deepEqual(f.p().clanChests.items.find((item) => item.id === id).reward, reward);
        const request = randomUUID();
        f.act("open", id, request);
        assert.equal(f.p().greatness - before.greatness, spec.greatness + bonus);
        for (const key of ["coins", "crystals"])
          assert.equal(f.p().wallet[key] - before.wallet[key], reward[key]);
        const after = structuredClone(f.p());
        f.act("open", id, request);
        assert.deepEqual(f.p(), after);
        assert.throws(() => f.act("open", id), /открыт|хранения/);
        assert.deepEqual(f.p(), after);
      }
    });

test("Бонусы определяются при подтверждении открытия; истёкший аккаунт и новый день не дают лишних наград", (t) => {
  const filePath = path.join(temporary(t, "chest-status"), "profiles.json"),
    f = fixture(true, true, filePath),
    first = chests.grant(f.p(), "high", NOW).id,
    second = chests.grant(f.p(), "high", NOW).id;
  f.act("claim", first);
  f.act("prepare", first);
  f.act("claim", second); // Storage is safe; the multiplier is chosen only at prepare.
  const reward = structuredClone(f.p().clanChests.items[0].reward);
  f.setTime(NOW + DAY);
  f.store.open(f.auth.token);
  assert.equal(f.p().greatness, 0);
  f.act("claim", second);
  f.act("prepare", second);
  assert.equal(f.p().clanChests.items[1].reward.multiplier, 1);
  assert.equal(f.p().clanChests.items[1].reward.greatness, 10);
  const disk = new ProfileStore({ filePath, now: () => NOW + DAY });
  assert.deepEqual(disk.find(f.auth.token).clanChests.items[0].reward, reward);
  disk.clanChestAction(f.auth.token, { action: "open", chestId: first, requestId: randomUUID() });
  assert.equal(disk.find(f.auth.token).greatness, 25);
});

test("Ошибка записи не выдаёт валюты, бустеры или бонус величия; повтор после восстановления выдаёт один раз", () => {
  const f = fixture(true, true),
    id = chests.grant(f.p(), "high", NOW).id;
  f.act("claim", id);
  f.act("prepare", id);
  const before = structuredClone(f.p()),
    save = f.store.save,
    request = randomUUID();
  f.store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => f.act("open", id, request), /disk/);
  assert.deepEqual(f.p(), before);
  f.store.save = save;
  f.act("open", id, request);
  assert.equal(f.p().greatness, 25);
});

test("Сохранения v9: старые подготовленные сундуки переходят на новые бонусы без повторного розыгрыша", (t) => {
  const filePath = path.join(temporary(t, "chest-migration"), "profiles.json"),
    f = fixture(true, true, filePath);
  f.p().greatness = 2000000;
  titles.awardTitles(f.p(), NOW);
  f.store.prepareChest(f.auth.token, "novice", randomUUID());
  const expectedTitle = structuredClone(f.p().honors.pending);
  for (const [index, [, vip, premium]] of statuses.entries()) {
    f.p().account.vipUntil = vip ? NOW + DAY : 0;
    f.p().account.premiumUntil = premium ? NOW + DAY : 0;
    const id = chests.grant(f.p(), "high", NOW).id;
    f.act("claim", id);
    f.act("prepare", id);
  }
  const expectedClan = structuredClone(f.p().clanChests.items);
  // This fixture emulates the older high chest, whose coins started at 300.
  for (const item of expectedClan) {
    item.reward.version = 3;
    item.reward.coins = 450 * item.reward.multiplier;
  }
  const old = structuredClone(f.store.data),
    p = Object.values(old.profiles)[0];
  old.version = 9;
  const scaleFour = (r) => {
    for (const key of ["coins", "crystals", "bucks"]) r[key] = (r[key] / r.multiplier) * 4;
    for (const key of Object.keys(r.items)) r.items[key] = (r.items[key] / r.multiplier) * 4;
    r.multiplier = 4;
  };
  scaleFour(p.honors.pending);
  p.clanChests.items.forEach((item, index) => {
    const r = item.reward;
    r.coins = 450 * r.multiplier;
    if (index === 3) scaleFour(r);
    r.greatnessMultiplier = Math.min(index + 1, 3);
    r.greatness = CHESTS[item.tier].greatness * r.greatnessMultiplier;
    delete r.greatnessBonus;
    delete r.version;
  });
  const wallet = structuredClone(p.wallet),
    inventory = structuredClone(p.inventory),
    greatness = p.greatness;
  fs.writeFileSync(filePath, JSON.stringify(old));
  const disk = new ProfileStore({ filePath, now: () => NOW }),
    migrated = disk.find(f.auth.token);
  assert.equal(disk.data.version, 13);
  assert.equal(migrated.honors.pending.multiplier, 3);
  assert.deepEqual(disk.view(migrated).honors.pending, expectedTitle);
  assert.deepEqual(migrated.clanChests.items, expectedClan);
  assert.deepEqual(migrated.wallet, wallet);
  assert.deepEqual(migrated.inventory, inventory);
  assert.equal(migrated.greatness, greatness);
  disk.save(disk.data);
  assert.deepEqual(new ProfileStore({ filePath, now: () => NOW }).find(f.auth.token), migrated);
  p.clanChests.items[0].reward.coins++;
  p.clanChests.items[0].reward.greatness++;
  const corrupt = JSON.stringify(old);
  fs.writeFileSync(filePath, corrupt);
  assert.throws(
    () => new ProfileStore({ filePath, now: () => NOW }),
    /Повреждены клановые сундуки/,
  );
  assert.equal(fs.readFileSync(filePath, "utf8"), corrupt);
});

test("Фиксированные и недельные призы не считаются открытием сундука", () => {
  const f = fixture(true, true);
  chests.award(f.p(), { coins: 100, crystals: 10, bucks: 1 }, NOW, { multiply: false });
  assert.equal(f.p().greatness, 0);
  const before = structuredClone(f.p());
  chests.award(f.p(), { coins: 100, crystals: 50, bucks: 50, greatness: 5 }, NOW);
  assert.equal(f.p().wallet.coins - before.wallet.coins, 400);
  assert.equal(f.p().greatness - before.greatness, 15);
});

test("Баланс сундуков v4: старые подготовленные v3 сохраняются и выдаются без повторного розыгрыша", (t) => {
  const filePath = path.join(temporary(t, "clan-rewards-v4"), "profiles.json");
  const f = fixture(false, false, filePath);
  const legacyCoins = { low: 200, medium: 350, high: 500 };
  for (const tier of ["low", "medium", "high"]) {
    const id = chests.grant(f.p(), tier, NOW).id;
    f.act("claim", id);
    f.act("prepare", id);
    const r = f.p().clanChests.items.find(x => x.id === id).reward;
    assert.equal(r.version, 4);
    r.version = 3;
    r.coins = legacyCoins[tier];
  }
  f.store.save(f.store.data);
  const loaded = new ProfileStore({ filePath, now: () => NOW });
  const prepared = structuredClone(loaded.find(f.auth.token).clanChests.items);
  for (const item of prepared) {
    const wallet = structuredClone(loaded.find(f.auth.token).wallet);
    loaded.clanChestAction(f.auth.token, { action: "prepare", chestId: item.id, requestId: randomUUID() });
    assert.deepEqual(loaded.find(f.auth.token).clanChests.items.find(x => x.id === item.id).reward, item.reward);
    loaded.clanChestAction(f.auth.token, { action: "open", chestId: item.id, requestId: randomUUID() });
    assert.equal(loaded.find(f.auth.token).wallet.coins - wallet.coins, item.reward.coins);
  }
});

test("Подготовленный клановый сундук v2: бонус уменьшается без смены содержимого и без повторной выдачи", (t) => {
  const filePath = path.join(temporary(t, "chest-greatness-v3"), "profiles.json"),
    f = fixture(true, true, filePath),
    id = chests.grant(f.p(), "high", NOW).id;
  f.act("claim", id);
  f.act("prepare", id);
  const r = f.p().clanChests.items[0].reward;
  r.version = 2;
  r.coins = 450 * r.multiplier;
  r.greatnessBonus = 30;
  r.greatness = 40;
  f.store.save(f.store.data);
  const old = structuredClone(f.p()),
    v = f.store.view(f.p()).clanChests.items[0].reward;
  assert.equal(v.greatness, 25);
  assert.equal(v.greatnessBonus, 15);
  assert.deepEqual(f.p(), old, "view cannot mutate saves");
  f.setTime(NOW + DAY);
  f.act("claim", id);
  f.act("prepare", id);
  const adjusted = f.p().clanChests.items[0].reward;
  assert.deepEqual(adjusted, { ...r, version: 3, greatnessBonus: 15, greatness: 25 });
  const req = randomUUID();
  f.act("open", id, req);
  assert.equal(f.p().greatness - old.greatness, 25);
  const after = structuredClone(f.p());
  f.act("open", id, req);
  assert.deepEqual(f.p(), after);
  assert.deepEqual(new ProfileStore({ filePath, now: () => NOW + DAY }).find(f.auth.token), after);
});
