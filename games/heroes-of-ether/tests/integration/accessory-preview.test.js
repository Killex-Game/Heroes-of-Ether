"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  path = require("node:path");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const config = require("../../config/accessory-preview.json");
const access = require("../../src/server/profiles/accessory-access");
const catalog = require("../../public/shared/accessory-catalog");
const A = require("../../src/server/arena/accessory-abilities");
const passive = require("../../src/server/arena/accessory-passives");
const { Arena, radiusForMass, massDecayLoss } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const progression = require("../../src/server/progression/experience-progression");
const accrual = require("../../src/server/arena/mass-accrual");
const pets = require("../../src/server/pets/pet-service");
const arenaPets = require("../../src/server/pets/arena-pets");
const rules = require("../../public/shared/pet-rules");
function fixture(t, filePath) {
  const store = new ProfileStore({ filePath }),
    auth = store.open(),
    p = store.find(auth.token);
  config.profileIds.push(p.id);
  t.after(() => config.profileIds.splice(config.profileIds.indexOf(p.id), 1));
  return { store, auth, p };
}
test("24 концепта: доступ по ID, автоматический порядок E, сохранение экипировки и отказ записи", (t) => {
  const file = path.join(temporary(t, "preview-accessories"), "profiles.json");
  const { store, auth, p } = fixture(t, file),
    wallet = structuredClone(p.wallet);
  assert.equal(catalog.items.filter((x) => x.previewOnly).length, 24);
  assert.equal(store.view(p).wardrobe.owned.length, 24);
  const stranger = store.find(store.open().token);
  stranger.name = "Killex";
  stranger.outfit = { hat: "captain_tricorn", bow: "sea_bow" };
  assert.deepEqual(access.outfit(stranger), { bow: null, hat: null });
  assert.equal(access.isOwned(stranger, "captain_tricorn"), false);
  for (const id of ["captain_tricorn", "sea_bow"])
    store.setAccessory(auth.token, {
      slot: catalog.item(id).slot,
      accessoryId: id,
      requestId: randomUUID(),
    });
  // Старый сохранённый выбор шапки не меняет очередь.
  store.find(auth.token).accessoryAbility = "captain_tricorn";
  store.save(store.data);
  assert.equal(store.view(store.find(auth.token)).wardrobe.ability, "sea_bow");
  assert.equal(access.ability(new ProfileStore({ filePath: file }).find(auth.token)), "sea_bow");
  assert.throws(
    () =>
      store.setAccessory(auth.token, {
        mode: "ability",
        accessoryId: "captain_tricorn",
        requestId: randomUUID(),
      }),
    /автоматически/,
  );
  const before = structuredClone(store.find(auth.token));
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(
    () =>
      store.setAccessory(auth.token, {
        slot: "bow",
        accessoryId: null,
        requestId: randomUUID(),
      }),
    /disk full/,
  );
  assert.deepEqual(store.find(auth.token), before);
  assert.deepEqual(store.find(auth.token).wallet, wallet);
  config.enabled = false;
  try {
    assert.deepEqual(access.outfit(store.find(auth.token)), { bow: null, hat: null });
    assert.equal(access.ability(store.find(auth.token)), null);
  } finally {
    config.enabled = true;
  }
});
test("Каждый новый активный аксессуар: заряд E, направление и отсутствие расхода инвентаря", (t) => {
  const { p } = fixture(t);
  for (const item of catalog.items.filter((x) => x.previewOnly && x.ability)) {
    const arena = new Arena({ etherCount: 0 }),
      actor = arena.addPlayer(0, "actor");
    actor.level = 501;
    arena.gainMass(actor, 1000 - actor.mass);
    actor.x = actor.y = 1000;
    arena.boosterEffects.split(actor, arena.mainBody(actor), 2, 0);
    p.outfit = { [item.slot]: item.id };
    A.start(actor, p);
    assert.equal(A.snapshot(actor)[0].count, 3, item.id);
    const op = {
      accessoryId: item.id,
      spawnSerial: actor.spawnSerial,
      requestId: randomUUID(),
      aimX: 2000,
      aimY: 1000,
    };
    A.use(arena, actor, op, 5000);
    assert.equal(A.snapshot(actor)[0].count, item.ability.count - 1, item.id);
    assert.equal(A.use(arena, actor, op, 5000).replay, true);
    assert.equal(actor.boosterUses[item.ability.boosterId] || 0, 0, item.id);
    if (BOOSTERS.get(item.ability.boosterId).target === "direction")
      assert.ok(arena.combat.shots[0].dx > 0, item.id);
    A.start(actor, p);
    assert.equal(A.snapshot(actor)[0].count, item.ability.count - 1);
  }
  const actor = {};
  p.outfit = { hat: "captain_tricorn", bow: "sea_bow" };
  p.accessoryAbility = "captain_tricorn";
  A.start(actor, p);
  assert.deepEqual(
    A.snapshot(actor).map((x) => x.boosterId),
    ["harpoon", "hook"],
  );
});
test("Три заряда бабочки расходуются перед шапкой; ошибка и повтор не меняют очередь", (t) => {
  const { p } = fixture(t),
    arena = new Arena({ etherCount: 0 }),
    actor = arena.addPlayer(0, "queue");
  p.outfit = { bow: "cherry_sweet", hat: "captain_tricorn" };
  p.accessoryAbility = "captain_tricorn";
  A.start(actor, p);
  const request = (accessoryId) => ({
    accessoryId,
    spawnSerial: actor.spawnSerial,
    requestId: randomUUID(),
    aimX: 2000,
    aimY: 1000,
  });
  const bow = request("cherry_sweet"),
    hat = request("captain_tricorn");
  const counts = () => A.snapshot(actor).map((x) => x.count);
  assert.deepEqual(counts(), [3, 3]);
  assert.throws(() => A.use(arena, actor, hat, 5000), /Сначала/);
  const prepare = arena.prepareBooster;
  arena.prepareBooster = () => {
    throw Error("Failed action");
  };
  assert.throws(() => A.use(arena, actor, bow, 5000), /Failed action/);
  assert.deepEqual(counts(), [3, 3]);
  arena.prepareBooster = prepare;
  A.use(arena, actor, bow, 5000);
  assert.deepEqual(counts(), [2, 3]);
  assert.throws(() => A.use(arena, actor, hat, 8000), /Сначала/);
  A.use(arena, actor, request("cherry_sweet"), 8000);
  assert.deepEqual(counts(), [1, 3]);
  assert.throws(() => A.use(arena, actor, hat, 9000), /Сначала/);
  A.use(arena, actor, request("cherry_sweet"), 10000);
  assert.equal(A.use(arena, actor, bow, 10000).replay, true);
  assert.deepEqual(counts(), [0, 3]);
  A.use(arena, actor, hat, 11000);
  assert.deepEqual(counts(), [0, 2]);
  assert.equal(A.use(arena, actor, hat, 12000).replay, true);
  assert.equal(arena.combat.shots.filter((x) => x.boosterId === "hook").length, 1);
  A.start(actor, p);
  assert.deepEqual(counts(), [0, 2]);
  arena.resetPlayer(actor, 15000);
  A.start(actor, p);
  assert.deepEqual(counts(), [3, 3]);
  assert.throws(() => A.use(arena, actor, bow, 16000), /этой жизни/);
  p.outfit = { hat: "captain_tricorn", bow: "novice_bow" };
  const hatOnly = {};
  A.start(hatOnly, p);
  assert.equal(A.snapshot(hatOnly)[0].count, 3);
  assert.deepEqual(
    A.snapshot(hatOnly).map((x) => x.accessoryId),
    ["captain_tricorn"],
  );
});

