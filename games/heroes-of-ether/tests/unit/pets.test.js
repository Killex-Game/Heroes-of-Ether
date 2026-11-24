"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  service = require("../../src/server/pets/pet-service"),
  pets = require("../../src/server/pets/arena-pets"),
  R = require("../../public/shared/pet-rules"),
  { Arena, radiusForMass, massLimitForLevel } = require("../../src/server/arena/arena-simulation"),
  { BOOSTERS } = require("../../src/server/boosters/booster-catalog"),
  { temporary } = require("../temp");
const INITIAL = Date.UTC(2026, 9, 23, 8);
function fixture(filePath = null, events = []) {
  let time = INITIAL;
  const store = new ProfileStore({ filePath, now: () => time, petEvents: events }),
    session = store.open();
  const get = () => store.find(session.token);
  get().level = 12;
  get().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  get().wallet = { coins: 30000, crystals: 3000, bucks: 5000 };
  const action = (action, petId, requestId = randomUUID()) =>
    service.mutate(store, session.token, { action, petId, requestId });
  const event = (type, lifeId, durationSeconds = 0, batch = randomUUID()) =>
    store.applyArenaProgress(
      batch,
      [{ type, lifeId, durationSeconds, profileId: session.profile.id }],
      time,
    );
  return { store, session, get, action, event, set: (n) => (time = INITIAL + n) };
}
test("pet balance: training, all thresholds, maximum stats and Q/R starting stocks", () => {
  for (const [n, l] of [
    [0, 0],
    [99, 0],
    [100, 1],
    [499, 1],
    [500, 2],
    [999, 2],
    [1000, 3],
    [2500, 4],
    [5000, 5],
  ])
    assert.equal(R.level(n), l);
  assert.deepEqual(R.stats("drakosha", 0), R.stats("drakosha", 99));
  for (let i = 0; i < 5; i++) {
    assert.equal(R.stats("manya", R.thresholds[i]).firePercent, [53, 57, 60, 65, 70][i]);
    assert.equal(R.stats("drakosha", R.thresholds[i]).firePercent, [55, 59, 62, 67, 72][i]);
    assert.equal(R.stats("zaya", R.thresholds[i]).intervalMs, 60000 - i * 10000);
    assert.equal(
      R.stats("manya", R.thresholds[i]).intervalMs,
      [50000, 40000, 30000, 20000, 20000][i],
    );
  }
  const d = R.stats("drakosha", 5000),
    m = R.stats("manya", 5000);
  assert.equal(d.speed, 15);
  assert.equal(d.mass, 1000);
  assert.equal(d.start.fire, 8);
  assert.equal(d.start.glove, 10);
  assert.equal(m.intervalMs, 20000);
  assert.equal(m.mass, 1500);
  assert.equal(m.resistance, 15);
  assert.equal(m.start.fire, 11);
  assert.equal(m.start.claw, 11);
  assert.equal(m.start.glove, 11);
});
test("purchases, separate currencies, ownership, food and operation replay are atomic and journalled", () => {
  const f = fixture(),
    id = randomUUID();
  f.action("buy", "zaya", id);
  assert.equal(f.get().wallet.coins, 20000);
  assert.equal(f.get().pets.equipped, "zaya");
  assert.equal(f.action("buy", "zaya", id).replay, true);
  assert.equal(f.get().wallet.coins, 20000);
  assert.throws(() => f.action("food", null, id), /другой операции/);
  assert.throws(() => f.action("buy", "zaya"), /уже/);
  f.action("buy", "leva");
  assert.equal(f.get().wallet.crystals, 2000);
  f.action("buy", "drakosha");
  f.action("buy", "manya");
  assert.equal(f.get().wallet.bucks, 2500);
  assert.equal(f.get().activity.claimed.pet_nursery, 4);
  assert.equal(f.get().activity.claimed.pet_exclusive, 2);
  const foodId = randomUUID();
  f.action("food", null, foodId);
  assert.equal(f.get().pets.food, 1);
  assert.equal(f.action("food", null, foodId).replay, true);
  assert.equal(f.get().pets.food, 1);
  assert.equal(f.get().wallet.crystals, 1900);
  assert.equal(f.get().transactions.entries.filter((e) => /Питомец:/.test(e.label)).length, 4);
  assert.equal(
    f.get().transactions.entries.filter((e) => e.label === "Корм питомцам: 1 порция").length,
    1,
  );
  assert.throws(() => f.action("feed", "zaya"), /полон/);
  assert.equal(f.get().pets.food, 1);
  f.get().pets.owned.zaya.vitalityMs = 1;
  f.action("feed", "zaya");
  assert.equal(f.get().pets.owned.zaya.vitalityMs, 180001);
  assert.equal(f.get().pets.feeds, 1);
  assert.equal(f.get().pets.food, 0);
  assert.throws(() => f.action("feed", "zaya"), /Нужен корм/);
  f.action("unequip");
  assert.equal(f.get().pets.equipped, null);
  f.action("equip", "manya");
  assert.equal(f.get().pets.equipped, "manya");
  service.validate(f.get());
});
test("one food portion costs 100 crystals; insufficient funds and a full stock do not spend", () => {
  const f = fixture();
  f.get().wallet.crystals = 99;
  let before = structuredClone(f.get());
  assert.throws(() => f.action("food", null), /Недостаточно/);
  assert.deepEqual(f.get(), before);
  f.get().wallet.crystals = 200;
  f.get().pets.food = 999999;
  f.action("food", null);
  assert.equal(f.get().pets.food, 1000000);
  assert.equal(f.get().wallet.crystals, 100);
  before = structuredClone(f.get());
  assert.throws(() => f.action("food", null), /заполнен/);
  assert.deepEqual(f.get(), before);
});

