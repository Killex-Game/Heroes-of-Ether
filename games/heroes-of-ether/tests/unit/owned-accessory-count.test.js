"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const catalog = require("../../public/shared/accessory-catalog");
const { ownedAccessoryCount } = require("../../src/server/progression/owned-accessory-count");
test("derived ownership count matches individual rules for titles, legacy grants, purchases and Easter", () => {
  const ownable = catalog.items.filter(item => item.price || !item.previewOnly);
  const paid = ownable.filter(item => item.price).map(item => item.id);
  for (let degree = 0; degree <= 11; degree++) for (const legacy of [false, true])
    for (const purchases of [[], paid.slice(0, 2), paid]) for (const event of [0, 1, 2, 3]) {
      const p = { honors: { claimed: degree }, wardrobeState: { legacyNovice: legacy },
        purchasedAccessories: purchases, easter: { trophies: event === 1 ? [{}] : event === 2 ? [{ collectionVersion: 2 }] : [],
          runs: event === 3 ? { current: { fragmentCounts: Array(48).fill(1) } } : {} } };
      assert.equal(ownedAccessoryCount(p), ownable.filter(item => catalog.isOwned(p, item.id)).length);
      // Same-object mutations must be visible immediately, without waiting for
      // a profile revision or replacing the surrounding event/purchase arrays.
      p.honors.claimed = 10; p.easter.trophies.push({ collectionVersion: 2 });
      assert.equal(ownedAccessoryCount(p), ownable.filter(item => catalog.isOwned(p, item.id)).length);
    }
});
