/* Расписание битв, группы лиг, подсчёт результатов и выдача наград. */
"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");
const { copyRecord } = require("../profiles/copy-record");
const { randomInt } = require("node:crypto");
const appearance = require("../profiles/league-appearance");
const appearanceTestAccess = require("../profiles/appearance-test-access");
const clanAppearance = require("./clan-appearance");
const seasonTrophies = require("./clan-season-trophies");
const activity = require("../progression/activity-achievements");
const tableDeltas = require("../profiles/immutable-table-delta");
const rules = require("../../../public/shared/clan-competition-rules"),
  chests = require("./clan-chest-rewards");
const { DAY, HOUR, BATTLE_LOSS_GREATNESS, dayStart, season, week, LEAGUES, zones, rewardPlan } =
  rules;
const zero = () => ({ kills: 0, members: {} });
const score = (period, id) => period?.scores[id] || zero();
function shuffle(ids, random = randomInt) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function groupSizes(count) {
  let available = count - (count % 2);
  while (available >= 10) {
    const groups = Math.ceil(available / 16);
    if (groups * 10 <= available) {
      const sizes = Array(groups).fill(10);
      let remaining = available - groups * 10;
      for (let i = 0; remaining; i = (i + 1) % groups)
        if (sizes[i] < 16) {
          sizes[i] += 2;
          remaining -= 2;
        }
      return sizes;
    }
    available -= 2;
  }
  return [];
}
function clanState(c) {
  const state = (c.competition ||= {
    league: 0,
    wins: 0,
    joined: {},
    recruits: {},
    frames: [],
    frame: null,
  });
  // Older saves have no medal ledger. Awards survive promotions and season resets.
  if (state.medals === undefined) state.medals = {};
  return state;
}
function eligible(c, id, at) {
  const s = c?.competition;
  return !!c?.members.includes(id) && !(s?.recruits?.[id] > at);
}
function canEnterBattle(c) {
  return !!c && c.members.length >= rules.BATTLE_MIN_MEMBERS;
}
function memberScore(period, c, id) {
  const s = score(period, c.id).members[id];
  return s && s.joinedAt === (c.competition.joined[id] || 0) ? s.kills : 0;
}
function participants(data, period, c) {
  return c.members
    .filter((id) => eligible(c, id, period.end - 1))
    .map((id) => ({
      id,
      kills: memberScore(period, c, id),
      joinedAt: c.competition.joined[id] || 0,
    }))
    .filter((x) => x.kills > 0);
}
function publicClan(c) {
  return c
    ? {
        id: c.id,
        name: c.name,
        prefix: c.prefix,
        emblem: c.emblem,
        crest: c.crest || null,
        frame: clanAppearance.selectedFrame(c),
      }
    : null;
}
function groups(data, at, random) {
  const list = [],
    w = week(at);
  for (let index = 0; index < LEAGUES.length; index++) {
    const ids = shuffle(
      Object.values(data.clans)
        .filter((c) => canEnterBattle(c) && clanState(c).league === index)
        .map((c) => c.id)
        .sort(),
      random,
    );
    for (const size of groupSizes(ids.length))
      list.push({
        id: w.id + "-" + index + "-" + list.length,
        league: index,
        clans: ids.splice(0, size),
      });
  }
  return { ...w, groups: list, scores: {} };
}
function startDay(data, at, random) {
  const state = data.competition,
    start = dayStart(at) + (data.clanQuests?.calendarVersion===1 ? 7 : 8) * HOUR,
    end = dayStart(at) + (data.clanQuests?.calendarVersion===1 ? 22 : 24) * HOUR;
  if (at < start || at >= end) return;
  const assigned = new Set(state.week.groups.flatMap((g) => g.clans));
  for (let league = 0; league < LEAGUES.length; league++) {
    const waiting = shuffle(
      Object.values(data.clans)
        .filter((c) => canEnterBattle(c) && clanState(c).league === league && !assigned.has(c.id))
        .map((c) => c.id)
        .sort(),
      random,
    );
    for (const size of groupSizes(waiting.length))
      state.week.groups.push({
        id: state.week.id + "-" + league + "-" + state.week.groups.length,
        league,
        clans: waiting.splice(0, size),
      });
  }
  const pairs = [],
    rosters = {};
  for (const group of state.week.groups) {
    const ids = shuffle(
      group.clans.filter((id) => canEnterBattle(data.clans[id])),
      random,
    );
    // A disbanded clan does not create a fake opponent or automatic victory.
    for (let i = 0; i + 1 < ids.length; i += 2) {
      pairs.push({ a: ids[i], b: ids[i + 1] });
      for (const id of [ids[i], ids[i + 1]])
        rosters[id] = data.clans[id].members.filter((p) => eligible(data.clans[id], p, at));
    }
  }
  state.day = { start, end, pairs, rosters, scores: {} };
  state.lastScheduledDay = dayStart(at);
}
function finishDay(data, at, byId) {
  const state = data.competition,
    day = state.day;
  if (!day) return;
  state.lastBattle = {};
  for (const pair of day.pairs) {
    const left = data.clans[pair.a],
      right = data.clans[pair.b];
    if (!left || !right) continue;
    const a = score(day, left.id).kills,
      b = score(day, right.id).kills,
      winner = a === b ? null : a > b ? left.id : right.id;
    require("./battle-history").append(left, right, a, b, at);
    if (winner) clanState(data.clans[winner]).wins++;
    for (const c of [left, right]) {
      // The whole current clan shares the defeat, including inactive members and recruits.
      // This is committed with the result and day=null, so retries cannot charge twice.
      if (winner && c.id !== winner)
        for (const id of c.members) {
          const p = byId.get(id);
          if (!p || p.clanId !== c.id || p.greatness === 0) continue;
          p.greatness = Math.max(0, p.greatness - BATTLE_LOSS_GREATNESS);
          p.revision++;
        }
      const people = rewardPlan(participants(data, day, c));
      for (const entry of people) {
        const p = byId.get(entry.id);
        if (!p || p.clanId !== c.id) continue;
        if (c.id === winner) activity.leagueEvent(p, "victory", 1, at);
        const tier = c.id === winner ? entry.tier : "fixed";
        const fixedReward = tier === "fixed" ? rules.battleFixedReward(c.id === winner) : null;
        let chest = null;
        if (tier === "fixed")
          chests.award(p, fixedReward, at, {
            multiply: false,
            label:
              "Клановая битва завершена: получено " +
              fixedReward.coins +
              " монет, " +
              fixedReward.crystals +
              " кристаллов" +
              (fixedReward.greatness ? " и " + fixedReward.greatness + " величие" : "") +
              ".",
          });
        else chest = chests.grant(p, tier, at, { clanId: c.id });
        chests.inventory(p).battleReward = {
          clanId: c.id,
          endedAt: at,
          tier,
          ...(fixedReward ? { fixedReward: { ...fixedReward } } : {}),
          status: chest ? (chest.stored ? "stored" : "available") : "credited",
          chestId: chest?.id || null,
          expiresAt: chest?.expiresAt || null,
        };
        p.revision++;
      }
      state.lastBattle[c.id] = {
        endedAt: at,
        own: a,
        enemy: b,
        won: winner === c.id,
        draw: !winner,
        opponent: publicClan(c === left ? right : left),
        rewardCounts:
          c.id === winner
            ? rules.rewardCounts(people.length)
            : { high: 0, medium: 0, low: 0, fixed: people.length },
      };
      if (c === right) {
        state.lastBattle[c.id].own = b;
        state.lastBattle[c.id].enemy = a;
      }
    }
  }
  state.day = null;
}
function table(data, group) {
  return group.clans
    .map((id) => ({
      ...publicClan(data.clans[id]),
      id,
      kills: score(data.competition.week, id).kills,
    }))
    .filter((c) => data.clans[c.id])
    .sort((a, b) => b.kills - a.kills || a.id.localeCompare(b.id));
}
function outcome(index, size, position, kills) {
  const z = zones(index, size);
  if (position < z.promote && kills >= LEAGUES[index].threshold)
    return index === 5 ? "champion" : "promote";
  return position >= size - z.demote ? "demote" : "stay";
}
function finishWeek(data, at, byId) {
  const state = data.competition,
    w = state.week;
  state.lastWeek = {};
  for (const group of w.groups) {
    const rows = table(data, group);
    rows.forEach((row, position) => {
      const c = data.clans[row.id],
        s = clanState(c),
        result = outcome(group.league, rows.length, position, row.kills);
      // Prizes depend on place. The kill threshold controls advancement only.
      const prizePlace = position < zones(group.league, rows.length).promote;
      if (prizePlace) {
        const medal = LEAGUES[group.league].id,
          count = (s.medals[medal] || 0) + 1;
        if (!Number.isSafeInteger(count)) throw Error("Превышен допустимый счёт медалей клана.");
        s.medals[medal] = count;
        clanAppearance.grant(c, group.league, at);
        for (const id of c.members) {
          const p = byId.get(id);
          if (p?.clanId === c.id) appearance.grant(p, group.league, at);
        }
      }
      if (result === "promote") s.league = Math.min(5, s.league + 1);
      if (result === "demote") s.league = Math.max(0, s.league - 1);
      for (const id of c.members) {
        const p = byId.get(id);
        if (p?.clanId === c.id) activity.leagueEvent(p, "league", s.league, at);
      }
      if (result === "champion") {
        if (!s.frames.includes("champion")) s.frames.push("champion");
        s.frame = "champion";
      }
      seasonTrophies.track(c, state.season, state.lastWeek[c.id]);
      const reward = prizePlace
        ? LEAGUES[group.league].reward
        : result === "stay"
          ? { coins: 100, crystals: 100, bucks: 1, greatness: 2 }
          : null;
      if (reward)
        for (const { id } of participants(data, w, c)) {
          const p = byId.get(id);
          if (p?.clanId !== c.id) continue;
          chests.award(p, reward, at, {
            label:
              "Награда за неделю: " +
              LEAGUES[group.league].name +
              ". " +
              (prizePlace
                ? "Призовое место: " +
                  (position + 1) +
                  "." +
                  (result === "stay" ? " Порог киллов не выполнен - клан остаётся в лиге." : "")
                : "Клан остался в лиге."),
          });
          p.revision++;
        }
      state.lastWeek[c.id] = {
        endedAt: at,
        result,
        place: position + 1,
        kills: row.kills,
        league: group.league,
        prizePlace,
      };
    });
  }
}
function advance(
  data,
  at,
  random = randomInt,
  byId = new Map(Object.values(data.profiles).map((p) => [p.id, p])),
) {
  for (const c of Object.values(data.clans)) {
    const s = clanState(c);
    for (const id of c.members) {
      const p = byId.peek ? byId.peek(id) : byId.get(id);
      if (p?.clanId === c.id && !p.activity?.leagueVisits?.includes(LEAGUES[s.league]?.id))
        activity.leagueEvent(byId.get(id), "league", s.league, at);
    }
    for (const id of c.members) if (s.joined[id] === undefined) s.joined[id] = 0;
    for (const [id, until] of Object.entries(s.recruits))
      if (until <= at || !c.members.includes(id)) delete s.recruits[id];
  }
  expireChests(byId, at);
  if (data.clanQuests) return advanceDeclared(data, at, random, byId);
  const currentSeason = season(at);
  if (!data.competition)
    data.competition = {
      version: 1,
      season: currentSeason,
      week: null,
      day: null,
      lastScheduledDay: null,
      lastBattle: {},
      lastWeek: {},
    };
  const state = data.competition;
  state.season.number ??= season(state.season.start).number;
  for (const c of Object.values(data.clans))
    seasonTrophies.track(c, state.season, state.lastWeek[c.id]);
  if (state.day && state.day.end <= at) finishDay(data, state.day.end, byId);
  if (state.week && state.week.end <= at) finishWeek(data, state.week.end, byId);
  if (state.season.end <= at) {
    seasonTrophies.finish(data, state.season, byId);
    for (const c of Object.values(data.clans)) {
      clanState(c).league = 0;
      for (const id of c.members) {
        const p = byId.get(id);
        if (p?.clanId === c.id) activity.leagueEvent(p, "league", 0, state.season.end);
      }
      c.competition.seasonPeak = { seasonId: currentSeason.id, league: 0 };
    }
    state.season = currentSeason;
    state.week = null;
    state.day = null;
    state.lastScheduledDay = null;
  }
  for (const c of Object.values(data.clans)) seasonTrophies.track(c, state.season);
  if (!state.week || state.week.end <= at) state.week = groups(data, at, random);
  if (!state.day && at >= dayStart(at) + (data.clanQuests?.calendarVersion===1 ? 7 : 8) * HOUR && at < dayStart(at) + (data.clanQuests?.calendarVersion===1?22:24) * HOUR && state.lastScheduledDay !== dayStart(at))
    startDay(data, at, random);
  // A reward settled after downtime still expires from its original award time.
  expireChests(byId, at);
}
function advanceDeclared(data, at, random, byId) {
  const announced = require('./daily-quests/service').active(data,at);
  let state = data.competition;
  if (!state) {
    const emptySeason = {id:'before-declared-seasons',number:0,start:at-1,end:at,settled:true};
    state = data.competition = {version:1,controlled:true,season:emptySeason,week:{...week(at),groups:[],scores:{}},day:null,lastScheduledDay:null,lastBattle:{},lastWeek:{}};
  }
  if (!state.controlled) {
    // Retain already-earned legacy scores. The current old battle concludes at
    // its original deadline; no new automatic battle or half-year is scheduled.
    state.controlled = true;
    state.season.end = Math.max(state.season.start+1, Math.min(state.season.end,state.day?.end || at));
    state.week.end = Math.max(state.week.start+1, Math.min(state.week.end,state.season.end));
  }
  const declaration=data.clanQuests.seasons.find(s=>s.id===state.season.id);
  if(declaration && !state.season.settled) {
    state.season.end=declaration.cancelled?Math.max(state.season.start+1,Math.min(state.season.end,at)):declaration.endsAt;
    if(state.day)state.day.end=Math.min(state.day.end,state.season.end);
    if(state.week)state.week.end=Math.min(state.week.end,state.season.end);
  }
  for (const c of Object.values(data.clans)) seasonTrophies.track(c,state.season,state.lastWeek[c.id]);
  if (state.day && (state.day.end<=at || (announced && announced.id!==state.season.id))) {
    const end = Math.min(state.day.end, announced?.startsAt ?? state.day.end);
    finishDay(data,end,byId);
  }
  const changing = announced && announced.id!==state.season.id;
  if (!state.season.settled && (state.season.end<=at || changing)) {
    if (changing) state.season.end=Math.max(state.season.start+1,Math.min(state.season.end,announced.startsAt));
    if (!state.week.settled) { finishWeek(data,Math.min(state.week.end,state.season.end),byId); state.week.settled=true; }
    for (const c of Object.values(data.clans)) seasonTrophies.track(c,state.season,state.lastWeek[c.id]);
    seasonTrophies.finish(data,state.season,byId);
    state.season.settled=true;
  }
  if (!announced) return;
  if (changing) {
    const number=announced.number??state.season.number+1;
    state.season={id:announced.id,name:announced.name,number,start:announced.startsAt,end:announced.endsAt};
    state.week=null; state.day=null; state.lastScheduledDay=null;
    for(const c of Object.values(data.clans)) {
      c.competition.league=0;
      c.competition.seasonPeak={seasonId:announced.id,league:0};
    }
  }
  if (state.week && !state.week.settled && state.week.end<=at) {finishWeek(data,state.week.end,byId);state.week.settled=true;}
  if (!state.week || state.week.settled) {
    state.week=groups(data,at,random);
    state.week.start=Math.max(state.week.start,state.season.start);
    state.week.end=Math.min(state.week.end,state.season.end);
  }
  if (!state.day && at>=dayStart(at)+(data.clanQuests?.calendarVersion===1?7:8)*HOUR && at<dayStart(at)+(data.clanQuests?.calendarVersion===1?22:24)*HOUR && state.lastScheduledDay!==dayStart(at)) {
    startDay(data,at,random);
    if(state.day) {state.day.start=Math.max(state.day.start,state.season.start);state.day.end=Math.min(state.day.end,state.season.end);}
  }
}
function expireChests(byId, at) {
  for (const p of byId.values())
    if (chests.needsExpiry(p, at)) {
      const draft = byId.get(p.id);
      if (chests.expire(draft, at)) draft.revision++;
    }
}
// get() is the write boundary for competition rewards. Unaffected profiles keep
// their identity; every mutated profile is isolated before any disk write.
function writableProfiles(data) {
  const keys = new Map(Object.entries(data.profiles).map(([key, p]) => [p.id, key])),
    copied = new Set();
  return {
    peek(id) {
      return data.profiles[keys.get(id)];
    },
    get(id) {
      const key = keys.get(id);
      if (key === undefined) return undefined;
      if (!copied.has(key)) {
        data.profiles[key] = copyProfile(data.profiles[key]);
        copied.add(key);
      }
      return data.profiles[key];
    },
    values() {
      return Object.values(data.profiles);
    },
  };
}
const capturedStates = new WeakSet();
function unchangedClanParticipation(next, previous) {
  if (next === previous) return true;
  const ids = Object.keys(next);
  if (ids.length !== Object.keys(previous).length) return false;
  // XP, capacity, crest, treasury and appearance do not change participation.
  // Membership and competition state are immutable across published worlds;
  // a changed reference takes the full path, including all validations.
  return ids.every((id) => {
    const clan = next[id], before = previous[id];
    return before && clan.id === before.id && clan.members === before.members &&
      clan.competition === before.competition;
  });
}
function stableCompetition(next, previous, at, validatedPrevious = false, cache, profileKeys) {
  // Only reuse a state already processed and validated here. Loading a save,
  // Calendar boundaries and membership edits still use the full path. A kill
  // changes scores, not schedules, rosters, league grants or chest deadlines.
  if (
    !next.competition ||
    !capturedStates.has(next.competition) ||
    next.competition !== previous.competition ||
    next.clanQuests !== previous.clanQuests ||
    !unchangedClanParticipation(next.clans, previous.clans) ||
    due(next, at, cache)
  )
    return false;
  // Participation stayed identical, but a separate clan edit can still change
  // trophy data. Validate those edits without traversing every untouched clan.
  if (next.clans !== previous.clans)
    for (const [id, clan] of Object.entries(next.clans))
      if (clan !== previous.clans[id]) seasonTrophies.validate(clan);
  // With a fully prepared previous world and unchanged participation, these
  // relationships have already been checked. Changed profiles are checked
  // below; loading or editing membership still takes the full validation path.
  if (!validatedPrevious) {
   const byId = new Map(Object.values(next.profiles).map((p) => [p.id, p]));
   for (const c of Object.values(next.clans)) {
    const state = c.competition;
    if (
      !state?.medals ||
      state.seasonPeak.seasonId !== next.competition.season.id ||
      state.seasonPeak.league < state.league ||
      Object.keys(state.joined).some((id) => !c.members.includes(id))
    )
      return false;
    for (const id of c.members) {
      const p = byId.get(id);
      if (
        state.joined[id] === undefined ||
        (p?.clanId === c.id && !p.activity?.leagueVisits?.includes(LEAGUES[state.league]?.id))
      )
        return false;
    }
   }
  }
  for (const key of profileKeys || Object.keys(next.profiles)) {
    const p = next.profiles[key];
    const before = previous.profiles[key];
    if (p === before) continue;
    if (p.clanId !== before?.clanId && (p.clanId || before?.clanId)) return false;
    const clan = next.clans[p.clanId];
    if (
      clan &&
      !p.activity?.leagueVisits?.includes(LEAGUES[clan.competition.league]?.id)
    )
      return false;
    if (!validatedPrevious || p.clanChests !== before?.clanChests) chests.validate(p);
    if (p.activity && (!validatedPrevious || p.activity !== before?.activity)) activity.validateActivity(p);
  }
  return true;
}
function captureStableScores(next, previous, at, profileKeys) {
  if (next.clanQuests && !require("./daily-quests/service").active(next,at)) return next;
  const day = next.competition.day;
  if (!day || at < day.start || at >= day.end) return next;
  let data = next;
  const copiedClans = new Set();
  const copiedProfiles = [];
  for (const key of profileKeys || Object.keys(next.profiles)) {
    const p = next.profiles[key];
    const before = previous.profiles[key];
    if (!before || p === before) continue;
    const gain = p.progress.kills - before.progress.kills, c = next.clans[p.clanId];
    if (gain <= 0 || before.clanId !== p.clanId || !c ||
        !eligible(c, p.id, at) || !day.rosters[c.id]?.includes(p.id)) continue;
    if (data === next) {
      data = { ...next, profiles: copyRecord(next.profiles), competition: {
        ...next.competition,
        day: { ...day, scores: { ...day.scores } },
        week: { ...next.competition.week, scores: { ...next.competition.week.scores } },
      } };
    }
    // Copy each affected score once, even when several clan members score in
    // the same sample. Never edit a score published to a previous snapshot.
    if (!copiedClans.has(c.id)) {
      for (const period of [data.competition.day, data.competition.week]) {
        const old = period.scores[c.id] || zero();
        period.scores[c.id] = { ...old, members: { ...old.members } };
      }
      copiedClans.add(c.id);
    }
    // The profile key is already known. Re-indexing the entire world here
    // performed an O(all profiles) scan for each small room score update.
    // A scored kill writes activity, greatness and revision. Title awards
    // replace honors before editing it. Inventory, operation receipts, chats
    // and event history remain read-only; copying them grows with account age.
    const scorer = data.profiles[key] = { ...p };
    if (p.activity) scorer.activity = structuredClone(p.activity);
    copiedProfiles.push(key);
    activity.leagueEvent(scorer, "kills", gain, at);
    addScores(data.competition, c, p.id, gain);
    chests.validate(scorer);
    if (scorer.activity) activity.validateActivity(scorer);
  }
  if (data !== next) {
    // The prior schedule, rosters and untouched scores were validated before
    // entering this path. Only these score rows have changed.
    for (const period of [data.competition.day, data.competition.week])
      for (const id of copiedClans) validateScore(period.scores[id]);
    tableDeltas.remember(data.profiles,next.profiles,copiedProfiles,true);
    capturedStates.add(data.competition);
  }
  return data;
}
function addScores(state, clan, id, gain) {
  for (const period of [state.day, state.week]) {
    const value = (period.scores[clan.id] ||= zero()), joinedAt = clan.competition.joined[id] || 0;
    if (!Number.isSafeInteger(value.kills + gain))
      throw Error("Превышен допустимый счёт клановой битвы.");
    value.kills += gain;
    const member = value.members[id];
    value.members[id] = { joinedAt, kills: (member?.joinedAt === joinedAt ? member.kills : 0) + gain };
  }
}
function capture(next, previous, at, { incremental = false, validatedPrevious = false, cache, profileKeys } = {}) {
  if (stableCompetition(next, previous, at, incremental && validatedPrevious, cache, profileKeys)) {
    const data = captureStableScores(next, previous, at, profileKeys);
    return data;
  }
  // Called only on persisted changes. Independent RNG never affects arena physics.
  const data = {
    ...next,
    clans: require("./battle-history").cloneClans(next.clans),
    profiles: copyRecord(next.profiles),
    ...(next.competition ? { competition: structuredClone(next.competition) } : {}),
  };
  const byId = writableProfiles(data);
  advance(data, at, randomInt, byId);
  const state = data.competition,
    day = state.day;
  for (const c of Object.values(data.clans)) {
    const old = previous.clans[c.id],
      s = clanState(c);
    for (const id of Object.keys(s.joined))
      if (!c.members.includes(id)) {
        delete s.joined[id];
        delete s.recruits[id];
      }
    for (const id of c.members)
      if (!old?.members.includes(id)) {
        s.joined[id] = at;
        if (data.clanQuests && c.ownerId !== id && !require("./daily-quests/service").active(data,at))
          s.recruits[id] = require("./daily-quests/engine").period(at).nextStart;
        else if (
          day &&
          day.start <= at &&
          day.end > at &&
          day.pairs.some((pair) => pair.a === c.id || pair.b === c.id)
        )
          s.recruits[id] = day.end;
      }
  }
  for (const [key, p] of Object.entries(data.profiles)) {
    const before = previous.profiles[key],
      gain = p.progress.kills - (before?.progress.kills || 0),
      c = data.clans[p.clanId];
    if (
      (data.clanQuests && !require("./daily-quests/service").active(data,at)) ||
      !before ||
      gain <= 0 ||
      before.clanId !== p.clanId ||
      !c ||
      !eligible(c, p.id, at) ||
      !day?.rosters[c.id]?.includes(p.id) ||
      at < day.start ||
      at >= day.end
    )
      continue;
    activity.leagueEvent(byId.get(p.id), "kills", gain, at);
    addScores(state, c, p.id, gain);
  }
  for (const p of Object.values(data.profiles)) {
    chests.validate(p);
    if (p.activity) activity.validateActivity(p);
  }
  validate(data);
  capturedStates.add(data.competition);
  return data;
}
function due(data, at, cache) {
  const s = data.competition;
  if (data.clanQuests) {
    const announced = require("./daily-quests/service").active(data,at);
    return !s?.controlled || (!s.season.settled && s.season.end<=at) || (!!announced && announced.id!==s.season.id) || (!!announced && (s.week.end<=at || (!s.day && s.lastScheduledDay!==dayStart(at) && at>=dayStart(at)+(data.clanQuests?.calendarVersion===1?7:8)*HOUR && at<dayStart(at)+(data.clanQuests?.calendarVersion===1?22:24)*HOUR))) || (s.day && s.day.end<=at) || (cache ? cache.worldChestExpiryDue(data.profiles,at,chests.needsExpiry) : Object.values(data.profiles).some(p=>chests.needsExpiry(p,at)));
  }
  if (!s || s.season.end <= at || s.week?.end <= at || s.day?.end <= at) return true;
  if (cache ? cache.clanExpiryDue(data.clans, at) :
    Object.values(data.clans).some((c) => !c.competition?.seasonPeak || !c.competition?.trophies))
    return true;
  if (!s.day && s.lastScheduledDay !== dayStart(at) && at >= dayStart(at) + (data.clanQuests?.calendarVersion===1 ? 7 : 8) * HOUR && at < dayStart(at) + (data.clanQuests?.calendarVersion===1?22:24) * HOUR) return true;
  return (
    (cache ? cache.worldChestExpiryDue(data.profiles, at, chests.needsExpiry)
      : Object.values(data.profiles).some((p) => chests.needsExpiry(p, at))) ||
    (!cache && Object.values(data.clans).some((c) =>
      Object.values(c.competition?.recruits || {}).some((end) => end <= at),
    ))
  );
}
function publicState(data, clan, at, parts = null) {
  const s = data.competition,
    own = clanState({ competition: structuredClone(clan.competition) }),
    group = s?.week?.groups.find((g) => g.clans.includes(clan.id));
  const pair = s?.day?.pairs.find((p) => p.a === clan.id || p.b === clan.id),
    other = pair && (pair.a === clan.id ? pair.b : pair.a);
  const personalState = () => {
    const people = s?.day ? participants(data, s.day, clan) : [],
      rewards = new Map(rewardPlan(people).map((p) => [p.id, p])),
      personal = {};
    for (const id of clan.members) {
      const kills = memberScore(s?.day, clan, id);
      personal[id] = {
        kills,
        reward: rewards.get(id)?.tier || null,
        place: rewards.get(id)?.place || null,
        recruitUntil: own.recruits[id] || null,
        weekKills: memberScore(s?.week, clan, id),
      };
    }
    return personal;
  };
  const state = {
    league: LEAGUES[own.league],
    wins: own.wins,
    hasGroup: !!group,
    frames: appearanceTestAccess.clan(clan)
      ? [...new Set([...own.frames, "champion"])]
      : own.frames,
    frame: clanAppearance.selectedFrame(clan),
    medals: { ...own.medals },
    get trophies() {
      return structuredClone(own.trophies || []);
    },
    seasonPeak: own.seasonPeak?.league ?? own.league,
    trophyBenefits: rules.trophyBenefits(clan, at),
    season: s?.season,
    week: s?.week ? { start: s.week.start, end: s.week.end } : null,
    get group() {
      return group
        ? {
            id: group.id,
            zones: zones(group.league, group.clans.length),
            rows: table(data, group).map((r, i) => ({
              ...r,
              place: i + 1,
              outcome: outcome(group.league, group.clans.length, i, r.kills),
            })),
          }
        : null;
    },
    battle:
      pair && data.clans[other]
        ? {
            start: s.day.start,
            end: s.day.end,
            own: score(s.day, clan.id).kills,
            enemy: score(s.day, other).kills,
            opponent: publicClan(data.clans[other]),
          }
        : null,
    nextBattleAt: dayStart(at) + (at < dayStart(at) + (data.clanQuests?.calendarVersion===1 ? 7 : 8) * HOUR ? (data.clanQuests?.calendarVersion===1?7:8) * HOUR : DAY + (data.clanQuests?.calendarVersion===1?7:8) * HOUR),
    get personal() {
      return personalState();
    },
    lastBattle: s?.lastBattle[clan.id] || null,
    lastWeek: s?.lastWeek[clan.id] || null,
  };
  if (!parts) return { ...state, ...require("./daily-quests/service").view(data,clan,at) };
  const fields = {
    preview: ["wins", "hasGroup", "battle", "nextBattleAt", "lastBattle", "medals", "trophies"],
    battle: ["wins", "battle", "nextBattleAt", "personal", "lastBattle"],
    league: ["league", "week", "group", "lastWeek", "seasonPeak"],
    identity: ["frames", "frame", "medals", "trophies", "trophyBenefits", "season"],
  };
  return { ...Object.assign({}, ...parts.map(part => require("./daily-quests/service").view(data,clan,at,part))), ...Object.fromEntries(
    parts.flatMap((part) => fields[part] || []).map((key) => [key, state[key]]),
  ) };
}
function validateScore(v) {
  const record = value => value && typeof value === "object" && !Array.isArray(value);
  const fail = () => { throw Error("Повреждены данные клановых соревнований. Сохранение не перезаписано."); };
  if (!record(v) || !Number.isSafeInteger(v.kills) || v.kills < 0 || !record(v.members)) fail();
  let total = 0;
  for (const m of Object.values(v.members)) {
    if (!Number.isSafeInteger(m.kills) || m.kills < 0 || !Number.isSafeInteger(m.joinedAt)) fail();
    total += m.kills;
  }
  if (total > v.kills) fail();
}
function validate(data) {
  const s = data.competition;
  if (!s) return;
  const fail = () => {
    throw Error("Повреждены данные клановых соревнований. Сохранение не перезаписано.");
  };
  const record = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (
    s.version !== 1 ||
    !s.season ||
    !Number.isSafeInteger(s.season.end) ||
    !s.week ||
    !Array.isArray(s.week.groups)
  )
    fail();
  if (
    !record(s.lastBattle) ||
    !record(s.lastWeek) ||
    !Number.isSafeInteger(s.season.start) ||
    s.season.start >= s.season.end
  )
    fail();
  const grouped = new Set(),
    groupIds = new Set();
  for (const g of s.week.groups) {
    if (
      typeof g.id !== "string" ||
      groupIds.has(g.id) ||
      !Number.isInteger(g.league) ||
      g.league < 0 ||
      g.league > 5 ||
      !Array.isArray(g.clans) ||
      g.clans.length < 10 ||
      g.clans.length > 16 ||
      g.clans.length % 2
    )
      fail();
    groupIds.add(g.id);
    for (const id of g.clans) {
      if (typeof id !== "string" || grouped.has(id)) fail();
      grouped.add(id);
    }
  }
  if (s.day) {
    if (!Array.isArray(s.day.pairs) || !record(s.day.rosters)) fail();
    const paired = new Set();
    for (const pair of s.day.pairs) {
      if (
        !record(pair) ||
        pair.a === pair.b ||
        !s.week.groups.some((g) => g.clans.includes(pair.a) && g.clans.includes(pair.b))
      )
        fail();
      for (const id of [pair.a, pair.b]) {
        const roster = s.day.rosters[id];
        if (
          paired.has(id) ||
          !Array.isArray(roster) ||
          roster.length > require('./clan-level-progress').CAPACITY_BANDS.at(-1)[1] ||
          new Set(roster).size !== roster.length ||
          roster.some((p) => typeof p !== "string")
        )
          fail();
        paired.add(id);
      }
    }
    if (Object.keys(s.day.rosters).some((id) => !paired.has(id))) fail();
  }
  for (const c of Object.values(data.clans)) {
    seasonTrophies.validate(c);
    const v = c.competition;
    if (
      !v ||
      !Number.isInteger(v.league) ||
      v.league < 0 ||
      v.league > 5 ||
      !Number.isSafeInteger(v.wins) ||
      v.wins < 0 ||
      !v.joined ||
      !v.recruits ||
      !Array.isArray(v.frames) ||
      v.frames.some((x) => x !== "champion") ||
      (v.frame !== null && !v.frames.includes(v.frame))
    )
      fail();
    if (
      v.medals !== undefined &&
      (!record(v.medals) ||
        Object.entries(v.medals).some(
          ([id, count]) =>
            !LEAGUES.some((league) => league.id === id) ||
            !Number.isSafeInteger(count) ||
            count < 0,
        ))
    )
      fail();
    if (
      Object.values(v.joined).some((n) => !Number.isSafeInteger(n) || n < 0) ||
      Object.values(v.recruits).some((n) => !Number.isSafeInteger(n) || n < 0)
    )
      fail();
  }
  for (const period of [s.week, s.day].filter(Boolean)) {
    if (
      !Number.isSafeInteger(period.start) ||
      !Number.isSafeInteger(period.end) ||
      period.end <= period.start ||
      !record(period.scores)
    )
      fail();
    for (const v of Object.values(period.scores)) validateScore(v);
  }
}
// Internal worker handshake. Calculation replicas run the same capture and
// validation as the owner. Structured cloning loses WeakSet identity; carry
// that knowledge explicitly instead of re-running all clan settlements after
// every accepted worker result. Never call this on client input or loaded data.
function isCaptured(data) {
  return !!data.competition && capturedStates.has(data.competition);
}
function adoptCapturedFromWorker(data) {
  if (!data.competition) return;
  capturedStates.add(data.competition);
}
module.exports = {
  isCaptured,
  adoptCapturedFromWorker,
  canEnterBattle,
  groupSizes,
  eligible,
  memberScore,
  clanState,
  advance,
  capture,
  due,
  publicState,
  validate,
  outcome,
};