test("a pet game needs more than one active minute; repeated end, short lives and no pet do not count", () => {
  const f = fixture();
  f.action("buy", "zaya");
  f.event("lifeStarted", "one");
  f.set(60000);
  f.event("lifeTime", "one", 60);
  f.event("lifeEnded", "one", 60);
  assert.equal(f.get().pets.games, 0);
  f.event("lifeStarted", "two");
  f.set(121000);
  f.event("lifeTime", "two", 61);
  f.event("lifeEnded", "two", 61);
  f.event("lifeEnded", "two", 61);
  assert.equal(f.get().pets.games, 1);
  assert.equal(f.get().pets.owned.zaya.vitalityMs, 1800000 - 121000);
  f.get().pets.owned.zaya.vitalityMs = 30000;
  f.event("lifeStarted", "empty");
  f.set(221000);
  f.event("lifeEnded", "empty", 100);
  assert.equal(f.get().pets.games, 1);
  assert.equal(f.get().pets.owned.zaya.vitalityMs, 0);
  f.action("unequip");
  f.event("lifeStarted", "none");
  f.event("lifeEnded", "none", 100);
  assert.equal(f.get().pets.games, 1);
});
test("energy drains only on arena, splits refill boundaries and stays identical across tick frequencies", () => {
  const a = { vitalityMs: 1000, refillAt: 5000 },
    b = { ...a };
  assert.equal(R.advance(a, 3600000, 0, 7000, true), 3000);
  let used = 0;
  for (let n = 0; n < 7000; n += 100) used += R.advance(b, 3600000, n, n + 100, true);
  assert.equal(used, 3000);
  assert.deepEqual(a, b);
  assert.equal(a.vitalityMs, 3598000);
  R.advance(a, 3600000, 7000, 5000 + R.REFILL_MS * 100, false);
  assert.equal(a.vitalityMs, 3600000);
  assert.equal(a.refillAt, 5000 + R.REFILL_MS * 101);
});
test("60 seconds exactly do not count; a completed life of 60001 ms does", () => {
  const f = fixture();
  f.action("buy", "zaya");
  f.event("lifeStarted", "exact");
  f.store.applyArenaProgress(
    randomUUID(),
    [
      {
        type: "lifeEnded",
        profileId: f.session.profile.id,
        lifeId: "exact",
        durationSeconds: 60,
        durationMs: 60001,
      },
    ],
    INITIAL + 60001,
  );
  assert.equal(f.get().pets.games, 1);
  assert.equal(f.get().pets.owned.zaya.vitalityMs, 1800000 - 60001);
});
test("pet collection keeps cumulative thresholds; feeder and trainer require fresh progress for every degree", () => {
  const f = fixture();
  for (const def of R.pets) f.action("buy", def.id);
  for (const pet of Object.values(f.get().pets.owned)) pet.games = 5000;
  f.get().pets.games = 8999;
  f.get().pets.feeds = 409;
  f.get().pets.food = 1;
  f.get().pets.owned.zaya.vitalityMs = 1;
  f.action("feed", "zaya");
  assert.equal(f.get().activity.claimed.pet_master, 4);
  assert.equal(f.get().activity.claimed.pet_feeder, 4);
  f.event("lifeStarted", "final");
  f.set(61000);
  f.event("lifeEnded", "final", 61);
  assert.equal(f.get().activity.claimed.pet_trainer, 4);
  const greatness = f.get().greatness;
  f.event("lifeEnded", "final", 61);
  assert.equal(f.get().greatness, greatness);
});
test("scheduled events use the server clock for Manya discount and double valid games", () => {
  const f = fixture(null, [{ id: "koteyka", startsAt: INITIAL, endsAt: INITIAL + 70000 }]);
  f.action("buy", "manya");
  assert.equal(f.get().wallet.bucks, 3200);
  f.event("lifeStarted", "event");
  f.set(61000);
  f.event("lifeEnded", "event", 61);
  assert.equal(f.get().pets.games, 2);
  f.set(70000);
  assert.equal(service.view(f.get(), INITIAL + 70000, f.store.petEvents).event, null);
  const g = fixture(null, [{ id: "fortune", startsAt: INITIAL, endsAt: INITIAL + 70000 }]);
  g.action("buy", "manya");
  assert.equal(g.get().wallet.bucks, 3100);
});
test("failed disk write does not spend currencies or feed; retry and restart retain only committed state", (t) => {
  const file = path.join(temporary(t, "pets"), "profiles.json"),
    f = fixture(file),
    id = randomUUID(),
    foodId = randomUUID();
  f.store.save(f.store.data);
  const before = structuredClone(f.get()),
    disk = fs.readFileSync(file, "utf8"),
    rename = fs.renameSync;
  fs.renameSync = () => {
    throw Error("disk full");
  };
  try {
    assert.throws(() => f.action("buy", "manya", id), /disk full/);
    assert.throws(() => f.action("food", null, foodId), /disk full/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(f.get(), before);
  assert.equal(fs.readFileSync(file, "utf8"), disk);
  f.action("buy", "manya", id);
  f.action("food", null, foodId);
  let recovered = new ProfileStore({ filePath: file, now: () => INITIAL });
  assert.equal(
    service.mutate(recovered, f.session.token, { action: "buy", petId: "manya", requestId: id })
      .replay,
    true,
  );
  assert.equal(recovered.find(f.session.token).wallet.bucks, 3000);
  assert.equal(
    service.mutate(recovered, f.session.token, { action: "food", requestId: foodId }).replay,
    true,
  );
  assert.equal(recovered.find(f.session.token).pets.food, 1);
  assert.equal(recovered.find(f.session.token).wallet.crystals, 2900);
  f.event("lifeStarted", "crash");
  f.set(65000);
  f.event("lifeTime", "crash", 65);
  recovered = new ProfileStore({ filePath: file, now: () => INITIAL + 10 * 3600000 });
  recovered.refreshCompetition();
  assert.equal(recovered.find(f.session.token).pets.games, 1);
  assert.equal(recovered.find(f.session.token).pets.life, null);
  recovered = new ProfileStore({ filePath: file, now: () => INITIAL + 10 * 3600000 });
  assert.equal(recovered.find(f.session.token).pets.games, 1);
});
test("v11 migration adds empty pets without changing property; malformed v12 pet saves are rejected", (t) => {
  const file = path.join(temporary(t, "pet-migration"), "profiles.json"),
    f = fixture();
  f.store.save(f.store.data);
  const old = structuredClone(f.store.data);
  old.version = 11;
  for (const p of Object.values(old.profiles)) {
    delete p.pets;
    for (const key of Object.keys(p.activity.values).filter((k) => k.startsWith("pet_"))) {
      delete p.activity.values[key];
      delete p.activity.claimed[key];
      delete p.activity.stageSpent[key];
    }
  }
  fs.writeFileSync(file, JSON.stringify(old));
  const migrated = new ProfileStore({ filePath: file, now: () => INITIAL });
  assert.equal(migrated.data.version, 13);
  assert.deepEqual(migrated.find(f.session.token).wallet, f.get().wallet);
  assert.deepEqual(migrated.find(f.session.token).pets, service.fresh());
  migrated.refreshCompetition();
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.values(data.profiles)[0].pets.food = -1;
  fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => new ProfileStore({ filePath: file }), /питомцев/);
});
function arenaFixture(id = "manya", games = 5000, vip = false) {
  const f = fixture();
  f.action("buy", id);
  f.get().pets.owned[id].games = games;
  if (vip)
    f.get().account = {
      vipUntil: 0,
      vipUntil: INITIAL + 10000000,
      dailyDay: null,
      dailyAmount: 0,
    };
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "sender", { vip });
  p.level = 100;
  p.protectedUntil = 0;
  Object.assign(p, { x: 500, y: 500, targetX: 500, targetY: 500 });
  pets.start(p, f.get(), 0, INITIAL);
  const target = arena.addPlayer(0, "victim");
  target.level = 100;
  Object.assign(target, {
    x: 700,
    y: 500,
    targetX: 700,
    targetY: 500,
    mass: 1000,
    radius: radiusForMass(1000),
    protectedUntil: 0,
  });
  return { ...f, arena, p, target };
}
function setParts(arena, p, masses) {
  p.parts = masses.map((mass, i) => ({
    id: `pet-part-${i}`,
    mass,
    radius: radiusForMass(mass),
    x: 500 + i * 20,
    y: 500,
    vx: 0,
    vy: 0,
    mergeAt: Infinity,
  }));
  arena.syncParts(p);
}

