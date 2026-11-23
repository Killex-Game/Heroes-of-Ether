"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");
const { profileKeys } = require("../profiles/profile-index");

const { awardExtra, validateActivity } = require("./activity-achievements");
const { awardTitles } = require("./title-chest-rewards");
const tableDeltas = require("../profiles/immutable-table-delta");
const day = (at) => Math.floor((at + 3 * 3600000) / 86400000);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
function validate(p) {
  const s = p.activity?.socialCalendar;
  if (
    s !== undefined &&
    (!s ||
      !integer(s.day) ||
      ![s.loveThrough, s.togetherThrough].every((n) => n === null || integer(n)) ||
      ![s.loveKey, s.togetherKey].every((k) => k === null || typeof k === "string"))
  )
    throw Error("Повреждён календарь брака.");
}
const due = (world, at, cache) => {
  const today = day(at), check = p => p.social?.marriage &&
    (!p.activity.socialCalendar || p.activity.socialCalendar.day < today);
  return cache ? cache.matchingProfiles("socialCalendarDue",world.profiles,check,today).size > 0
    : Object.values(world.profiles).some(check);
};
function settle(world, at, keys) {
  let byId;
  const changed = [];
  let next = world;
  for (const key of keys || Object.keys(world.profiles)) {
    const original = world.profiles[key];
    validate(original);
    const m = original.social?.marriage;
    if (!m) continue;
    // Reuse only the identity-to-key index. Read the spouse from this exact
    // world so progress, divorce and clan changes never use an old profile.
    byId ||= profileKeys(world.profiles);
    const spouseKey = byId.get(m.partnerId);
    const spouse = spouseKey === undefined ? undefined : world.profiles[spouseKey];
    if (spouse?.social?.marriage?.partnerId !== original.id) continue;
    const loveKey = `${m.partnerId}:${m.at}`;
    const shared = original.clanId && original.clanId === spouse.clanId;
    const since = shared
      ? Math.max(m.at, original.activity.clanSince, spouse.activity.clanSince)
      : null;
    const togetherKey = shared ? `${loveKey}:${original.clanId}:${since}` : null;
    const old = original.activity.socialCalendar;
    if (old?.day >= day(at) && old.loveKey === loveKey && old.togetherKey === togetherKey) continue;
    const p = copyProfile(original),
      a = p.activity;
    const loveThrough = old?.loveKey === loveKey ? old.loveThrough : day(m.at);
    const togetherThrough = shared
      ? old?.togetherKey === togetherKey
        ? old.togetherThrough
        : day(since)
      : null;
    a.values.strong_love += Math.max(0, day(at) - loveThrough);
    if (shared) a.values.always_together += Math.max(0, day(at) - togetherThrough);
    a.socialCalendar = {
      day: day(at),
      loveKey,
      loveThrough: Math.max(day(at), loveThrough),
      togetherKey,
      togetherThrough: shared ? Math.max(day(at), togetherThrough) : null,
    };
    awardExtra(p, at);
    awardTitles(p, at);
    validateActivity(p);
    p.revision++;
    if (next === world) next = { ...world, profiles: { ...world.profiles } };
    next.profiles[key] = p;
    changed.push(key);
  }
  if (next !== world) tableDeltas.remember(next.profiles, world.profiles, changed);
  return next;
}
module.exports = { day, due, settle, validate };
