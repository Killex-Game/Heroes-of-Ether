"use strict";
const accessories = require("../../../public/shared/accessory-catalog");
const ownable = accessories.items.filter(item => item.price || !item.previewOnly);
const titles = ownable.filter(item => item.titleDegree);
const others = ownable.filter(item => !item.titleDegree);
const maximum = Math.max(0, ...titles.map(item => item.titleDegree));
const byDegree = Array.from({ length: maximum + 1 }, (_, degree) =>
  titles.filter(item => item.titleDegree <= degree).length);
const noviceCount = titles.filter(item => item.titleDegree === 1).length;

// Catalogue-derived title counts are immutable. Purchases and event ownership
// are still checked on the current draft, including changes inside one batch.
// No profile/revision cache can hide a newly earned item from Fashionista.
function ownedAccessoryCount(profile) {
  const degree = profile.honors?.claimed || 0;
  if (!Number.isSafeInteger(degree) || degree < 0)
    return ownable.reduce((count, item) => count + Number(accessories.isOwned(profile, item.id)), 0);
  let count = byDegree[Math.min(degree, maximum)];
  if (!degree && profile.wardrobeState?.legacyNovice === true) count += noviceCount;
  for (const item of others) if (accessories.isOwned(profile, item.id)) count++;
  return count;
}
module.exports = { ownedAccessoryCount };