test("pet shield progression applies the normal shield type and duration at each level", () => {
  const expected = {
    zaya: ["colorful_shield", "colorful_shield", "sphere", "golden_shield", "clan_shield"],
    leva: ["colorful_shield", "sphere", "golden_shield", "golden_shield", "clan_shield"],
    drakosha: ["colorful_shield", "sphere", "golden_shield", "clan_shield", "clan_shield"],
    manya: ["golden_shield", "golden_shield", "clan_shield", "clan_shield", "clan_shield"],
  };
  for (const [id, shields] of Object.entries(expected)) {
    for (const [level, games] of [0, ...R.thresholds].entries()) {
      const { arena, p } = arenaFixture(id, games);
      const shieldId = level ? shields[level - 1] : "colorful_shield";
      const interval = p.pet.stats.intervalMs;
      pets.tick(arena, p, interval - 1);
      assert.equal(arena.hasEffect(p, "shield", interval - 1), false);
      pets.tick(arena, p, interval);
      assert.equal(
        p.effects[shieldId],
        interval + BOOSTERS.get(shieldId).durationMs,
        `${id}, level=${level}`,
      );
      assert.equal(Object.keys(p.effects).filter((key) => R.shields[key]).length, 1);
      assert.ok(arena.hasEffect(p, "shield", interval));
      pets.tick(arena, p, interval);
      assert.equal(p.effects[shieldId], interval + BOOSTERS.get(shieldId).durationMs);
    }
  }
});

