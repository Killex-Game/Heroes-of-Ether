"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  R = require("../../src/server/roulette/roulette-service"),
  rules = require("../../public/shared/roulette-rules"),
  { temporary } = require("../temp");
const NOW = Date.UTC(2026, 9, 23, 10);
function fixture(filePath = null, rouletteConfig = { testEnabled: true }) {
  const store = new ProfileStore({ filePath, now: () => NOW, rouletteConfig }),
    user = store.open();
  const p = () => store.find(user.token);
  const action = (action, extra = {}, rng) =>
    R.mutate(
      store,
      user.token,
      { action, requestId: randomUUID(), rulesVersion: rules.version, ...extra },
      rng,
    );
  const tickets = (count) => {
    p().level += count;
    p().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(
      p().level,
    );
    R.grantLevels(p(), p().level - count);
  };
  return { store, user, p, action, tickets };
}
test("Колесо содержит 14 призов, 3 разных бустера каждой категории, количество включительно", () => {
  for (const max of [false, true]) {
    const offer = R.makeOffer(NOW, (n) => (max ? n - 1 : 0));
    assert.equal(offer.slots.length, 14);
    assert.equal(offer.rulesVersion, rules.version);
    assert.ok(!offer.slots.some((s) => s.category === "common"));
    for (const slot of offer.slots) {
      if (slot.category === "advanced") assert.equal(slot.amount, max ? 20 : 10);
      if (slot.category === "rare") assert.equal(slot.amount, max ? 15 : 7);
    }
    for (const spec of rules.categories.filter((c) => c.min)) {
      const slots = offer.slots.filter((s) => s.category === spec.id);
      assert.equal(slots.length, 3);
      assert.equal(new Set(slots.map((s) => s.boosterId)).size, 3);
      assert.ok(slots.every((s) => s.amount === (max ? spec.max : spec.min)));
      assert.ok(
        slots.every(
          (s) =>
            require("../../src/server/boosters/booster-catalog").BOOSTERS.get(s.boosterId).tier ===
            spec.id,
        ),
      );
    }
  }
});
test("Точная вероятность каждой категории, VIP ровно 2%; слот внутри категории выбирается отдельно", () => {
  const offer = R.makeOffer(NOW, () => 0),
    counts = {};
  for (let roll = 0; roll < 6000; roll++) {
    let call = 0;
    const index = R.pick(offer, (n) => (call++ === 0 ? roll : n - 1));
    const category = offer.slots[index].category;
    counts[category] = (counts[category] || 0) + 1;
    assert.equal(
      index,
      offer.slots.findLastIndex((s) => s.category === category),
    );
  }
  for (const c of rules.categories) assert.equal(counts[c.id], c.weight);
  assert.deepEqual(counts, {
    vip: 120,
    coins: 1225,
    crystals: 490,
    advanced: 1715,
    clan: 980,
    rare: 1470,
  });
});

function legacyOffer(version = 1) {
  const slots = [
    "vip",
    "common",
    "coins",
    "advanced",
    "rare",
    "crystals",
    "common",
    "coins",
    "advanced",
    "rare",
    "crystals",
    "common",
    "advanced",
    "rare",
  ];
  if (version === 2) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === "rare") slots[i] = "clan";
      else if (slots[i] === "common") slots[i] = "rare";
    }
  }
  const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
  const pools = Object.fromEntries(
    ["common", "rare", "advanced", "clan"].map((tier) => [
      tier,
      [...BOOSTERS.values()].filter((b) => b.ready && b.tier === tier),
    ]),
  );
  let coins = 0,
    crystals = 0;
  return {
    id: randomUUID(),
    ...(version === 2 ? { rulesVersion: 2 } : {}),
    at: NOW,
    slots: slots.map((category) => {
      if (category === "vip") return { category, amount: 3600000 };
      if (category === "coins") return { category, amount: coins++ ? 50 : 100 };
      if (category === "crystals") return { category, amount: crystals++ ? 15 : 10 };
      return {
        category,
        amount: (version === 2
          ? { rare: 20, clan: 10, advanced: 15 }
          : { common: 10, rare: 5, advanced: 7 })[category],
        boosterId: pools[category].shift().id,
      };
    }),
  };
}

