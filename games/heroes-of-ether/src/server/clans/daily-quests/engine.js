"use strict";
// Pure daily rules. The service commits boards and prizes with the existing WAL.
const { createHash } = require("node:crypto");
const DAY = 86400000, HOUR = 3600000, MSK = 3 * HOUR;
const WINDOW_VERSION = 4, ACTIVE_MS = 15 * HOUR, RESULTS_MS = 2 * HOUR;
const GROUPS = ["resources", "combat", "precision", "arsenal", "endurance"];
const METRICS = new Set(["xp", "food", "absorbedMass", "hazards", "kills", "jumpKills",
  "hazardHits", "rocketHits", "freezeHits", "hookHits", "pushHits", "poisonHits",
  "commonUses", "advancedUses", "rareUses", "shieldUses", "boosterUses", "allBoosterUses", "clanUses",
  "arenaSeconds", "top10Seconds", "top1Seconds", "arenaMs", "top10Ms", "top1Ms", "splitParts", "gifts"]);
const positive = n => Number.isSafeInteger(n) && n > 0;
const hash = value => createHash("sha256").update(value).digest("hex");
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !Object.hasOwn(Object.prototype, value);
function period(at) {
  if (!Number.isSafeInteger(at) || at < 0) throw Error("Invalid server time");
  const start = Math.floor((at + MSK - 6 * HOUR) / DAY) * DAY - MSK + 6 * HOUR;
  return { id: new Date(start + MSK).toISOString().slice(0, 10), start,
    end: start + ACTIVE_MS, nextStart: start + DAY, active: at < start + ACTIVE_MS };
}
const questGreatness = metric => metric === 'xp' ? 15 : metric === 'kills' ? 10 : 5;
function validateCatalog(catalog) {
  if (!catalog || !Number.isSafeInteger(catalog.version) || catalog.version < 1 || !Array.isArray(catalog.items))
    throw Error("Invalid catalog");
  const ids = new Set();
  for (const q of catalog.items) {
    if (!/^[a-z0-9_-]{1,40}$/.test(q.id) || ids.has(q.id) || !GROUPS.includes(q.group) ||
        !METRICS.has(q.metric) || !positive(q.target) || !q.name?.trim() ||
        !q.reward || !["coins", "crystals", "bucks", "clanChest"].includes(q.reward.kind) ||
        !positive(q.reward.amount) || (q.reward.kind === "clanChest" && !["low", "medium", "high"].includes(q.reward.tier)))
      throw Error("Invalid quest: " + q?.id);
    ids.add(q.id);
  }
  if (GROUPS.some(group => !catalog.items.some(q => q.group === group))) throw Error("Missing daily group");
}
function dailySelection(catalog, at, clanId = "legacy", members = 50, availableMs = ACTIVE_MS) {
  validateCatalog(catalog);
  const day = period(at);
  if (!Number.isSafeInteger(members) || members <= 0 || availableMs<=0) return [];
  const available = catalog.items.filter(q => !q.metric.endsWith('Ms') || q.target <= members * availableMs)
    .sort((a,b) => hash(`${catalog.version}:${day.id}:${clanId}:${a.id}`).localeCompare(hash(`${catalog.version}:${day.id}:${clanId}:${b.id}`)));
  const xp = available.find(q => q.metric === 'xp');
  if (!xp) throw Error('Missing feasible experience quest');
  const kills = available.find(q => q.metric === 'kills');
  if (!kills) throw Error('Missing feasible kills quest');
  const others = available.filter(q => q.metric !== 'xp' && q.metric !== 'kills').slice(0,3);
  if (others.length !== 3) throw Error('Missing feasible daily quests');
  return [xp, kills, ...others];
}
function createBoard(clanId, catalog, at, eligible = null, availableMs = ACTIVE_MS) {
  if (!validId(clanId)) throw Error("Missing clan");
  const day = period(at);
  return { version: 1, clanId, day: day.id, start: day.start, end: day.end,
    catalogVersion: catalog.version, contributors: {}, cursors: {},
    ...(eligible ? {eligible: {...eligible}} : {}),
    quests: dailySelection(catalog, at, clanId, eligible ? Object.keys(eligible).length : 50, availableMs)
      .map(q => ({ ...structuredClone(q), progress: 0, completedAt: null })) };
}
function record(board, event, pledge = null) {
  // One server-assigned monotonically increasing sequence per player, all deltas
  // from the same committed progress batch. Never accept this object from HTTP/WS.
  if (!event || !validId(event.playerId) || !validId(event.clanId) ||
      !positive(event.sequence) || !Number.isSafeInteger(event.at) ||
      !event.deltas || Array.isArray(event.deltas) || typeof event.deltas !== "object") throw Error("Invalid contribution");
  for (const [metric, value] of Object.entries(event.deltas))
    if (!METRICS.has(metric) || !Number.isSafeInteger(value) || value < 0) throw Error("Invalid progress delta");
  const no = () => ({ board, pledge, accepted: false });
  if (board.settledAt || event.clanId !== board.clanId || event.at < board.start || event.at >= board.end ||
      (board.eligible && !Object.hasOwn(board.eligible, event.playerId)) ||
      (pledge?.day === board.day && pledge.clanId !== board.clanId) ||
      event.sequence <= (board.cursors[event.playerId] || 0)) return no();
  const changes = board.quests.map(q => Math.min(q.target - q.progress, event.deltas[q.metric] || 0));
  if (!changes.some(n => n > 0)) return no();
  // Boards are immutable snapshots. Keep the catalog, eligibility and earlier
  // contributions shared; copying their full history for every arena event
  // makes the cost grow with the clan even when only one counter changes.
  const next = { ...board,
    cursors: { ...board.cursors, [event.playerId]: event.sequence },
    contributors: board.contributors[event.playerId] != null ? board.contributors :
      { ...board.contributors, [event.playerId]: { firstAt: event.at } },
    quests: board.quests.map((q, i) => {
      const progress = q.progress + changes[i];
      const completedAt = progress === q.target && q.completedAt === null ? event.at : q.completedAt;
      return progress === q.progress && completedAt === q.completedAt ? q : { ...q, progress, completedAt };
    }),
  };
  return { board: next, pledge: { day: board.day, clanId: board.clanId }, accepted: true };
}
function rewardPlan(board, at, members = null) {
  if (at < board.end || board.settledAt) return [];
  // Durable intents; production must claim receipt and change wallet/inventory
  // atomically. Re-running this pure function intentionally returns the same IDs.
  return Object.keys(board.contributors).filter(id => (!board.eligible || Object.hasOwn(board.eligible,id)) && (!members || members.includes(id))).sort().flatMap(playerId => board.quests
    .filter(q => q.completedAt !== null).map(q => ({
      id: hash(`clan-quest:${board.day}:${board.clanId}:${q.id}:${playerId}`),
      playerId, clanId: board.clanId, day: board.day, questId: q.id,
      reward: structuredClone(q.reward), greatness: questGreatness(q.metric), earnedAt: board.end,
    })));
}
function ranking(clans, boards, at) {
  const day = period(at).id;
  const rows = clans.map(c => {
    const done = boards[c.id]?.day === day ? boards[c.id].quests.filter(q => q.completedAt !== null) : [];
    return { id:c.id, name:c.name, prefix:c.prefix, emblem:c.emblem, crest:c.crest,
      level:c.level || 1, completed:done.length, reachedAt:done.length ? Math.max(...done.map(q=>q.completedAt)) : null };
  });
  rows.sort((a,b) => b.completed-a.completed || (a.reachedAt??Infinity)-(b.reachedAt??Infinity) || b.level-a.level || a.id.localeCompare(b.id));
  return rows.map((row,i)=>({...row,rank:i+1}));
}
module.exports = { period, createBoard, record, rewardPlan, ranking, dailySelection, validateCatalog, questGreatness, WINDOW_VERSION, ACTIVE_MS, RESULTS_MS, GROUPS, METRICS };