test("pet shield gifts preserve existing protection and do not refresh it while still active", () => {
  for (const existing of Object.keys(R.shields)) {
    const { arena, p } = arenaFixture("manya", 5000);
    p.effects[existing] = 90000;
    const mass = p.mass;
    pets.tick(arena, p, 20000);
    assert.equal(p.effects[existing], 90000);
    assert.deepEqual(
      Object.keys(p.effects).filter((key) => R.shields[key]),
      [existing],
    );
    assert.equal(p.mass, mass + 1500);
  }
});

test("pet gifts at every level divide evenly across unequal active parts without losing the remainder", () => {
  for (const id of ["leva", "drakosha", "manya"]) {
    for (const games of [0, ...R.thresholds]) {
      for (const count of [3, 16]) {
        const { arena, p } = arenaFixture(id, games),
          before = Array.from({ length: count }, (_, i) => 100 + i * 30),
          { mass, intervalMs } = p.pet.stats;
        setParts(arena, p, before);
        pets.tick(arena, p, intervalMs);
        const gains = p.parts.map((part, i) => part.mass - before[i]);
        assert.equal(
          gains.reduce((sum, n) => sum + n, 0),
          mass,
          `${id}, games=${games}`,
        );
        assert.ok(Math.max(...gains) - Math.min(...gains) <= 1);
        assert.equal(p.mass, before.reduce((sum, n) => sum + n, 0) + mass);
        assert.equal(p.radius, radiusForMass(p.mass));
        for (const part of p.parts) assert.equal(part.radius, radiusForMass(part.mass));
        assert.ok(arena.hasEffect(p, "shield", intervalMs));
        const once = p.parts.map((part) => part.mass);
        pets.tick(arena, p, intervalMs);
        assert.deepEqual(
          p.parts.map((part) => part.mass),
          once,
        );
      }
    }
  }
});

