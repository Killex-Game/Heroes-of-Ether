"use strict";
// Private, bounded projection. Never build treasury, achievement or shop catalogues here.
const quests = require("./personal-quests");
const friday = require("../events/black-friday");
const definitions = new Map(quests.CATALOG.map(q => [q.id, q]));
const value = { large: 3, medium: 2, small: 1 };
function select(rows) {
  const available = rows.filter(q => !q.claimed);
  const unfinished = available.filter(q => q.progress < q.target);
  return (unfinished.length ? unfinished : available).reduce((best, q) =>
    !best || q.priority > best.priority ? q : best, null);
}
function view(p, manager, at) {
  const q = quests.ensure({ id: p.id, level: p.level, quests: p.quests }, at);
  const expiresAt = (Math.floor((at + 10800000) / 86400000) + 1) * 86400000 - 10800000;
  const daily = select(q.items.map(row => {
    const def = definitions.get(row.questId);
    return { id: row.id, name: def.name, description: def.description, metric: def.metric,
      progress: row.progress, target: def.target, claimed: row.claimedAt != null || row.expiredAt != null,
      priority: value[def.tier], reward: def.tier, expiresAt };
  }));
  const event = select(friday.arenaOrders(p, manager, at));
  const compact = row => {
    if (!row) return null;
    const { claimed, priority, ...data } = row;
    return data;
  };
  return { daily: compact(daily), event: compact(event), serverTime: at };
}
module.exports = { view, select };
