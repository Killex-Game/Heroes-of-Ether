"use strict";
// Foundation for explicit owner-controlled seasons. No calendar auto-start.
const { createHash } = require("node:crypto");
function announce(history, { id, name, startsAt, endsAt }, actor) {
  if (actor?.role !== "owner") throw Error("Only owner may announce a clan season");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || history.some(s => s.id === id) || !name?.trim() ||
      !Number.isSafeInteger(startsAt) || startsAt < 0 || !Number.isSafeInteger(endsAt) || endsAt <= startsAt ||
      history.some(s => !s.cancelled && startsAt < s.endsAt && endsAt > s.startsAt)) throw Error("Invalid or overlapping season");
  return [...history, { id, name: name.trim(), startsAt, endsAt, cancelled: false }];
}
function active(history, at) { return history.find(s => !s.cancelled && s.startsAt <= at && at < s.endsAt) || null; }
function appendReward(ledger, season, clanId, reward) {
  if (!season?.id || !clanId || !reward || !Object.keys(reward).length ||
      Object.values(reward).some(n => !Number.isSafeInteger(n) || n < 0)) throw Error("Invalid season reward");
  const id = createHash("sha256").update(`clan-season:${season.id}:${clanId}`).digest("hex");
  const existing = ledger.find(r => r.id === id);
  if (existing) {
    if (JSON.stringify(existing.reward) !== JSON.stringify(reward)) throw Error("Season reward already fixed");
    return ledger;
  }
  return [...ledger, { id, seasonId: season.id, clanId, reward: structuredClone(reward) }];
}
module.exports = { announce, active, appendReward };