test("Пассивные эффекты: скорость не зависит от массы, радиус только природной еды, защита и заморозка", () => {
  const actor = {
    outfit: { hat: "forest_hood", bow: "forest_moth" },
    mass: 4999,
    accessoryFeedUntil: 3000,
  };
  assert.equal(passive.speed(actor, 1), 0.1);
  actor.mass = 5000;
  assert.equal(passive.speed(actor, 1), 0.1);
  assert.equal(passive.speed(actor, 3000), 0.1);
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p"),
    q = arena.addPlayer(0, "q");
  p.outfit = { hat: "tracker_hat" };
  const x = p.x + p.radius * 1.06 + 5.5;
  arena.ether = [
    { id: "natural", x, y: p.y, value: 2 },
    { id: "feed", x, y: p.y, value: 2, ejected: true },
  ];
  arena.collectEther(5000);
  assert.deepEqual(
    arena.ether.map((x) => x.id),
    ["feed"],
  );
  p.outfit = { hat: "polar_hat", bow: "forge_spark" };
  p.protectedUntil = 0;
  arena.combat.impact(
    { id: "freeze", boosterId: "freeze", ownerId: q.id },
    p,
    5000,
    arena.mainBody(p),
  );
  assert.equal(p.effects.freeze, 5000 + BOOSTERS.get("freeze").durationMs * 0.85);
  p.effects.gold_shield = 20000;
  // Используем реальный ID щита из каталога.
  delete p.effects.gold_shield;
  p.effects.golden_shield = 20000;
  p.effects.colorful_shield = 20000;
  arena.random = () => 0;
  arena.combat.impact({ id: "awl", boosterId: "awl", ownerId: q.id }, p, 6000, arena.mainBody(p));
  assert.equal(p.effects.golden_shield,20000);assert.equal(p.effects.colorful_shield,20000);
  arena.random = () => .1;
  arena.combat.impact({ id: "awl2", boosterId: "awl", ownerId: q.id }, p, 6001, arena.mainBody(p));
  assert.equal(arena.hasEffect(p,'shield',6001),false);assert.equal(passive.speed(p,6001),0);

});
test("Солнечная лента не меняет естественную потерю, но блокирует огонь с вероятностью 10%", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p");
  p.level = 501;
  p.outfit = { bow: "solar_ribbon" };
  arena.gainMass(p, 10000 - p.mass);
  let expected = p.mass,
    remainder = 0;
  for (let i = 1; i <= 10; i++) {
    const units = massDecayLoss(expected) * 100 + remainder;
    remainder = units % 100;
    expected -= Math.floor(units / 100);
    arena.decayMass(p, i * 2000);
  }
  assert.equal(p.mass, expected);
  assert.equal(p.massDecayRemainder, remainder);
  const before=p.mass;p.protectedUntil=0;arena.random=()=>0;
  arena.combat.impact({id:'fire-block',boosterId:'fire',ownerId:'other'},p,21000,arena.mainBody(p));
  assert.equal(p.mass,before);arena.random=()=>.1;
  arena.combat.impact({id:'fire-pass',boosterId:'fire',ownerId:'other'},p,21001,arena.mainBody(p));
  assert.equal(p.mass,before-Math.floor(before*.5));

});
test("Бонусы опыта прибавляются к базе, поглощение отдельно от 30-секундного пакета", (t) => {
  for (const premium of [false, true]) {
    const { p } = fixture(t);
    p.level = 501;
    p.progress = progression.freshProgress(501);
    p.outfit = { hat: "dawn_circlet", bow: "wanderer_knot" };
    p.account = { vipUntil: 0, premiumUntil: premium ? 1e9 : 0 };
    progression.applyEvent(p, { type: "lifeStarted", lifeId: "life" }, 0);
    const actor = { id: "actor", lifeId: "life", mass: 50000, account: { premium } };
    accrual.reset(actor, 0);
    for (let at = 50; at <= 60000; at += 50) {
      const e = accrual.sample(actor, at);
      if (e) progression.applyEvent(p, e, at);
    }
    assert.equal(p.progress.session.xp, premium ? 317 : 117);
    const before = p.progress.session.xp;
    for (let i = 0; i < 10; i++)
      progression.applyEvent(
        p,
        { type: "absorbed", victimProfileId: "v" + i, lifeId: "v-life" + i, gain: 20 },
        61000 + i,
      );
    assert.equal(p.progress.session.xp - before, premium ? 93 : 33);
  }
});
test("Чалма мудреца: отдельные 10% запаса, одинаковое время на арене и в сохранении, без повторного начисления", (t) => {
  const { p } = fixture(t);
  p.level = 50;
  p.outfit = { hat: "title_sage_hat" };
  p.honors.claimed = Math.max(p.honors.claimed,4);
  p.pets.equipped = "zaya";
  p.pets.owned.zaya = { games: 0, vitalityMs: 10000, refillAt: 1e9, purchasedAt: 0 };
  const actor = { account: {}, effects: {}, level: 50 };
  arenaPets.start(actor, p, 0, 0);
  pets.progress(p, { type: "lifeStarted", lifeId: "pet-life" }, 0);
  assert.equal(p.pets.life.accessoryPetMs, 1000);
  const fakeArena = { hasEffect: () => false, gainMass: () => 0, bodies: () => [] };
  for (const time of [500, 1000, 6000, 11000, 12000]) {
    arenaPets.tick(fakeArena, actor, time);
    pets.progress(p, { type: "lifeTime", lifeId: "pet-life", durationMs: time }, time);
    pets.validate(p);
    assert.equal(actor.pet.activeMs, p.pets.life.activeMs);
    assert.equal(actor.pet.vitalityMs, p.pets.owned.zaya.vitalityMs);
  }
  assert.equal(actor.pet.activeMs, 11000);
  assert.equal(actor.pet.vitalityMs, 0);
  pets.progress(p, { type: "lifeStarted", lifeId: "pet-life" }, 12000);
  assert.equal(p.pets.life.accessoryPetMs, 0);
});
