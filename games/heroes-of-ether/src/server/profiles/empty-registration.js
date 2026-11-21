"use strict";
const { isDeepStrictEqual: equal } = require("node:util");
const { freshProgress } = require("../progression/experience-progression");
const { freshHonors } = require("../progression/title-chest-rewards");
const { freshActivity } = require("../progression/activity-achievements");
const defaults = {
  wallet: { coins: 100, crystals: 10, bucks: 0 }, inventory: {}, receipts: {},
  personal: { nameSet: false, gender: "unspecified", vkUrl: "", introPending: true },
  skinId: "moon-dragon", level: 1, greatness: 0, clanId: null, quickSlots: [],
  outfit: { bow: null, hat: null }, wardrobeState: require("./wardrobe-state").fresh(),
  progress: freshProgress(), honors: freshHonors(), seasonTrophies: [],
  pets: require("../pets/pet-service").fresh(), roulette: require("../roulette/roulette-service").fresh(),
};
const optional = {
  account: require("../accounts/account-benefits").fresh(),
  social: { marriage: null, invitations: [], gifts: [], inviteReadyAt: 0 },
  appearance: { lobbyBackground: "default", avatarFrame: "default", profileBackground: "default",
    arenaFrame: "default", uiTheme: "default", grants: {}, grantVersion: 2 },
};
const keys = new Set([...Object.keys(defaults), ...Object.keys(optional),
  "id", "name", "revision", "activity", "quests", "transactions", "daily"]);
const only = (value, allowed) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every(key => allowed.includes(key));
const zeroBalance = { coins: 0, crystals: 0, bucks: 0, vipUntil: 0, premiumUntil: 0 };
const initialBalance = { ...zeroBalance, coins: 100, crystals: 10 };

// Fail closed: an unknown branch, an old migrated wardrobe, any receipt,
// sanction, reward, play session or even a spent gift protects the account.
// Only the automatic starter balance and unstarted daily tasks are disposable.
function isEmptyRegistration(p) {
  if (!p || Object.keys(p).some(key => !keys.has(key)) ||
      typeof p.id !== "string" || !/^Путник(?: [1-9]\d*)?$/.test(p.name) ||
      !Number.isSafeInteger(p.revision) || p.revision < 1) return false;
  for (const [key, value] of Object.entries(defaults)) if (!equal(p[key], value)) return false;
  for (const [key, value] of Object.entries(optional)) if (p[key] !== undefined && !equal(p[key], value)) return false;
  const a = p.activity, registeredAt = a?.registeredAt;
  if (!Number.isSafeInteger(registeredAt) || registeredAt <= 0) return false;
  const initial = freshActivity(registeredAt);
  initial.values.regular = 1; initial.streak = 1;
  initial.lastVisitDay = Math.floor((registeredAt + 5 * 3600000) / 86400000);
  initial.trackedAt = a.trackedAt;
  if (!Number.isSafeInteger(a.trackedAt) || a.trackedAt < registeredAt || !equal(a, initial)) return false;
  const q = p.quests;
  if (!only(q, ["rulesVersion", "day", "rerolls", "items", "pending", "session"]) ||
      (q.rulesVersion !== undefined && q.rulesVersion !== 1) || q.rerolls !== 0 ||
      q.session !== null || !equal(q.pending, []) || !Array.isArray(q.items) || q.items.length !== 4 ||
      q.items.some(row => !only(row, ["id", "questId", "assignedAt", "progress", "completedAt", "claimedAt"]) ||
        row.progress !== 0 || row.completedAt !== null || row.claimedAt !== null)) return false;
  if (p.daily !== undefined && (!only(p.daily, ["day", "kills", "arenaSeconds", "greatness"]) ||
      p.daily.kills !== 0 || p.daily.arenaSeconds !== 0 || p.daily.greatness !== 0)) return false;
  const log = p.transactions, e = log?.entries?.[0];
  return !!(only(log, ["version", "startedAt", "opening", "entries"]) && log.version === 1 &&
    equal(log.opening, zeroBalance) && log.entries.length === 1 &&
    only(e, ["id", "at", "kind", "label", "before", "after"]) && log.startedAt === e.at &&
    e.at >= registeredAt && e.at - registeredAt < 60000 &&
    e.kind === "registration" && equal(e.before, zeroBalance) && equal(e.after, initialBalance));
}
module.exports = { isEmptyRegistration };
