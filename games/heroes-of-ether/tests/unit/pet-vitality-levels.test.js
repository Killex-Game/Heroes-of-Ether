"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const rules = require("../../public/shared/pet-rules"),
  service = require("../../src/server/pets/pet-service"),
  arenaPets = require("../../src/server/pets/arena-pets"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp");
const minutes = {
  zaya: [30, 40, 50, 60, 80, 120],
  leva: [60, 70, 80, 90, 120, 150],
  drakosha: [80, 90, 120, 150, 180, 210],
  manya: [90, 100, 120, 180, 210, 240],
};
const now = Date.UTC(2026, 9, 24),
  games = [0, ...rules.thresholds];
test("all 24 capacities drive purchases, refill, feeding, arena depletion and percentages", () => {
  for (const [id, values] of Object.entries(minutes))
    for (let level = 0; level < 6; level++) {
      const store = new ProfileStore({ now: () => now }),
        auth = store.open(),
        p = store.find(auth.token);
      p.level = 12;
      p.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
      p.wallet = { coins: 50000, crystals: 50000, bucks: 50000 };
      service.mutate(store, auth.token, { action: "buy", petId: id, requestId: randomUUID() });
      let saved = store.find(auth.token).pets.owned[id];
      assert.equal(saved.vitalityMs, values[0] * 60000);
      saved.games = games[level];
      saved.vitalityMs = 0;
      saved.refillAt = now;
      service.refresh(store.find(auth.token), now);
      const cap = values[level] * 60000;
      assert.equal(saved.vitalityMs, cap);
      assert.equal(rules.stats(id, games[level]).capacityMs, cap);
      saved.vitalityMs = cap / 2;
      store.find(auth.token).pets.food = 1;
      service.mutate(store, auth.token, { action: "feed", petId: id, requestId: randomUUID() });
      saved = store.find(auth.token).pets.owned[id];
      assert.equal(saved.vitalityMs, cap * 0.6);
      assert.equal(service.view(store.find(auth.token), now).owned[id].vitality, 60);
      const player = {
        dead: false,
        account: { premium: false },
        effects: {},
        boosterItemReadyAt: {},
      };
      arenaPets.start(player, store.find(auth.token), 0, now);
      player.pet.nextGiftMs = Infinity;
      arenaPets.tick({}, player, 1000);
      assert.equal(player.pet.vitalityMs, cap * 0.6 - 1000);
      assert.equal(arenaPets.snapshot(player, 1000).vitality, ((cap * 0.6 - 1000) / cap) * 100);
      service.validate(store.find(auth.token));
    }
});
test("old vitality migrates once at the same percentage and survives reload without touching rewards", (t) => {
  const temp = temporary(t, "vitality-migration");
  try {
    const file = path.join(temp, "profiles.json"),
      store = new ProfileStore({ filePath: file, now: () => now }),
      auth = store.open(),
      p = store.find(auth.token);
    for (const [i, id] of Object.keys(minutes).entries())
      p.pets.owned[id] = {
        games: games[i + 1],
        vitalityMs: ((i + 1) * 3600000) / 2,
        refillAt: now + 60000,
        purchasedAt: now - 1000,
      };
    delete p.pets.vitalityVersion;
    store.save(store.data);
    const before = JSON.parse(fs.readFileSync(file)),
      loaded = new ProfileStore({ filePath: file, now: () => now }),
      after = loaded.find(auth.token);
    for (const [id, pet] of Object.entries(after.pets.owned))
      assert.equal(pet.vitalityMs, rules.capacityMs(id, pet.games) / 2);
    assert.deepEqual(after.wallet, p.wallet);
    assert.deepEqual(after.inventory, p.inventory);
    assert.deepEqual(after.progress, p.progress);
    assert.equal(after.pets.vitalityVersion, 1);
    assert.equal(service.migrateVitality(after), false);
    loaded.save(loaded.data);
    assert.deepEqual(
      new ProfileStore({ filePath: file, now: () => now }).find(auth.token).pets,
      after.pets,
    );
    assert.equal(
      Object.values(before.profiles).find((p) => p.id === auth.profile.id).pets.vitalityVersion,
      undefined,
    );
  } finally {
    /* temporary() removes only its verified test directory. */
  }
});
test("level-up preserves percentage after arena drain, repeated life end cannot increase vitality again", () => {
  const store = new ProfileStore({ now: () => now }),
    auth = store.open(),
    p = store.find(auth.token);
  p.level = 12;
  p.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  p.pets.owned.zaya = {
    games: 99,
    vitalityMs: 900000,
    refillAt: now + rules.REFILL_MS,
    purchasedAt: now,
  };
  p.pets.equipped = "zaya";
  service.progress(p, { type: "lifeStarted", lifeId: "level-up" }, now);
  const end = { type: "lifeEnded", lifeId: "level-up", durationMs: 61000 };
  service.progress(p, end, now + 61000);
  assert.equal(p.pets.owned.zaya.games, 100);
  assert.equal(p.pets.owned.zaya.vitalityMs, Math.round(((900000 - 61000) * 40) / 30));
  const before = structuredClone(p.pets);
  service.progress(p, end, now + 61000);
  assert.deepEqual(p.pets, before);
});
test("migration rejects corrupted old charge instead of silently clamping it", () => {
  const p = { pets: service.fresh() };
  delete p.pets.vitalityVersion;
  p.pets.owned.zaya = { games: 0, vitalityMs: 3600001, refillAt: now, purchasedAt: now };
  const before = structuredClone(p);
  assert.throws(() => service.migrateVitality(p), /Повреждены/);
  assert.deepEqual(p, before);
});
