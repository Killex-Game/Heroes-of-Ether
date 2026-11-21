"use strict";
const identity = require("../../../public/shared/player-identity");
const accessories = require("../../../public/shared/accessory-catalog");
const appearance = require("./league-appearance");
const accounts = require("../accounts/account-benefits");
const slots = require("../../../public/shared/league-appearance").slots;
function fresh() { return { version: 1, legacyNovice: false, seen: identity.skins.map(s => "skin:" + s.id) }; }
function mark(p, key) {
  const state = p.wardrobeState || fresh();
  if (!state.seen.includes(key)) p.wardrobeState = { ...state, seen: [...state.seen, key] };
}
function migrate(p, clans, at) {
  if (p.wardrobeState) return false;
  // Previously every account owned the starter pair. Preserve those grants.
  p.wardrobeState = { version: 1, legacyNovice: true, seen: [] };
  const seen = p.wardrobeState.seen;
  for (const item of accessories.items)
    if ((!item.titleDegree || item.titleDegree === 1) && accessories.isOwned(p, item.id)) seen.push("accessory:" + item.id);
  for (const skin of identity.allSkins)
    if (identity.skinAllowed(skin.id, accounts.benefits(p, at), appearance.skinSets(p), p.purchasedSkinCollections)) seen.push("skin:" + skin.id);
  for (const id of appearance.view(p, clans, at).unlocked)
    for (const slot of slots) seen.push(slot + ":" + id);
  return true;
}
function validate(p) {
  const s = p.wardrobeState;
  if (!s || s.version !== 1 || typeof s.legacyNovice !== "boolean" || !Array.isArray(s.seen) ||
      s.seen.length > 2048 || s.seen.some(k => typeof k !== "string" || k.length > 120) || new Set(s.seen).size !== s.seen.length)
    throw Error("Повреждены отметки гардероба.");
}
module.exports = { fresh, mark, migrate, validate };
