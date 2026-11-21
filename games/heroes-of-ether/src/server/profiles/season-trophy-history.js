"use strict";
const rules = require("../../../public/shared/clan-competition-rules");
const newestFirst = (a, b) => b.awardedAt - a.awardedAt || b.number - a.number;
function validate(profile) {
  if (profile.seasonTrophies === undefined) return;
  // Reuse the clan ledger's date, league and event-uniqueness checks.
  require("../clans/clan-season-trophies").validate({
    competition: { trophies: profile.seasonTrophies },
  });
}
function grant(profile, trophy) {
  const history = (profile.seasonTrophies ||= []);
  if (history.some((entry) => entry.seasonId === trophy.seasonId)) return false;
  history.push({ ...trophy });
  return true;
}
function view(profile) {
  return (profile.seasonTrophies || []).map((entry) => ({ ...entry })).sort(newestFirst);
}
function migrate(data) {
  // Old saves only retained payout notices. Membership today is not evidence
  // that a player received a cup in the past. Never issue money during recovery.
  const evidence = new Map();
  for (const clan of Object.values(data.clans))
    for (const trophy of clan.competition?.trophies || []) {
      const key = trophy.awardedAt + ":" + rules.trophyLabel(trophy);
      if (!evidence.has(key)) evidence.set(key, new Map());
      evidence.get(key).set(trophy.seasonId, trophy);
    }
  let changed = false;
  for (const profile of Object.values(data.profiles)) {
    if (profile.seasonTrophies !== undefined) continue;
    profile.seasonTrophies = [];
    changed = true;
    for (const notice of profile.clanChests?.notices || []) {
      if (notice.kind !== "reward") continue;
      const label = notice.text.split(". Награда:")[0];
      const candidates = evidence.get(notice.at + ":" + label);
      if (candidates?.size === 1) grant(profile, candidates.values().next().value);
    }
    if (profile.seasonTrophies.length) {
      if (!Number.isSafeInteger(profile.revision + 1))
        throw Error("Превышен номер версии профиля.");
      profile.revision++;
    }
    validate(profile);
  }
  return changed;
}
module.exports = { grant, view, validate, migrate };
