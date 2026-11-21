"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards } = require("../../src/server/arena/arena-hazards");
const pets = require("../../src/server/pets/arena-pets");
const rules = require("../../public/shared/pet-rules");
function scene(games, id = "leva", easter = false) {
  const a = new Arena({ etherCount: 0 }),
    p = a.addPlayer(0, "human");
  Object.assign(p, {
    x: 1000,
    y: 1000,
    targetX: 1000,
    targetY: 1000,
    profileId: "profile",
    level: 100,
    protectedUntil: 0,
    stopped: true,
  });
  const profile = {
    level: 100,
    pets: {
      equipped: id,
      owned: { [id]: { games, vitalityMs: rules.stats(id, games).capacityMs, refillAt: 99999999 } },
    },
  };
  pets.start(p, profile, 0, 0);
  const h = (a.hazards = new ArenaHazards(a));
  h.setRun(easter ? { id: "easter-test" } : null);
  h.items = [];
  h.replenish = () => {};
  a.gainMass(p, 1000 - p.mass);
  const eat = () => {
    const b = a.bodies(p)[0];
    h.items = [h.create(b.x, b.y, 0)];
    h.collect(1000);
  };
  return { a, p, h, profile, eat };
}
for (const [i, games] of rules.thresholds.entries())
  test(`Leva level ${i + 1}: ${(i + 1) * 10} thorns, mass and quest credit, then normal split`, () => {
    const { a, p, eat, profile } = scene(games),
      quota = (i + 1) * 10;
    for (let n = 0; n < quota; n++) {
      eat();
      assert.equal(a.bodies(p).length, 1);
      assert.equal(pets.snapshot(p, 1000).thornMeals, quota - n - 1);
    }
    assert.equal(p.mass, 1000 + quota * 50);
    assert.equal(p.pet.thornMeals, 0);
    eat();
    assert.equal(a.bodies(p).length, 3);
    assert.equal(p.mass, 1000 + (quota + 1) * 50);
    assert.equal(
      a.progressEvents.filter((e) => e.type === "arenaAction" && e.metric === "hazards").length,
      quota + 1,
    );
    pets.start(p, profile, 2000, 2000);
    assert.equal(p.pet.thornMeals, quota);
    assert.equal(pets.snapshot(p, 2000).thornMeals, quota);
  });
test("training, other pets and exhausted Leva preserve ordinary thorn split", () => {
  for (const [games, id, inactive] of [
    [99, "leva", false],
    [5000, "manya", false],
    [100, "leva", true],
  ]) {
    const { a, p, eat } = scene(games, id);
    if (inactive) {
      p.pet.vitalityMs = 0;
      p.pet.accessoryPetMs = 0;
    }
    eat();
    assert.equal(a.bodies(p).length, 3);
  }
});
test("spawn protection does not spend Leva allowance; Lock still allows thorns", () => {
  const { a, p, eat } = scene(100);
  p.protectedUntil = 2000;
  eat();
  assert.equal(p.pet.thornMeals, 10);
  assert.equal(p.mass, 1000);
  p.protectedUntil = 0;
  p.effects.lock = 5000;
  eat();
  assert.equal(p.pet.thornMeals, 9);
  assert.equal(a.bodies(p).length, 1);
  assert.equal(p.mass, 1050);
  assert.equal(p.effects.lock, 5000);
});
test("Easter hazards honor Leva and Zaya protection, preserve egg credit and mass, and split after exhaustion", () => {
  for(const id of ["leva","zaya"]) {
    const { a, p, eat } = scene(100, id, true),quota=p.pet.thornMeals;
    eat();
    assert.equal(a.bodies(p).length,1);assert.equal(p.pet.thornMeals,quota-1);assert.equal(p.mass,1050);
    assert.equal(a.progressEvents.filter(e=>e.type==="easterPickup"&&e.runId==="easter-test").length,1);
    assert.equal(a.progressEvents.filter(e=>e.type==="arenaAction"&&e.metric==="hazards").length,1);
    while(pets.consumeThorn(p)){}
    eat();assert.equal(a.bodies(p).length,3);assert.equal(p.mass,1100);
    assert.equal(a.progressEvents.filter(e=>e.type==="easterPickup").length,2);
  }
});

test("Leva and Zaya keep their allowance at the room part cap", () => {
  for (const id of ["leva", "zaya"]) for (const cap of [8, 12, 16]) for(const easter of [false,true]) {
    const { a, p, eat } = scene(100, id, easter);
    a.maxParts = cap;
    a.boosterEffects.splitToLimit(p, 1000);
    assert.equal(a.bodies(p).length, cap);
    const quota = p.pet.thornMeals;
    eat();
    assert.equal(p.pet.thornMeals, quota);
    assert.equal(p.pet.thornRefillAtMs, null);
  }
});

test("Leva refills only after exhaustion on levels 3/4/5 at 3/2/1 minutes", () => {
  for (const [i, games] of rules.thresholds.entries()) {
    const { a, p } = scene(games), quota = p.pet.thornMeals;
    pets.consumeThorn(p);
    pets.tick(a, p, 1000);
    assert.equal(p.pet.thornMeals, quota - 1, "partial stock is not refilled");
    while (pets.consumeThorn(p)) {}
    const delay = [0, 0, 180000, 120000, 60000][i];
    pets.tick(a, p, 1000 + (delay || 600000) - 1);
    assert.equal(p.pet.thornMeals, 0);
    if (delay) {
      pets.tick(a, p, 1000 + delay);
      assert.equal(p.pet.thornMeals, quota);
      assert.equal(p.pet.thornRefillAtMs, null);
    }
  }
});

test("Zaya holds one safe thorn and starts the level cooldown only after spending it", () => {
  for (const [i, games] of [0, ...rules.thresholds].entries()) {
    const { a, p, eat } = scene(games, "zaya");
    const delay = [60000, 55000, 50000, 45000, 40000, 30000][i];
    pets.tick(a, p, 120000);
    assert.equal(p.pet.thornMeals, 1);
    eat();
    assert.equal(a.bodies(p).length, 1);
    assert.equal(p.pet.thornMeals, 0);
    pets.tick(a, p, 120000 + delay - 1);
    assert.equal(p.pet.thornMeals, 0);
    pets.tick(a, p, 120000 + delay);
    assert.equal(p.pet.thornMeals, 1);
    pets.tick(a, p, 120000 + delay * 3);
    assert.equal(p.pet.thornMeals, 1, "no accumulation");
  }
});
