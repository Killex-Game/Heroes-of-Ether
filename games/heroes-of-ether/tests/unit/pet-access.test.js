"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  service = require("../../src/server/pets/pet-service"),
  arenaPets = require("../../src/server/pets/arena-pets"),
  rules = require("../../public/shared/pet-rules");

test("pet actions trust stored player level, leave locked profiles intact and unlock at 12", () => {
  const store = new ProfileStore(),
    auth = store.open(),
    get = () => store.find(auth.token);
  get().wallet = { coins: 50000, crystals: 5000, bucks: 5000 };
  for (const level of [1, 11]) {
    get().level = level;
    get().progress.xp = xpForLevel(level);
    const before = structuredClone(get());
    for (const action of ["buy", "equip", "unequip", "food", "feed"])
      assert.throws(
        () =>
          service.mutate(store, auth.token, {
            action,
            petId: "zaya",
            requestId: randomUUID(),
            level: 12,
          }),
        (e) => e.status === 403 && e.message.includes("12"),
      );
    assert.deepEqual(get(), before);
    assert.equal(service.view(get(), store.now()).available, false);
  }
  get().level = 12;
  get().progress.xp = xpForLevel(12);
  const request = { action: "buy", petId: "zaya", requestId: randomUUID() };
  service.mutate(store, auth.token, request);
  const purchased = structuredClone(get());
  assert.equal(service.mutate(store, auth.token, request).replay, true);
  assert.deepEqual(get(), purchased);
  assert.equal(service.view(get(), store.now()).available, true);
  assert.equal(service.view(get(), store.now()).unlockLevel, 12);
});

test("legacy pets below level 12 are preserved but neither activate nor drain or train", () => {
  const at = Date.UTC(2026, 9, 25),
    store = new ProfileStore({ now: () => at }),
    auth = store.open(),
    profile = store.find(auth.token);
  profile.level = 11;
  profile.progress.xp = xpForLevel(11);
  profile.pets.owned.manya = {
    games: 5000,
    vitalityMs: rules.capacityMs("manya", 5000),
    refillAt: at + rules.REFILL_MS,
    purchasedAt: at,
  };
  profile.pets.equipped = "manya";
  const before = structuredClone(profile.pets),
    player = {};
  arenaPets.start(player, profile, 0, at);
  assert.equal(player.pet, null);
  service.progress(profile, { type: "lifeStarted", lifeId: "locked" }, at);
  service.progress(profile, { type: "lifeTime", lifeId: "locked", durationMs: 65000 }, at + 65000);
  service.progress(profile, { type: "lifeEnded", lifeId: "locked", durationMs: 65000 }, at + 65000);
  assert.deepEqual(profile.pets, before);
  profile.pets.life = { id: "stale", petId: "manya", elapsedMs: 0, activeMs: 0, startedAt: at };
  service.progress(profile, { type: "lifeEnded", lifeId: "stale", durationMs: 65000 }, at + 65000);
  assert.deepEqual(profile.pets, before);
  profile.level = 12;
  profile.progress.xp = xpForLevel(12);
  arenaPets.start(player, profile, 0, at);
  assert.equal(player.pet.id, "manya");
  assert.equal(player.pet.stats.level, 5);
  assert.equal(player.pet.stock.fire, 11);
  service.progress(profile, { type: "lifeStarted", lifeId: "unlocked" }, at);
  service.progress(
    profile,
    { type: "lifeEnded", lifeId: "unlocked", durationMs: 65000 },
    at + 65000,
  );
  assert.equal(profile.pets.owned.manya.games, 5001);
  assert.equal(profile.pets.owned.manya.vitalityMs, before.owned.manya.vitalityMs - 65000);
});
