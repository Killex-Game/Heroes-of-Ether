"use strict";
const calendar = require("../../../../public/shared/clan-season-calendar");
const {copyProfile} = require("../../profiles/owned-profile-draft");
const {copyRecord} = require("../../profiles/copy-record");
const deltas = require("../../profiles/immutable-table-delta");
const chests = require("../clan-chest-rewards");
const {clanProgress} = require("../clan-level-progress");
const fresh = s => ({id:s.id,start:s.start,end:s.end,number:s.number,scores:{},days:{},contributorVersion:1,contributors:{}});
function rememberContributors(state, clanId, board, receipt = false) {
  if (state.settledAt) return;
  const ids = receipt
    ? (Number.isSafeInteger(board.earnedAt) && board.earnedAt > state.start && board.earnedAt <= state.end ? board.members || [] : [])
    : Object.entries(board.contributors || {}).filter(([,v]) => Number.isSafeInteger(v?.firstAt) && v.firstAt >= state.start && v.firstAt < state.end).map(([id]) => id);
  if (!ids.length) return;
  const known = state.contributors[clanId] || [];
  state.contributors[clanId] = [...new Set([...known,...ids])].sort();
}
function hydrateContributors(state, data) {
  if (state.settledAt || state.contributorVersion === 1) return;
  state.contributorVersion = 1; state.contributors = {};
  // Retained daily payout recipients are positive contribution evidence. Never
  // infer participation from clan membership or invent missing historical events.
  for (const receipt of Object.values(data.clanQuestRewards || {})) rememberContributors(state,receipt.clanId,receipt,true);
}
function add(state, clanId, day, quests) {
  const eligible = quests.filter(q => Number.isSafeInteger(q.completedAt) &&
    q.completedAt >= state.start && q.completedAt < state.end);
  if (!eligible.length || state.settledAt) return;
  const key = `${day}:${clanId}`, known = state.days[key] || [];
  const unseen = eligible.filter(q => !known.includes(q.id));
  if (!unseen.length) return;
  state.days[key] = [...known, ...unseen.map(q => q.id)];
  const prior = state.scores[clanId] || {completed:0,reachedAt:0};
  const completed = prior.completed + unseen.length;
  if (!Number.isSafeInteger(completed)) throw Error("Clan season score overflow");
  state.scores[clanId] = {completed, reachedAt:Math.max(prior.reachedAt,...unseen.map(q=>q.completedAt))};
}
function rows(data, state) {
  return Object.values(data.clans).map(c => ({id:c.id,name:c.name,prefix:c.prefix,emblem:c.emblem,crest:c.crest,
    level:clanProgress(c.xp).level,completed:state?.scores[c.id]?.completed || 0,
    reachedAt:state?.scores[c.id]?.reachedAt || null}))
    .sort((a,b)=>b.completed-a.completed || (a.reachedAt??Infinity)-(b.reachedAt??Infinity) ||
      b.level-a.level || a.id.localeCompare(b.id))
    .map((row,i)=>({...row,rank:i+1,prize:row.completed ? calendar.questPrize(i+1)?.id || null : null}));
}
function current(data, at) {
  const season = calendar.season(at, data.clanQuests?.calendarSchedule), saved = data.clanQuests?.questSeason;
  if (season.mode !== "quests") return saved || null;
  const state = saved?.id === season.id ? structuredClone(saved) : fresh(season);
  hydrateContributors(state,data);
  if (!state.settledAt) for (const clan of Object.values(data.clans)) {
    const board = clan.dailyQuests?.board;
    if (board) { add(state,clan.id,board.day,board.quests); rememberContributors(state,clan.id,board); }
  }
  return state;
}
// Called at daily/calendar boundaries only, never for every arena contribution.
// Counts each durable quest once, independently of the number of contributors.
function capture(data, at, boards, {canSettle=true}={}) {
  if (data.clanQuests?.calendarVersion !== 1) return data;
  const season = calendar.season(at, data.clanQuests?.calendarSchedule), control = data.clanQuests;
  let state = control.questSeason && structuredClone(control.questSeason);
  if (!state && season.mode === "quests") {
    state = fresh(season);
    // Only retained dated evidence from this season. Never fabricate past days.
    for (const receipt of Object.values(data.clanQuestRewards || {})) {
      add(state,receipt.clanId,receipt.day,receipt.quests); rememberContributors(state,receipt.clanId,receipt,true);
    }
  }
  if (state) {
    hydrateContributors(state,data);
    for (const [clanId, board] of boards) if (board) { add(state,clanId,board.day,board.quests); rememberContributors(state,clanId,board); }
  }
  let next = data, archives = control.questSeasonHistory || {};
  if (state && !state.settledAt && state.end <= at) {
    if (!canSettle) return {...data,clanQuests:{...control,questSeason:state,nextAt:Math.min(control.nextAt,state.end)}};
    const ranked = rows(data,state).filter(r=>r.completed>0 && r.rank<=30);
    const recipients = [], changed = [], profileKeys = new Map(Object.entries(data.profiles).map(([k,p])=>[p.id,k]));
    let profiles = data.profiles, clans = data.clans;
    if (!archives[state.id]) for (const row of ranked) {
      const clan = data.clans[row.id], prize = calendar.questPrize(row.rank);
      const medal = {seasonId:state.id,number:state.number,tier:prize.id,place:row.rank,
        completed:row.completed,awardedAt:state.end};
      const members = [];
      for (const id of clan.members) {
        const key = profileKeys.get(id), original = key === undefined ? null : data.profiles[key];
        if (!original || original.clanId !== clan.id || !state.contributors[clan.id]?.includes(id)) continue;
        if (original.clanQuestMedals?.some(m=>m.seasonId===state.id))
          throw Error("Clan season medal exists without reward receipt");
        if (profiles === data.profiles) profiles = copyRecord(profiles);
        const p = profiles[key] = copyProfile(original);
        p.clanQuestMedals = [...(p.clanQuestMedals || []),medal];
        require('../../progression/clan-quest-achievements').season(p, state.end);
        chests.award(p,prize.reward,state.end,{multiply:false,label:
          `${prize.name} медаль за сезон клановых заданий. Место ${row.rank}. ${prize.reward.bucks} эфира, ${prize.reward.coins} монет, ${prize.reward.crystals} кристаллов, ${prize.reward.greatness} величия.`});
        p.revision++; changed.push(key); members.push(id);
      }
      if (clans === data.clans) clans = {...clans};
      clans[clan.id] = {...clan,questSeasonMedals:[...(clan.questSeasonMedals || []),medal]};
      recipients.push({clanId:clan.id,...medal,members,reward:{...prize.reward}});
    }
    if (profiles !== data.profiles) deltas.remember(profiles,data.profiles,changed,true);
    state.settledAt = at;
    archives = {...archives,[state.id]:archives[state.id] || {...state,recipients}};
    next = {...data,profiles,clans};
  }
  if (season.mode === "quests" && state?.id !== season.id) {
    state = fresh(season);
    for (const [clanId,board] of boards) if (board) { add(state,clanId,board.day,board.quests); rememberContributors(state,clanId,board); }
  }
  return {...next,clanQuests:{...control,...(state?{questSeason:state}:{}),questSeasonHistory:archives}};
}
function validate(data) {
  const c = data.clanQuests;
  if (c?.calendarVersion === undefined) return;
  if (c.calendarVersion !== 1 || !Number.isSafeInteger(c.calendarActivatedAt)) throw Error("Invalid clan calendar version");
  calendar.validateSchedule(c.calendarSchedule || []);
  const validMedal = m => m && typeof m.seasonId === "string" && Number.isSafeInteger(m.number) &&
    Number.isSafeInteger(m.place) && m.place>=1 && m.place<=30 &&
    calendar.questPrize(m.place)?.id===m.tier && Number.isSafeInteger(m.completed) && m.completed>0 && Number.isSafeInteger(m.awardedAt) &&
    calendar.season(m.awardedAt-1, c.calendarSchedule).id===m.seasonId && calendar.season(m.awardedAt-1, c.calendarSchedule).end===m.awardedAt && calendar.season(m.awardedAt-1, c.calendarSchedule).number===m.number;
  for (const [id, archive] of Object.entries(c.questSeasonHistory || {}))
    if (!archive || archive.id !== id || !Number.isSafeInteger(archive.settledAt) || !Array.isArray(archive.recipients))
      throw Error("Invalid clan season archive");
  for (const state of [c.questSeason,...Object.values(c.questSeasonHistory||{})].filter(Boolean)) {
    const s = calendar.season(state.start, c.calendarSchedule);
    if (s.mode!=="quests" || s.id!==state.id || s.end!==state.end || s.number!==state.number || !state.scores || !state.days ||
        (state.settledAt!==undefined && (!Number.isSafeInteger(state.settledAt)||state.settledAt<state.end))) throw Error("Invalid clan quest season");
    if (state.contributorVersion !== undefined && state.contributorVersion !== 1) throw Error("Invalid clan season contribution version");
    if (state.contributorVersion === 1 && (!state.contributors || Array.isArray(state.contributors) || typeof state.contributors !== "object")) throw Error("Invalid clan season contributors");
    if (state.contributorVersion === undefined && state.contributors !== undefined) throw Error("Invalid unversioned clan season contributors");
    for (const [clanId,ids] of Object.entries(state.contributors || {})) if (!/^[a-zA-Z0-9_-]{1,80}$/.test(clanId) || Object.hasOwn(Object.prototype,clanId) || !Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id=>typeof id!=="string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || Object.hasOwn(Object.prototype,id))) throw Error("Invalid clan season contributors");
    for (const score of Object.values(state.scores)) if (!Number.isSafeInteger(score.completed) || score.completed<0 ||
      !Number.isSafeInteger(score.reachedAt) || score.reachedAt<state.start || score.reachedAt>=state.end) throw Error("Invalid clan season score");
    for (const ids of Object.values(state.days)) if (!Array.isArray(ids) || ids.length>5 || new Set(ids).size!==ids.length || ids.some(id=>typeof id!=="string")) throw Error("Invalid clan season counter");
    if (state.recipients?.some(r=>!validMedal(r)||!Array.isArray(r.members)||new Set(r.members).size!==r.members.length ||
      JSON.stringify(r.reward)!==JSON.stringify(calendar.questPrize(r.place).reward) &&
      JSON.stringify(r.reward)!==JSON.stringify(Object.fromEntries(Object.entries(calendar.questPrize(r.place).reward).filter(([key])=>key!=='greatness'))))) throw Error("Invalid clan season rewards");
  }
  const validMedals = medals => medals === undefined || (Array.isArray(medals) &&
    medals.every(validMedal) && new Set(medals.map(m=>m.seasonId)).size===medals.length);
  for (const clan of Object.values(data.clans)) if (!validMedals(clan.questSeasonMedals)) throw Error("Invalid clan quest medals");
  for (const profile of Object.values(data.profiles)) if (!validMedals(profile.clanQuestMedals)) throw Error("Invalid player clan quest medals");
}
module.exports = {capture,current,rows,validate,add};