test("pet gifts redistribute capped shares and respect every player-level mass limit", () => {
  for (const level of [1, 100, 500, 555]) {
    const { arena, p } = arenaFixture();
    p.level = level;
    const limit = massLimitForLevel(level);
    setParts(arena, p, [limit, limit - 5, 100, 1000]);
    pets.tick(arena, p, 20000);
    assert.deepEqual(
      p.parts.map((part) => part.mass),
      [limit, limit, 847, 1748],
    );
    setParts(arena, p, [limit - 1, limit - 2]);
    pets.tick(arena, p, 40000);
    assert.deepEqual(
      p.parts.map((part) => part.mass),
      [limit, limit],
    );
    pets.tick(arena, p, 60000);
    assert.deepEqual(
      p.parts.map((part) => part.mass),
      [limit, limit],
    );
    assert.ok(arena.hasEffect(p, "shield", 60000));
  }
});

test("each pet gift uses the current parts after absorption and merging", () => {
  const { arena, p } = arenaFixture();
  setParts(arena, p, [100, 200, 300, 400]);
  pets.tick(arena, p, 20000);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [475, 575, 675, 775],
  );
  const removed = p.parts.splice(1, 1)[0];
  arena.syncParts(p);
  pets.tick(arena, p, 40000);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [975, 1175, 1275],
  );
  assert.equal(removed.mass, 575);
  setParts(arena, p, [p.mass]);
  assert.equal(p.parts, null);
  const before = p.mass;
  pets.tick(arena, p, 60000);
  assert.equal(p.mass, before + 1500);
  p.dead = true;
  pets.tick(arena, p, 80000);
  assert.equal(p.mass, before + 1500);
});
test("Маня: обучение получает 5, уровни получают 7/8/9/10/11 стартовых бустеров", () => {
  for (const [games, count] of [
    [0, 5],
    [99, 5],
    [100, 7],
    [500, 8],
    [1000, 9],
    [2500, 10],
    [5000, 11],
  ]) {
    for (const vip of [false, true]) {
      const { p } = arenaFixture("manya", games, vip);
      assert.deepEqual(p.pet.stock, { fire: count, claw: count, glove: count, carrot: 0 });
    }
  }
});

test("Маня с VIP: ровно одна порция каждого вида за 60 активных секунд, без дублей", () => {
  const { arena, p } = arenaFixture("manya", 0, true);
  for (const at of [29999, 30000, 59999]) {
    pets.tick(arena, p, at);
    assert.deepEqual(p.pet.stock, { fire: 5, claw: 5, glove: 5, carrot: 0 });
  }
  pets.tick(arena, p, 60000);
  assert.deepEqual(p.pet.stock, { fire: 6, claw: 6, glove: 6, carrot: 0 });
  pets.tick(arena, p, 180000);
  assert.deepEqual(p.pet.stock, { fire: 8, claw: 8, glove: 8, carrot: 0 });
  pets.tick(arena, p, 180000);
  p.account.vip = false;
  pets.tick(arena, p, 240000);
  assert.deepEqual(p.pet.stock, { fire: 8, claw: 8, glove: 8, carrot: 0 });
  p.account.vip = true;
  pets.tick(arena, p, 299999);
  assert.equal(p.pet.stock.fire, 8);
  pets.tick(arena, p, 300000);
  assert.deepEqual(p.pet.stock, { fire: 9, claw: 9, glove: 9, carrot: 0 });
});

test("VIP: истощённая Маня не выдаёт запас, остальные питомцы сохраняют интервал 30 секунд", () => {
  const { arena, p } = arenaFixture("manya", 0, true);
  p.pet.vitalityMs = 40000;
  pets.tick(arena, p, 60000);
  assert.equal(p.pet.stock.fire, 5);
  p.pet.vitalityMs = 20000;
  pets.tick(arena, p, 80000);
  assert.equal(p.pet.stock.fire, 6);
  for (const [id, kinds] of [
    ["zaya", ["carrot"]],
    ["leva", ["glove"]],
    ["drakosha", ["fire", "glove"]],
  ]) {
    const f = arenaFixture(id, 0, true),
      before = { ...f.p.pet.stock };
    pets.tick(f.arena, f.p, 29999);
    assert.deepEqual(f.p.pet.stock, before);
    pets.tick(f.arena, f.p, 30000);
    for (const kind of kinds) before[kind]++;
    assert.deepEqual(f.p.pet.stock, before);
  }
});

