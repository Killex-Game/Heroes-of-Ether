"use strict";

// One opponent per assigned quest/order, identified by persistent profile ID.
// Bounded by that objective's target, never an unbounded arena contact history.
const metrics = new Set(["kills", "lifeKills", "jumpKills", "hazardHits", "rocketHits", "freezeHits", "hookHits", "lifeHazardHits", "lifeRocketHits", "lifeFreezeHits", "lifePushHits"]);
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 128;
function accepts(row, metric, event, selfId, target) {
  if (!metrics.has(metric)) return true;
  if (row.progress >= target) return false;
  const id = event.type === "absorbed" ? event.victimProfileId : event.targetProfileId;
  if (!validId(id) || id === selfId || row.opponents?.includes(id)) return false;
  row.opponents = [...(row.opponents || []), id];
  return true;
}
function valid(row, target) {
  const ids = row.opponents;
  return ids === undefined || (Array.isArray(ids) && ids.length <= target &&
    ids.length <= row.progress && ids.every(validId) && new Set(ids).size === ids.length);
}
module.exports = { accepts, valid };
