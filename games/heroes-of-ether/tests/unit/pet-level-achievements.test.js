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
  { TITLES } = require("../../src/server/progression/title-chest-rewards"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { temporary } = require("../temp");
const AT = Date.UTC(2026, 9, 24, 12),
  REWARDS = [50, 250, 500, 750, 1000];
function fixture(filePath = null) {
  const store = new ProfileStore({ filePath, now: () => AT }),
    session = store.open();
  const get = () => store.find(session.token);
  get().level = 12;
  get().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  get().wallet = { coins: 30000, crystals: 3000, bucks: 5000 };
  const action = (action, petId, requestId = randomUUID()) =>
    service.mutate(store, session.token, { action, petId, requestId });
  const event = (type, lifeId, seconds = 0, batch = randomUUID()) =>
    store.applyArenaProgress(
      batch,
      [{ type, lifeId, durationSeconds: seconds, profileId: get().id }],
      AT + seconds * 1000,
    );
  return { store, session, get, action, event };
}
test("level zero has its own arena timers, growth and stock; first levels retain their balance", () => {
  for (const [id, interval, mass, fire, claw, glove, speed, resistance] of [
    ["zaya", 90000, 0, 0, 0, 0, 0, 0],
    ["leva", 60000, 100, 0, 0, 0, 0, 0],
    ["drakosha", 60000, 150, 3, 0, 4, 1, 0],
    ["manya", 60000, 300, 5, 5, 5, 1, 1],
  ]) {
    const f = fixture();
    f.action("buy", id);
    const arena = new Arena({ etherCount: 0 }),
      p = arena.addPlayer(0, "pet test"),
      initialMass = p.mass;
    pets.start(p, f.get(), 0, AT);
    assert.equal(p.pet.stats.level, 0);
    assert.equal(p.pet.stats.rank, 0);
    assert.equal(p.pet.stats.intervalMs, interval);
    assert.deepEqual(p.pet.stock, { fire, claw, glove, carrot: 0 });
    assert.equal(pets.speed(p), speed / 100);
    assert.equal(pets.damageFactor(p), 1 - resistance / 100);
    assert.equal(p.pet.stats.firePercent, fire ? 50 : 0);
    pets.tick(arena, p, interval - 1);
    assert.equal(p.mass, initialMass);
    assert.equal(arena.hasEffect(p, "shield", interval - 1), false);
    pets.tick(arena, p, interval);
    assert.equal(p.mass, initialMass + mass);
    assert.equal(arena.hasEffect(p, "shield", interval), true);
    assert.deepEqual(R.stats(id, 99), R.stats(id, 0));
  }
  assert.equal(R.stats("zaya", 100).intervalMs, 60000);
  assert.equal(R.stats("leva", 100).mass, 200);
  assert.equal(R.stats("drakosha", 100).mass, 300);
  assert.deepEqual(R.stats("drakosha", 100).start, { fire: 4, claw: 0, glove: 6, carrot: 0 });
  assert.equal(R.stats("manya", 100).intervalMs, 50000);
  assert.equal(R.stats("manya", 100).mass, 400);
  assert.deepEqual(R.stats("manya", 100).start, { fire: 7, claw: 7, glove: 7, carrot: 0 });
});
for (const pet of R.pets)
  test(`${pet.name}: each actual level completes one new degree, replay awards nothing`, () => {
    const f = fixture(),
      id = `pet_level_${pet.id}`;
    f.action("buy", pet.id);
    const base = f.get().greatness,
      titlesBefore = f.get().honors.claimed;
    assert.equal(f.get().activity.claimed[id], 0, "buying a level-zero pet is not a level up");
    let earned = 0;
    for (let i = 0; i < R.thresholds.length; i++) {
      f.get().pets.owned[pet.id].games = R.thresholds[i] - 1;
      f.event("lifeStarted", `level-${i}`);
      assert.equal(f.get().activity.claimed[id], i);
      const batch = randomUUID();
      f.event("lifeEnded", `level-${i}`, 61, batch);
      earned += REWARDS[i];
      assert.equal(f.get().activity.claimed[id], i + 1);
      assert.equal(f.get().activity.stageSpent[id], i + 1);
      const titleRewards = TITLES.slice(titlesBefore, f.get().honors.claimed).reduce(
        (sum, t) => sum + t.reward,
        0,
      );
      assert.equal(f.get().greatness, base + earned + (i === 4 ? 250 : 0) + titleRewards);
      const before = structuredClone(f.get());
      f.event("lifeEnded", `level-${i}`, 61, batch);
      assert.deepEqual(f.get(), before);
      f.event("lifeEnded", `level-${i}`, 61);
      assert.equal(f.get().greatness, before.greatness);
      const view = f.store.view(f.get()).progress.achievements.find((a) => a.id === id);
      assert.deepEqual(view.thresholds, [1, 1, 1, 1, 1]);
      assert.deepEqual(view.rewards, REWARDS);
      assert.equal(view.value, i === 4 ? 1 : 0);
      assert.equal(view.exception, false);
    }
    for (const other of R.pets.filter((p) => p.id !== pet.id))
      assert.equal(f.get().activity.claimed[`pet_level_${other.id}`], 0);
  });
test("failed save at a level boundary grants nothing; disconnect recovery and repeats persist only one reward", (t) => {
  const file = path.join(temporary(t, "pet-level-recovery"), "profiles.json"),
    f = fixture(file);
  f.action("buy", "zaya");
  f.get().pets.owned.zaya.games = 99;
  f.event("lifeStarted", "level");
  f.event("lifeTime", "level", 61);
  const before = structuredClone(f.get()),
    disk = fs.readFileSync(file, "utf8"),
    rename = fs.renameSync;
  fs.renameSync = () => {
    throw Error("disk full");
  };
  try {
    assert.throws(() => f.event("lifeEnded", "level", 61), /disk full/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(f.get(), before);
  assert.equal(fs.readFileSync(file, "utf8"), disk);
  let recovered = new ProfileStore({ filePath: file, now: () => AT + 61000 });
  recovered.open(f.session.token);
  assert.equal(recovered.find(f.session.token).activity.claimed.pet_level_zaya, 1);
  assert.equal(recovered.find(f.session.token).greatness, before.greatness + 50);
  const paid = recovered.find(f.session.token).greatness;
  recovered = new ProfileStore({ filePath: file, now: () => AT + 61000 });
  recovered.open(f.session.token);
  assert.equal(recovered.find(f.session.token).greatness, paid);
});
test("old profiles retain existing progress and earn pet-level rewards once, including after failed write/restart", (t) => {
  const file = path.join(temporary(t, "pet-level-migration"), "profiles.json"),
    f = fixture();
  for (const pet of R.pets) f.action("buy", pet.id);
  const old = structuredClone(f.store.data),
    p = Object.values(old.profiles)[0];
  [100, 500, 2500, 5000].forEach((games, i) => (p.pets.owned[R.pets[i].id].games = games));
  for (const pet of R.pets)
    for (const field of ["values", "claimed", "stageSpent"])
      delete p.activity[field][`pet_level_${pet.id}`];
  fs.writeFileSync(file, JSON.stringify(old));
  let loaded = new ProfileStore({ filePath: file, now: () => AT });
  const fresh = loaded.find(f.session.token);
  assert.deepEqual(fresh.wallet, p.wallet);
  assert.deepEqual(fresh.pets, p.pets);
  assert.equal(fresh.greatness, p.greatness);
  for (const [id, count] of Object.entries(p.activity.claimed))
    assert.equal(fresh.activity.claimed[id], count);
  const rename = fs.renameSync;
  fs.renameSync = () => {
    throw Error("disk full");
  };
  try {
    assert.throws(() => loaded.open(f.session.token), /disk full/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(loaded.find(f.session.token).greatness, p.greatness);
  loaded.open(f.session.token);
  assert.equal(
    loaded.find(f.session.token).greatness,
    p.greatness + 4450,
    "title is earned without extra greatness",
  );
  loaded = new ProfileStore({ filePath: file, now: () => AT });
  loaded.open(f.session.token);
  assert.equal(loaded.find(f.session.token).greatness, p.greatness + 4450);
  const corrupt = structuredClone(old),
    bad = Object.values(corrupt.profiles)[0];
  bad.activity.claimed.pet_level_zaya = 1;
  fs.writeFileSync(file, JSON.stringify(corrupt));
  assert.throws(() => new ProfileStore({ filePath: file, now: () => AT }), /достижения/);
});