for (const version of [1, 2])
  test(`Результаты версии ${version} переживают обновление и повтор запроса; старый предпросмотр заменяется без списания`, (t) => {
    const file = path.join(temporary(t, "roulette-legacy"), "profiles.json"),
      f = fixture(file);
    f.tickets(3);
    const old = legacyOffer(version),
      requestId = randomUUID(),
      p = f.p();
    p.roulette.tickets--;
    p.roulette.spent++;
    p.roulette.results[requestId] = { requestId, at: NOW, offer: old, index: 4 };
    p.roulette.lastRequestId = requestId;
    p.receipts[requestId] = JSON.stringify(["roulette", "spin", old.id]);
    p.inventory[old.slots[4].boosterId] = old.slots[4].amount;
    p.roulette.offer = legacyOffer(version);
    R.validate(p);
    f.store.save(f.store.data);
    const disk = new ProfileStore({
      filePath: file,
      now: () => NOW,
      rouletteConfig: { testEnabled: true },
    });
    const before = structuredClone(disk.find(f.user.token));
    assert.deepEqual(before, p);
    assert.equal(disk.view(before).roulette.offer, null);
    const repeat = R.mutate(disk, f.user.token, { action: "spin", offerId: old.id, requestId });
    assert.equal(repeat.replay, true);
    assert.equal(repeat.result.reward.boosterId, old.slots[4].boosterId);
    assert.equal(repeat.result.reward.amount, old.slots[4].amount);
    assert.deepEqual(disk.find(f.user.token), before);
    assert.throws(
      () => R.mutate(disk, f.user.token, { action: "prepare", requestId: randomUUID() }),
      /Обнови страницу/,
    );
    assert.throws(
      () =>
        R.mutate(disk, f.user.token, {
          action: "spin",
          requestId: randomUUID(),
          offerId: before.roulette.offer.id,
          rulesVersion: rules.version,
        }),
      /обновилось/,
    );
    const prepared = R.mutate(disk, f.user.token, {
      action: "prepare",
      requestId: randomUUID(),
      rulesVersion: rules.version,
    });
    assert.equal(prepared.profile.roulette.offer.rulesVersion, rules.version);
    assert.equal(
      prepared.profile.roulette.offer.slots.filter((s) => s.category === "clan").length,
      3,
    );
    assert.equal(prepared.profile.roulette.tickets, before.roulette.tickets);
    assert.deepEqual(disk.find(f.user.token).roulette.results, before.roulette.results);
    assert.deepEqual(disk.find(f.user.token).inventory, before.inventory);
    const reloaded = new ProfileStore({ filePath: file, now: () => NOW });
    assert.deepEqual(reloaded.find(f.user.token).roulette, disk.find(f.user.token).roulette);
    const invalid = structuredClone(reloaded.find(f.user.token));
    invalid.roulette.offer.rulesVersion = 999;
    assert.throws(() => R.validate(invalid), /рулетки/);
  });
