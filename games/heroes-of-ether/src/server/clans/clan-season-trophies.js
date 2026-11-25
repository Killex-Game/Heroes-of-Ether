"use strict";
const rules = require("../../../public/shared/clan-competition-rules"),
  chests = require("./clan-chest-rewards"),
  { MONTH } = require("../profiles/league-appearance");
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const activity = require("../progression/activity-achievements");
const personalTrophies = require("../profiles/season-trophy-history");
function track(clan, season, lastWeek) {
  const state = clan.competition;
  state.trophies ||= [];
  if (!state.seasonPeak || state.seasonPeak.seasonId !== season.id) {
    let league = state.league;
    // Recover only dated evidence belonging to this season; all-time medals are insufficient.
    if (lastWeek?.endedAt >= season.start && lastWeek.endedAt <= season.end)
      league = Math.max(
        league,
        lastWeek.league,
        Math.min(5, lastWeek.league + (lastWeek.result === "promote" ? 1 : 0)),
      );
    for (const [id, until] of Object.entries(clan.appearance?.grants || {})) {
      const grantedAt = typeof until === "number" ? until - MONTH : null;
      if (grantedAt !== null && grantedAt >= season.start && grantedAt <= season.end)
        league = Math.max(
          league,
          rules.LEAGUES.findIndex((l) => l.id === id),
        );
    }
    state.seasonPeak = { seasonId: season.id, league };
  }
  state.seasonPeak.league = Math.max(state.seasonPeak.league, state.league);
}
function finish(data, season, byId) {
  for (const clan of Object.values(data.clans)) {
    const state = clan.competition;
    if (state.trophies.some((trophy) => trophy.seasonId === season.id)) continue;
    // Membership or an unmatched league group alone cannot earn a season cup.
    const fought = (clan.battleHistory || []).some(battle =>
      battle.endedAt > season.start && battle.endedAt <= season.end &&
      battle.sides?.length === 2 && battle.sides.some(side => side.id === clan.id));
    const previous = data.competition?.lastBattle?.[clan.id];
    if (!fought && !(previous?.opponent?.id && previous.endedAt > season.start && previous.endedAt <= season.end)) continue;
    const league = state.seasonPeak.league,
      trophy = {
        seasonId: season.id,
        number: season.number ?? rules.season(season.start).number,
        league,
        awardedAt: season.end,
        year: new Date(season.end + rules.MSK).getUTCFullYear(),
      },
      prize = rules.SEASON_PRIZES[league];
    for (const id of clan.members) {
      const p = byId.get(id);
      if (p?.clanId !== clan.id) continue;
      if (!personalTrophies.grant(p, trophy)) continue;
      activity.leagueEvent(p, "cup", league, season.end);
      chests.award(p, prize.reward, season.end, {
        multiply: false,
        result:{kind:"season",sourceId:"battle-season:"+season.id+":"+clan.id,
          title:"Сезон клановых битв завершён",headline:rules.trophyLabel(trophy),
          detail:"Сезонная награда получена",clanName:clan.name,positive:true},
        label: `${rules.trophyLabel(trophy)}. Награда: ${prize.reward.coins} монет, ${prize.reward.crystals} кристаллов, ${prize.reward.bucks} эфира. Скидка клана: ${prize.discount}%.`,
      });
      if (!Number.isSafeInteger(p.revision + 1)) throw Error("Превышен номер версии профиля.");
      p.revision++;
    }
    // Ledger and all wallets are committed in the same atomic ProfileStore save.
    state.trophies.push(trophy);
  }
}
function validate(clan) {
  const state = clan.competition;
  if (!state) return;
  const fail = () => {
    throw Error("Повреждена история сезонных кубков клана. Сохранение не перезаписано.");
  };
  const validLeague = (n) => Number.isInteger(n) && n >= 0 && n < rules.LEAGUES.length;
  if (
    state.seasonPeak !== undefined &&
    (!state.seasonPeak ||
      typeof state.seasonPeak.seasonId !== "string" ||
      !validLeague(state.seasonPeak.league))
  )
    fail();
  if (state.trophies === undefined) return;
  if (!Array.isArray(state.trophies)) fail();
  const seen = new Set();
  for (const trophy of state.trophies) {
    if (
      !trophy ||
      typeof trophy.seasonId !== "string" ||
      !trophy.seasonId ||
      seen.has(trophy.seasonId) ||
      !Number.isSafeInteger(trophy.number) ||
      !validLeague(trophy.league) ||
      !integer(trophy.awardedAt) ||
      !Number.isSafeInteger(trophy.year) ||
      trophy.year !== new Date(trophy.awardedAt + rules.MSK).getUTCFullYear()
    )
      fail();
    seen.add(trophy.seasonId);
  }
}
module.exports = { track, finish, validate };