test("periodic shield/mass, VIP generation, exhaustion and passive boosts", () => {
  const { arena, p } = arenaFixture("manya", 5000, true),
    mass = p.mass;
  p.account.vip = true;
  pets.tick(arena, p, 10000);
  assert.equal(p.mass, mass);
  assert.equal(arena.hasEffect(p, "shield", 10000), false);
  pets.tick(arena, p, 19999);
  assert.equal(p.mass, mass);
  pets.tick(arena, p, 20000);
  assert.equal(p.mass, mass + 1500);
  assert.ok(arena.hasEffect(p, "shield", 20000));
  assert.equal(pets.speed(p), 0.15);
  assert.equal(pets.damageFactor(p), 0.85);
  assert.equal(pets.positiveFactor(p), 1.2);
  pets.tick(arena, p, 30000);
  assert.equal(p.pet.stock.fire, 11);
  assert.equal(p.pet.stock.claw, 11);
  pets.tick(arena, p, 40000);
  assert.equal(p.mass, mass + 3000);
  assert.ok(arena.hasEffect(p, "shield", 40000));
  pets.tick(arena, p, 60000);
  assert.equal(p.mass, mass + 4500);
  assert.deepEqual(p.pet.stock, { fire: 12, claw: 12, glove: 12, carrot: 0 });
  p.account.vip = false;
  pets.tick(arena, p, 90000);
  assert.equal(p.pet.stock.fire, 12);
  assert.equal(pets.positiveFactor(p), 1);
  p.pet.vitalityMs = 0;
  const before = p.mass;
  pets.tick(arena, p, 100000);
  assert.equal(p.mass, before);
  assert.equal(pets.speed(p), 0);
  assert.equal(pets.damageFactor(p), 1);
});
const message = (p, ability, sequence = 1) => ({
  ability,
  sequence,
  requestId: randomUUID(),
  spawnSerial: p.spawnSerial,
  aimX: 900,
  aimY: 500,
});

test("Zaya carrot shares food, permits a full main part and rejects full players without spending", () => {
  const { arena, p } = arenaFixture("zaya", 0, true),
    limit = massLimitForLevel(p.level);
  p.pet.stock.carrot = 3;
  setParts(arena, p, [100, 200, 300]);
  const first = message(p, "sixth");
  pets.use(arena, p, first, 1000);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [266, 367, 467],
  );
  assert.equal(p.pet.stock.carrot, 2);
  assert.equal(pets.use(arena, p, first, 1000).replay, true);
  assert.equal(p.mass, 1100);
  assert.equal(p.pet.stock.carrot, 2);
  setParts(arena, p, [limit, 100, 200]);
  pets.use(arena, p, message(p, "sixth", 2), 1500);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [limit, 350, 450],
  );
  assert.equal(p.pet.stock.carrot, 1);
  setParts(arena, p, [limit, limit]);
  assert.throws(() => pets.use(arena, p, message(p, "sixth", 3), 2000), /предел массы/);
  assert.equal(p.pet.stock.carrot, 1);
  assert.equal(p.pet.sequence, 2);
});

test("Питомцевые запасы ждут 0,5 секунды, повтор запроса не расходует заряд", () => {
  for (const kind of ["fire", "claw", "glove", "carrot"]) {
    const { arena, p } = arenaFixture(kind === "carrot" ? "zaya" : "manya");
    p.pet.stock[kind] = 3;
    if (kind === "glove") p.pet.stock.claw = 0;
    const ability = kind === "fire" ? "fire" : kind === "carrot" ? "sixth" : "secondary";
    const first = message(p, ability);
    pets.use(arena, p, first, 5000);
    const repeat = message(p, ability, 2);
    assert.equal(pets.use(arena, p, first, 5000).replay, true);
    assert.equal(p.pet.stock[kind], 2, kind);
    assert.equal(pets.use(arena, p, first, 5299).replay, true);
    assert.equal(pets.snapshot(p, 5299).cooldowns[kind], 201);
    assert.throws(()=>pets.use(arena,p,repeat,5499),/мгновение|перезаряд/i);
    pets.use(arena,p,repeat,5500);
    assert.equal(p.pet.stock[kind], 1, kind);
    assert.equal(pets.snapshot(p, 5500).cooldowns[kind], 500);
  }
});

