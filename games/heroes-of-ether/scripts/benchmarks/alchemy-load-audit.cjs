"use strict";
const assert = require("node:assert/strict");
const rules = require("../../public/shared/alchemy-rules");
const receipts = require("../../src/server/profiles/operation-receipts");
const inventory = p => Object.fromEntries(rules.potions.map(item => [item.boosterId, p.inventory[item.boosterId] || 0]));
function capture(world) {
  return { version: 1, profiles: Object.fromEntries(Object.entries(world.profiles).map(([key, p]) => [key, {
    inventory: inventory(p), ingredients: { ...p.alchemy?.ingredients }, natural: p.alchemy?.natural || 0,
    arena: !!p.progress?.session,
  }])) };
}
function createAudit(baseline) {
  assert.equal(baseline.version, 1);
  const expected = structuredClone(baseline.profiles), changed = new Set(), seen = new Set();
  let casts = 0, brews = 0, exchanges = 0;
  return {
    observe(ack, profile) {
      if (!ack.type.startsWith("booster:alchemy_") && !["lobby:alchemy-brew", "lobby:alchemy-exchange"].includes(ack.type)) return;
      assert(!seen.has(ack.id), "Repeated alchemy ACK"); seen.add(ack.id);
      const row = expected[ack.key]; assert(row, "Alchemy baseline owner missing");
      if (ack.type.startsWith("booster:")) {
        const potion = rules.get(ack.type.slice(8)); assert(potion, "Unknown acknowledged potion");
        row.inventory[potion.boosterId]--; casts++;
      } else {
        assert.equal(row.arena, false, "Lobby recipe audit cannot assume no arena pickups");
        const signature = JSON.parse(receipts.read(profile, ack.id));
        assert.equal(signature[0], "alchemy");
        changed.add(ack.key);
        if (ack.type === "lobby:alchemy-brew") {
          assert.equal(signature[1], "brew"); const potion = rules.get(signature[2]); assert(potion);
          row.inventory[potion.boosterId] += potion.yield;
          for (const ingredient of potion.ingredients) row.ingredients[ingredient.id] -= ingredient.count;
          brews++;
        } else {
          assert.equal(signature[1], "exchange"); row.natural -= rules.NATURAL_PER_EXCHANGE; exchanges++;
        }
      }
    },
    finish(world) {
      assert.deepEqual(Object.keys(world.profiles).sort(), Object.keys(expected).sort(), "Alchemy profile set changed");
      for (const [key, row] of Object.entries(expected)) {
        const p = world.profiles[key];
        assert.deepEqual(inventory(p), row.inventory, "Potion inventory mismatch: " + key);
        if (changed.has(key)) {
          assert.deepEqual(p.alchemy.ingredients, row.ingredients, "Recipe ingredient mismatch: " + key);
          assert.equal(p.alchemy.natural, row.natural, "Natural ether exchange mismatch: " + key);
        }
      }
      assert(casts && brews && exchanges, "Alchemy economy coverage incomplete");
      return { version: 1, casts, brews, exchanges, profiles: Object.keys(expected).length, exactInventories: true,
        exactLobbyIngredientsAndNatural: true };
    },
  };
}
module.exports = { capture, createAudit };
