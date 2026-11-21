"use strict";
// Owner-approved correction of one verified, unmatched season. Never claw back currency.
const { createHash } = require("node:crypto");
const { copyRecord } = require("../profiles/copy-record");
const deltas = require("../profiles/immutable-table-delta");
const ID = "983ed733-8699-4187-b488-72c0ca1604de";
const START = 1794936600000, END = 1795035600000;
const REQUEST = "trophy-correction-20261122-v1";
const matches = trophy => trophy.seasonId === ID && trophy.awardedAt === END;
function plan(data) {
  if (data.administration?.receipts?.[REQUEST]) return null;
  const season = data.clanQuests?.seasons?.find(s => s.id === ID);
  if (!season || season.startsAt !== START || season.endsAt !== END) return null;
  // A saved battle contradicts the incident's evidence: retain everything for manual review.
  for (const clan of Object.values(data.clans)) {
    if ((clan.battleHistory || []).some(b => b.endedAt > START && b.endedAt <= END)) return null;
    const b = data.competition?.lastBattle?.[clan.id];
    if (b?.opponent?.id && b.endedAt > START && b.endedAt <= END) return null;
  }
  const clans = Object.keys(data.clans).filter(id => data.clans[id].competition?.trophies?.some(matches));
  const profiles = Object.keys(data.profiles).filter(key => data.profiles[key].seasonTrophies?.some(matches));
  return clans.length || profiles.length ? { clans, profiles } : null;
}
function apply(data, at) {
  const selected = plan(data);
  if (!selected) return data;
  const clans = copyRecord(data.clans), profiles = copyRecord(data.profiles);
  for (const id of selected.clans) {
    const clan = clans[id];
    clans[id] = { ...clan, competition: { ...clan.competition, trophies: clan.competition.trophies.filter(t => !matches(t)) } };
  }
  for (const key of selected.profiles) {
    const p = profiles[key];
    if (!Number.isSafeInteger(p.revision + 1)) throw Error("Превышен номер версии профиля.");
    const next = profiles[key] = { ...p, revision: p.revision + 1, seasonTrophies: p.seasonTrophies.filter(t => !matches(t)) };
    if (p.clanChests?.notices?.some(n => n.at === END && n.kind === "reward" && n.text.startsWith("Кубок за 3 сезон")))
      next.clanChests = { ...p.clanChests, notices: p.clanChests.notices.map(n =>
        n.at === END && n.kind === "reward" && n.text.startsWith("Кубок за 3 сезон")
          ? { ...n, text: "Ошибочно выданный кубок отменён. Валютная награда сохранена." }
          : n) };
  }
  const prior = data.administration || { version: 1, audit: [], receipts: {} };
  const event = { id: REQUEST, requestId: REQUEST, at, actorId: "system:owner-approved-repair", actorName: "Исправление игры",
    targetId: "season:" + ID, targetName: "I Сезон 2026", action: "trophyCorrection", label: "Исправление ошибочных кубков",
    reason: "Клановых битв в этом сезоне не было. По решению владельца кубки и скидки отменены; валюта и уже выданные награды сохранены.",
    before: { clanIds: selected.clans, playerIds: selected.profiles.map(key => profiles[key].id), seasonId: ID },
    after: { removedClanCups: selected.clans.length, removedPersonalCups: selected.profiles.length, currencyUnchanged: true } };
  const administration = { ...prior, audit: [...prior.audit, event], receipts: { ...prior.receipts,
    [REQUEST]: { signature: createHash("sha256").update(REQUEST + ID).digest("hex"), eventId: event.id, actorId: event.actorId } } };
  deltas.remember(profiles, data.profiles, selected.profiles, true);
  return { ...data, clans, profiles, administration };
}
module.exports = { plan, apply, ID, START, END, REQUEST };
