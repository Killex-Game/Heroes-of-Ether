"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards } = require("../../src/server/arena/arena-hazards");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
function scene(mass = 150) {
  const arena = new Arena({ etherCount: 0 }), p = arena.addPlayer(0, "player");
  Object.assign(p, { x: 1000, y: 1000, targetX: 1000, targetY: 1000, mass,
    radius: radiusForMass(mass), profileId: "player", stopped: true });
  return { arena, p };
}
test("spawn protection does not prevent thorn mass and split: 150 + 50 = 200", () => {
  const { arena, p } = scene(), hazards = arena.hazards = new ArenaHazards(arena);
  hazards.replenish = () => {};
  hazards.items = [hazards.create(p.x, p.y, 0)];
  hazards.collect(50);
  assert.equal(hazards.items.length, 0);
  assert.equal(p.mass, 200);
  assert.equal(arena.bodies(p).reduce((sum, part) => sum + part.mass, 0), 200);
  assert.equal(p.protectedUntil, 2000, "PvP protection is retained");
});
test("fire removes small parts including mass2, exactly300, and last-life event only once", () => {
  for (const mass of [2, 20, 150, 300]) {
    const { arena, p } = scene(mass);
    arena.boosterEffects.burn(p, p, 3000);
    arena.boosterEffects.burn(p, p, 3001);
    assert.equal(p.dead, true);
    assert.equal(arena.combatEvents.filter(e => e.type === "burned").length, 1);
  }
  const { arena, p } = scene(602);
  arena.boosterEffects.burn(p, p, 3000);
  assert.equal(p.dead, false);
  assert.equal(p.mass, 301);
});
test("sword destroys a part when the burn reaches300; natural decay never kills", () => {
  const { arena, p } = scene(350);
  arena.boosterEffects.apply(p, BOOSTERS.get("fire_sword"), 3000);
  arena.boosterEffects.tickSwordBurns(p, 20000);
  assert.equal(p.dead, true);
  assert.equal(arena.combatEvents.filter(e => e.type === "burned").length, 1);
  const small = scene(150);
  small.arena.decayMass(small.p, 1e9);
  assert.equal(small.p.mass, 20);
  assert.equal(small.p.dead, false);
});
test("per-item cooldown rejects same-time repeats and slot exhaustion remains authoritative", () => {
  const { arena, p } = scene();
  p.protectedUntil = 0;
  p.level = 121;
  for (const id of ["candy", "colorful_shield", "speed", "fire_sword"]) {
    const booster = BOOSTERS.get(id);
    assert.ok(booster, id);
    const message = { boosterId: id, spawnSerial: p.spawnSerial, aimX: 1500, aimY: 1000 };
    arena.prepareBooster(p.id, message, 3000)();
    assert.throws(()=>arena.prepareBooster(p.id,message,3000),/Подожди/);
    arena.prepareBooster(p.id,message,3000+booster.cooldownMs)();
    assert.equal(p.boosterUses[id], 2);
    p.boosterUses[id] = 1e6;
    assert.throws(() => arena.prepareBooster(p.id, message, 5000), /Лимит/);
  }
});

test("burned multipart cells all disappear even as the last cell becomes the player model", () => {
  const { arena, p } = scene(700);
  p.parts = [p.mainPartId, "second"].map(id => ({id,x:1000,y:1000,mass:350,radius:radiusForMass(350)}));
  arena.syncParts(p);
  for(const body of arena.bodies(p)) arena.boosterEffects.apply(p,BOOSTERS.get('fire_sword'),3000,body);
  arena.boosterEffects.tickSwordBurns(p,4000);
  assert.equal(p.dead,true);
  assert.equal(p.swordBurns.length,0);
  assert.equal(arena.combat.contacts.filter(e=>e.type==='partRemoved').length,2);
  assert.equal(arena.combatEvents.filter(e=>e.type==='burned').length,1);
  assert.equal(arena.boosterEffects.split(p,p,2,5000),false);
  assert.equal(arena.splitPlayer(p,{spawnSerial:p.spawnSerial,sequence:1},5000),false);
});