test("Пять выигрышей версии 2 восстанавливаются и повторяются после обновления без повторной выдачи", (t) => {
  const file = path.join(temporary(t, "roulette-legacy-batch"), "profiles.json"),
    f = fixture(file);
  f.tickets(10);
  const requestId = randomUUID(),
    spins = [1, 3, 4, 1, 3].map((index) => ({ offer: legacyOffer(2), index })),
    p = f.p();
  p.roulette.tickets -= 5;
  p.roulette.spent += 5;
  p.roulette.results[requestId] = {
    requestId,
    at: NOW,
    ...spins[0],
    extraSpins: spins.slice(1),
  };
  p.roulette.lastRequestId = requestId;
  p.receipts[requestId] = JSON.stringify(["roulette", "spin-five", spins[0].offer.id]);
  for (const spin of spins) {
    const reward = spin.offer.slots[spin.index];
    p.inventory[reward.boosterId] = (p.inventory[reward.boosterId] || 0) + reward.amount;
  }
  f.store.save(f.store.data);
  const restored = new ProfileStore({ filePath: file, now: () => NOW });
  assert.deepEqual(restored.find(f.user.token), p);
  const repeat = R.mutate(restored, f.user.token, {
    action: "spin-five",
    requestId,
    offerId: spins[0].offer.id,
    rulesVersion: 2,
  });
  assert.equal(repeat.replay, true);
  assert.deepEqual(
    repeat.result.spins.map((spin) => spin.reward.amount),
    [20, 15, 10, 20, 15],
  );
  assert.deepEqual(restored.find(f.user.token), p);
});
test("Новые уровни начисляют билеты только после завершения жизни, повтор события не начисляет снова", () => {
  const f = fixture(),
    id = randomUUID(),
    profileId = f.user.profile.id;
  f.store.startLife(profileId, id);
  f.store.applyArenaProgress(
    randomUUID(),
    [{ type: "survivalMinute", profileId, lifeId: id, mass: 500000, minutes: 4 }],
    NOW,
  );
  assert.equal(f.p().roulette.tickets, 0);
  const event = { type: "lifeEnded", profileId, lifeId: id, durationSeconds: 240, reason: "quit" };
  f.store.applyArenaProgress(randomUUID(), [event], NOW);
  assert.equal(f.p().level, 2);
  assert.equal(f.p().roulette.tickets, f.p().level - 1);
  const before = structuredClone(f.p().roulette);
  f.store.applyArenaProgress(randomUUID(), [event], NOW);
  assert.deepEqual(f.p().roulette, before);
});
test("Миграция v12 сохраняет имущество и не начисляет билеты за прошлые уровни", (t) => {
  const file = path.join(temporary(t, "roulette-migration"), "profiles.json"),
    f = fixture(file);
  f.p().level = 1;
  const old = structuredClone(f.store.data);
  old.version = 12;
  for (const p of Object.values(old.profiles)) delete p.roulette;
  fs.writeFileSync(file, JSON.stringify(old));
  const disk = new ProfileStore({ filePath: file, now: () => NOW });
  assert.equal(disk.data.version, 13);
  assert.equal(disk.find(f.user.token).roulette.tickets, 0);
  const copy = structuredClone(disk.data);
  copy.version = 12;
  for (const p of Object.values(copy.profiles)) delete p.roulette;
  assert.deepEqual(copy, old);
  disk.refreshCompetition();
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.values(saved.profiles)[0].roulette.tickets = -1;
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.throws(() => new ProfileStore({ filePath: file }), /рулетки/);
});
test("Все категории начисляют ровно указанный приз, повтор и восстановление результата безопасны", (t) => {
  const file = path.join(temporary(t, "roulette-replay"), "profiles.json"),
    f = fixture(file);
  f.tickets(8);
  let boundary = 0;
  for (const category of rules.categories) {
    const preview = f.action("prepare").profile.roulette.offer;
    const before = structuredClone(f.p());
    const request = { requestId: randomUUID(), offerId: preview.id };
    let call = 0;
    const spin = f.action("spin", request, () => (call++ === 0 ? boundary : 0));
    boundary += category.weight;
    const reward = spin.result.reward;
    assert.equal(reward.category, category.id);
    assert.equal(f.p().roulette.tickets, before.roulette.tickets - 1);
    if (["coins", "crystals"].includes(category.id))
      assert.equal(f.p().wallet[category.id] - before.wallet[category.id], reward.amount);
    else if (category.id === "vip") assert.equal(f.p().account.vipUntil, NOW + rules.vipMs);
    else
      assert.equal(
        f.p().inventory[reward.boosterId] - (before.inventory[reward.boosterId] || 0),
        reward.amount,
      );
    const after = structuredClone(f.p());
    assert.deepEqual(f.action("spin", request).result, spin.result);
    assert.deepEqual(f.p(), after);
    const restored = new ProfileStore({ filePath: file, now: () => NOW });
    assert.deepEqual(
      R.mutate(restored, f.user.token, { action: "spin", ...request }).result,
      spin.result,
    );
    assert.throws(() => f.action("spin", { ...request, offerId: "different" }), /номер/);
    assert.throws(() => f.action("spin", { offerId: preview.id }), /обновилось/);
  }
});
test("Отказ записи не списывает билет и не выдаёт приз; повтор после восстановления выполняется один раз", (t) => {
  const file = path.join(temporary(t, "roulette-write"), "profiles.json"),
    f = fixture(file);
  f.tickets(1);
  const offerId = f.action("prepare").profile.roulette.offer.id;
  const before = structuredClone(f.p()),
    disk = fs.readFileSync(file, "utf8"),
    original = fs.renameSync;
  fs.renameSync = () => {
    throw Error("SIMULATED_DISK_FAILURE");
  };
  const requestId = randomUUID();
  try {
    assert.throws(() => f.action("spin", { offerId, requestId }), /DISK_FAILURE/);
  } finally {
    fs.renameSync = original;
  }
  assert.deepEqual(f.p(), before);
  assert.equal(fs.readFileSync(file, "utf8"), disk);
  const success = f.action("spin", { offerId, requestId });
  assert.equal(f.p().roulette.tickets, 0);
  assert.deepEqual(f.action("spin", { offerId, requestId }).result, success.result);
});
test("Закрытые события, отсутствие билетов, арена и переполнение не меняют имущество", () => {
  const f = fixture();
  const offerId = f.action("prepare").profile.roulette.offer.id;
  assert.throws(() => f.action("spin", { offerId }), /билет/);
  f.tickets(1);
  f.p().wallet.coins = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(f.p());
  let call = 0;
  assert.throws(() => f.action("spin", { offerId }, () => (call++ === 0 ? 120 : 0)), /баланс/);
  assert.deepEqual(f.p(), before);
  f.store.rouletteConfig = R.configuration({ events: [{ startsAt: NOW + 1, endsAt: NOW + 10 }] });
  assert.throws(() => f.action("spin", { offerId }), /события/);
  assert.equal(R.available(f.store.rouletteConfig, NOW + 1), true);
  assert.equal(R.available(f.store.rouletteConfig, NOW + 10), false);
  f.store.rouletteConfig = R.configuration({ testEnabled: true });
  f.store.startLife(f.user.profile.id, randomUUID());
  assert.throws(() => f.action("spin", { offerId }), /лобби/);
});