test("Огонь Q, коготь R и следующая перчатка R применяются сразу друг за другом", () => {
  const { arena, p } = arenaFixture();
  p.pet.stock.claw = 1;
  pets.use(arena, p, message(p, "fire", 1), 5000);
  pets.use(arena, p, message(p, "secondary", 2), 5000);
  pets.use(arena, p, message(p, "secondary", 3), 5000);
  assert.equal(p.pet.stock.claw, 0);
  assert.equal(p.pet.stock.glove, 10);
  assert.throws(()=>pets.use(arena,p,message(p,"secondary",4),5499),/мгновение|перезаряд/i);
  pets.use(arena,p,message(p,"secondary",4),5500);
  assert.equal(p.pet.stock.glove, 9);
});

test("Обычный и питомцевый огонь делят перезарядку одного бустера с раздельным расходом", () => {
  const { arena, p } = arenaFixture();
  const ordinary = { boosterId: "fire", spawnSerial: p.spawnSerial, aimX: 900, aimY: 500 };
  pets.use(arena, p, message(p, "fire", 1), 5000);
  assert.throws(() => arena.prepareBooster(p.id, ordinary, 5499),/Подожди/);
  arena.prepareBooster(p.id, ordinary, 5500)();
  assert.equal(pets.snapshot(p, 5500).cooldowns.fire, 500);
  assert.throws(() => pets.use(arena, p, message(p, "fire", 1), 5300), /обработан/);
  pets.use(arena, p, message(p, "fire", 2), 6000);
  assert.equal(p.pet.stock.fire, 9);
});
test("Q fire applies level damage at swept boundary; replay and stale lives never spend again", () => {
  const { arena, p, target } = arenaFixture(),
    m = message(p, "fire");
  pets.use(arena, p, m, 0);
  assert.equal(p.pet.stock.fire, 10);
  assert.equal(pets.use(arena, p, m, 200).replay, true);
  assert.equal(p.pet.stock.fire, 10);
  arena.combat.update(1000);
  assert.equal(target.dead, true);
  assert.equal(arena.combatEvents.filter(e => e.type === "burned").length, 1);
  arena.combat.update(1500);
  assert.equal(arena.combatEvents.filter(e => e.type === "burned").length, 1);
  assert.throws(
    () => pets.use(arena, p, { ...message(p, "fire", 2), spawnSerial: 99 }, 2000),
    /жизни/,
  );
  assert.throws(() => pets.use(arena, p, message(p, "fire", 1), 2000), /обработан/);
});

