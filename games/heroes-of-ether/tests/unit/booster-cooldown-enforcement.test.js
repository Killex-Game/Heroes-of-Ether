"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { cooldown } = require("../../public/shared/booster-cooldowns");
const { publicCatalog } = require("../../src/server/boosters/booster-catalog");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const catalog = publicCatalog();
const item = id => catalog.items.find(b => b.id === id);

test("Every consumable uses its own deadline in both simulation and HUD", () => {
  for (const booster of catalog.items.filter(b => b.kind !== "potion")) {
    const arena = new Arena({ etherCount: 0 });
    const p = arena.addPlayer(0, booster.id);
    Object.assign(p, { level: 121, mass: 1000, radius: radiusForMass(1000), protectedUntil: 0 });
    if (booster.id === "sponge") arena.splitPlayer(p, { spawnSerial: p.spawnSerial, sequence: 1 }, 3000);
    const command = { boosterId: booster.id, spawnSerial: p.spawnSerial, aimX: 3000, aimY: 3000 };
    const ms = booster.id === "easter_egg" ? 10000
      : ["meat", "donut", "candy"].includes(booster.id) ? 200 : 500;
    assert.equal(booster.cooldownMs, ms, booster.id);
    arena.prepareBooster(p.id, command, 5000)();
    assert.throws(() => arena.prepareBooster(p.id, command, 5000 + ms - 1), /мгновение/, booster.id);
    assert.doesNotThrow(() => arena.prepareBooster(p.id, command, 5000 + ms), booster.id);
    const me = { boosterCooldowns: { [booster.id]: ms }, boosterCooldownMs: 99999,
      shieldCooldowns: { [booster.id]: 99999 }, effects: [{ id: booster.id, remainingMs: 99999 }] };
    assert.deepEqual(cooldown(booster, me, ms - 1, catalog.rules), { ms: 1, duration: ms });
    assert.equal(cooldown(booster, me, ms, catalog.rules).ms, 0);
    assert.equal(cooldown(item(booster.id === "meat" ? "candy" : "meat"), me, 0, catalog.rules).ms, 0);
  }
});