test("Огонь питомца уничтожает малую часть и завершает жизнь только после последней", () => {
  const { arena, p, target } = arenaFixture("drakosha", 0);
  target.parts = [
    { id: target.mainPartId, x: 700, y: 500 },
    { id: "other", x: 700, y: 800 },
  ].map((b) => ({ ...b, mass: 20, radius: radiusForMass(20) }));
  arena.syncParts(target);
  pets.use(arena, p, message(p, "fire"), 0);
  arena.combat.update(1000);
  assert.equal(target.dead, false);
  assert.equal(arena.bodies(target).length, 1);
  assert.equal(arena.bodyId(target, arena.mainBody(target)), "other");
  assert.equal(arena.combatEvents.length, 0);
  pets.use(arena, p, { ...message(p, "fire", 2), aimX: 700, aimY: 800 }, 2000);
  arena.combat.update(4000);
  assert.equal(target.dead, true);
  assert.equal(arena.combatEvents.filter((e) => e.type === "burned").length, 1);
  arena.combat.update(4500);
  assert.equal(arena.combatEvents.length, 1);
});
test("Огонь питомца соблюдает порог смерти, защиту появления, щиты и сопротивление обычного огня", () => {
  for (const mode of ["normal", "spawn", "shield", "resistance"]) {
    for (const mass of [2, 20, 49, 50, 51, 100, 299, 300, 301, 600]) {
      const outcomes = [];
      for (const petFire of [false, true]) {
        const { arena, p, target } = arenaFixture("drakosha", 0);
        Object.assign(target, { mass, radius: radiusForMass(mass) });
        if (mode === "spawn") target.protectedUntil = 5000;
        if (mode === "shield") target.effects.clan_shield = 5000;
        if (mode === "resistance") target.pet = { vitalityMs: 10000, stats: { resistance: 15 } };
        if (petFire) pets.use(arena, p, message(p, "fire"), 0);
        else
          arena.prepareBooster(
            p.id,
            {
              boosterId: "fire",
              spawnSerial: p.spawnSerial,
              aimX: 900,
              aimY: 500,
            },
            0,
          )();
        arena.combat.update(2000);
        outcomes.push({ mass: target.mass, dead: target.dead, events: arena.combatEvents.length });
        if (mode === "normal" || mode === "shield") assert.equal(target.dead, mass - Math.floor(mass / 2) <= 300);
      }
      assert.deepEqual(outcomes[0], outcomes[1], `${mode}, mass=${mass}`);
    }
  }
});
test("Огонь питомцев проходит 600, когти и перчатки 400 единиц, не поражая за пределом", () => {
  for (const [kind, standardId] of [
    ["fire", "fire"],
    ["claw", "awl"],
    ["glove", "axe"],
  ]) {
    const { arena, p, target } = arenaFixture();
    if (kind === "glove") p.pet.stock.claw = 0;
    Object.assign(target, { x: 1200, mass: 20, radius: radiusForMass(20) });
    pets.use(arena, p, message(p, kind === "fire" ? "fire" : "secondary"), 0);
    const shot = arena.combat.shots[0],
      start = shot.x;
    const range = BOOSTERS.get(standardId).maxDistance;
    assert.equal(range, kind === "fire" ? 600 : 400);
    assert.equal(shot.speed, 200, "existing pet projectile speed is preserved");
    arena.combat.update((range / shot.speed) * 1000 - 1);
    assert.equal(arena.combat.shots.length, 1);
    assert.ok(shot.x - start < range);
    arena.combat.update((range / shot.speed) * 1000 + 1);
    assert.equal(arena.combat.shots.length, 0);
    assert.ok(Math.abs(shot.x - start - range) < 1e-8);
    assert.equal(target.mass, 20);
    assert.equal(target.parts, null);
  }
});
test("R drains claws before gloves, removes protection then divides the struck body equally", () => {
  const { arena, p, target } = arenaFixture();
  p.pet.stock.claw = 1;
  target.effects.colorful_shield = 999999;
  pets.use(arena, p, message(p, "secondary"), 0);
  arena.combat.update(1000);
  assert.equal(arena.hasEffect(target, "shield", 1000), false);
  assert.equal(p.pet.stock.claw, 0);
  assert.equal(p.pet.stock.glove, 11);
  pets.use(arena, p, message(p, "secondary", 2), 1200);
  arena.combat.update(2200);
  assert.equal(p.pet.stock.glove, 10);
  assert.equal(target.parts.length, 2);
  assert.deepEqual(
    target.parts.map((b) => b.mass),
    [500, 500],
  );
});
test("Manya reduces enemy burn/poison, VIP boosts food; ordinary players keep original damage", () => {
  const { arena, p, target } = arenaFixture();
  p.mass = 1000;
  p.radius = radiusForMass(1000);
  arena.boosterEffects.burn(p, p, 0);
  assert.equal(p.mass, 575);
  arena.boosterEffects.apply(p, BOOSTERS.get("poison"), 0);
  assert.equal(p.damageTicks[0].budget, Math.floor(575 * 0.35 * 0.85));
  arena.boosterEffects.burn(target, target, 0);
  assert.equal(target.mass, 500);
});
test("Zaya VIP supplies R every 30 seconds; replay does not spend or grant twice", () => {
  const { arena, p, get } = arenaFixture("zaya", 0, true);
  p.account.vip = true;
  pets.tick(arena, p, 30000);
  assert.equal(p.pet.stock.carrot, 1);
  const before = p.mass;
  const request = message(p, "secondary");
  delete request.aimX;
  delete request.aimY;
  pets.use(arena, p, request, 30000);
  assert.equal(p.mass, before + 500);
  assert.equal(p.pet.stock.carrot, 0);
  assert.equal(get().inventory.pet_carrot, undefined);
  assert.equal(pets.use(arena, p, request, 30000).replay, true);
  assert.equal(p.mass, before + 500);
  pets.tick(arena, p, 59999);
  assert.equal(p.pet.stock.carrot, 0);
  pets.tick(arena, p, 60000);
  assert.equal(p.pet.stock.carrot, 1);
});
