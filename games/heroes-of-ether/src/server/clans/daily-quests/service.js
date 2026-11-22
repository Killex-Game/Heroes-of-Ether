"use strict";
const { copyProfile } = require("../../profiles/owned-profile-draft");

const engine = require('./engine'), catalog = require('./catalog.json'), seasons = require('./seasons');
const descriptions = require('../../../../public/shared/clan-quest-descriptions');
const { clanProgress } = require('../clan-level-progress');
const chests = require('../clan-chest-rewards');
const history = require('../../profiles/transaction-history');
const tableDeltas = require('../../profiles/immutable-table-delta');
const { copyRecord } = require('../../profiles/copy-record');
const actions = require('./actions');
const { awardTitles } = require('../../progression/title-chest-rewards');
engine.validateCatalog(catalog);
const calendar = require('../../../../public/shared/clan-season-calendar');
const seasonal = require('./season-ranking');
const active = (data, at) => {
  if (data.clanQuests?.calendarVersion !== 1) return seasons.active(data.clanQuests?.seasons || [], at);
  const s = calendar.season(at);
  return s.mode === 'battle' ? {...s,startsAt:s.start,endsAt:s.end} : null;
};
const eligible = (clan, start) => Object.fromEntries(clan.members
  .filter(id => (clan.competition?.joined?.[id] ?? clan.createdAt ?? 0) < start)
  .map(id => [id, clan.competition?.joined?.[id] || 0]));
function due(data, at) { return !!data.clanQuests && (data.clanQuests.nextAt <= at || data.clanQuests.catalogVersion !== catalog.version || data.clanQuests.recruitRulesVersion !== 1 || data.clanQuests.windowVersion !== engine.WINDOW_VERSION); }
function blocked(data, board, at) {
  return !!active(data, at);
}
function availableDuration(data,start,end) {
  if (data.clanQuests?.calendarVersion === 1) {
    let total=0;
    for (let from=start;from<end;) {
      const day=calendar.daily(from), until=Math.min(end,day.end+11*3600000);
      if(calendar.season(from).mode==='quests')total+=Math.max(0,Math.min(end,day.end)-Math.max(from,day.start));
      from=until;
    }
    return total;
  }
  return Math.max(0,end-start-(data.clanQuests?.seasons||[]).filter(s=>!s.cancelled)
    .reduce((sum,s)=>sum+Math.max(0,Math.min(end,s.endsAt)-Math.max(start,s.startsAt)),0));
}
function initialize(data, at) {
  if (data.clanQuests?.calendarVersion === 1) return data;
  if (data.clanQuests?.calendarVersion !== undefined) throw Error('Unknown clan calendar version');
  const control=data.clanQuests || {version:1,catalogVersion:catalog.version,revision:0,seasons:[],enabledAt:at};
  return {...data,clanQuests:{...control,calendarVersion:1,calendarActivatedAt:at,nextAt:0}};
}
function capture(next, previous, at, {canSettle=true} = {}) {
  if (!next.clanQuests) return next;
  const day = engine.period(at), boundary = due(next, at), repairRecruits = next.clanQuests.recruitRulesVersion !== 1;
  const sourceBoards = boundary ? Object.entries(next.clans).map(([id,c])=>[id,c.dailyQuests?.board]) : [];
  const upgradeWindow = next.clanQuests.windowVersion !== engine.WINDOW_VERSION;
  let clans = next.clans, profiles = next.profiles, index, ledger = next.clanQuestRewards;
  const changedProfiles = new Set();let deferredEnd=Infinity;
  const writable = id => {
    index ||= new Map(Object.entries(profiles).map(([k,p])=>[p.id,k]));
    const key = index.get(id); if (!key) return null;
    if (profiles === next.profiles) profiles = copyRecord(profiles);
    if (!changedProfiles.has(key)) { profiles[key] = copyProfile(profiles[key]); changedProfiles.add(key); }
    return profiles[key];
  };
  for (const [id,initialClan] of Object.entries(clans)) {
    let clan = initialClan;
    let state = clan.dailyQuests, board = state?.board;
    const old = previous.clans[id];
    const upgrade = board && board.catalogVersion < catalog.version && !board.settledAt && board.day === day.id && at < board.end;
    if (!boundary && !upgrade && clan.members === old?.members && clan.competition?.joined === old?.competition?.joined) continue;
    // One compatibility pass for members accepted under the old battle-only
    // rule. Existing role assignments remain stored, but newcomer permissions
    // and today's quest eligibility stay closed until the next 06:00 MSK.
    if ((repairRecruits || upgradeWindow) && !active(next,at)) {
      let recruits=clan.competition.recruits;
      for(const pid of clan.members) if(pid!==clan.ownerId && (
          (repairRecruits && clan.competition.joined[pid]>=day.start && (recruits[pid]||0)<day.nextStart) ||
          (upgradeWindow && recruits[pid]>at && recruits[pid]===day.nextStart-2*3600000))) {
        if(recruits===clan.competition.recruits)recruits={...recruits};
        recruits[pid]=day.nextStart;
      }
      if(recruits!==clan.competition.recruits){
        if(clans===next.clans)clans={...clans};
        clan=clans[id]={...clan,competition:{...clan.competition,recruits}};
      }
    }
    const assign = value => {
      if (clans === next.clans) clans = {...clans};
      clans[id] = {...clan,dailyQuests:value}; state = value; board = value.board;
    };
    // Extend the current legacy day only. Keep its original opening, chosen
    // quests, eligibility and contributions, including progress earned before 06:00.
    if (board && !board.settledAt && board.day === day.id &&
        board.start === day.start-2*3600000 && board.end === day.end-3600000)
      assign({...state,board:{...board,end:day.end}});
    if(upgrade) {
      // Preserve today's selection and earned contributions. Only approved rule
      // changes apply; completed historical days and financial receipts stay intact.
      const quests=board.quests.map(q=>{
        const revised=catalog.items.find(row=>row.id===q.id);
        if(!revised)return q;
        const progress=Math.min(q.progress,revised.target);
        return {...q,...revised,progress,completedAt:q.completedAt ??
          (progress===revised.target?Math.max(board.start,at):null)};
      });
      assign({...state,board:{...board,catalogVersion:catalog.version,quests}});
    }
    // Membership is frozen at opening. Leaving and rejoining cannot restore it.
    if (board && !board.settledAt) {
      const keep = Object.fromEntries(Object.entries(board.eligible).filter(([pid,joined]) =>
        clan.members.includes(pid) && (clan.competition?.joined?.[pid] || 0) === joined));
      if (Object.keys(keep).length !== Object.keys(board.eligible).length)
        assign({...state,board:{...board,eligible:keep}});
      if (board.end <= at && !canSettle) { deferredEnd=Math.min(deferredEnd,board.end);continue; }
      if (board.end <= at) {
        const receipt = board.day + ':' + id;
        const grants = ledger?.[receipt] ? [] : engine.rewardPlan(board, at, clan.members), awarded = new Set();
        for (const grant of grants) {
          const p = writable(grant.playerId);
          if (!p || p.clanId !== id) continue;
          const balance = history.snapshot(p), reward = grant.reward;
          if (reward.kind === 'clanChest') {
            for (let i=0;i<reward.amount;i++) {
              const item = chests.grant(p,reward.tier,board.end,{clanId:id});
              item.questReceipt = grant.id + ':' + i;
            }
          } else {
            const amount = p.wallet[reward.kind] + reward.amount;
            if (!Number.isSafeInteger(amount)) throw Error('Clan quest reward overflow');
            p.wallet[reward.kind] = amount;
          }
          const greatness = p.greatness + grant.greatness;
          if (!Number.isSafeInteger(greatness)) throw Error('Clan quest greatness overflow');
          p.greatness = greatness;
          history.record(p,balance,board.end,{kind:'reward',label:'Клановое задание: '+board.quests.find(q=>q.id===grant.questId).name,detail:grant.id});
          awarded.add(grant.playerId);
        }
        if(awarded.size) {
          for (const pid of awarded) awardTitles(writable(pid),board.end);
          if(ledger===next.clanQuestRewards)ledger={...(ledger||{})};
          ledger[receipt]={clanId:id,day:board.day,earnedAt:board.end,issuedAt:at,
            members:[...awarded],quests:board.quests.filter(q=>q.completedAt!==null).map(q=>({id:q.id,name:q.name,reward:structuredClone(q.reward),greatness:engine.questGreatness(q.metric),completedAt:q.completedAt}))};
        }
        assign({...state,board:{...board,settledAt:at,...(ledger?.[receipt]?{rewardReceipt:receipt}:{})}});
      }
    }
    if (!board || board.day < day.id) {
      const roster = eligible(clan,day.start);
      const fresh = engine.createBoard(id,catalog,at,roster,availableDuration(next,Math.max(at,day.start),day.end));
      // Daily progress is replaced; financial receipts live separately so an
      // arena contribution never rewrites years of archived payouts in a clan.
      assign({board:fresh});
    } else if (!board.settledAt && !board.quests.length && day.active && !active(next,at) && Object.keys(board.eligible).length) {
      assign({...state,board:engine.createBoard(id,catalog,at,board.eligible,availableDuration(next,at,day.end))});
    }
  }
  for (const key of changedProfiles) profiles[key].revision++;
  if (profiles !== next.profiles) tableDeltas.remember(profiles,next.profiles,[...changedProfiles],true);
  let control = next.clanQuests;
  if (boundary) {
    const edges = control.seasons.filter(s=>!s.cancelled).flatMap(s=>[s.startsAt,s.endsAt]).filter(n=>n>at);
    control = {...control,catalogVersion:catalog.version,recruitRulesVersion:1,windowVersion:engine.WINDOW_VERSION,nextAt:Math.min(day.active?day.end:day.nextStart,...(control.calendarVersion===1?[calendar.season(at).end]:edges),deferredEnd)};
  }
  const result=clans===next.clans && profiles===next.profiles && control===next.clanQuests && ledger===next.clanQuestRewards ? next : {...next,clans,profiles,clanQuests:control,...(ledger?{clanQuestRewards:ledger}:{})};
  return boundary ? seasonal.capture(result,at,sourceBoards,{canSettle}) : result;
}
// Called exclusively for server progress events inside the durable arena draft.
// No timers or full-player searches; work is bounded by one clan's five rows.
function progress(data, clanDrafts, p, event, at, changes, earned, before) {
  if (!data.clanQuests) return;
  const clan = clanDrafts.get(p.clanId) || data.clans[p.clanId], board = clan?.dailyQuests?.board;
  const session = p.clanQuestSession;
  if (event.type === 'lifeStarted') {
    if (session?.id !== event.lifeId) p.clanQuestSession = {id:event.lifeId,sampledAt:at,food:0,rank:null,sequence:0};
    return;
  }
  let deltas = actions.deltas(session,event,p.id);
  const food=event.clanFood ?? event.food;
  if(session && event.lifeId===session.id && ['questSample','lifeEnded','clanFoodSample'].includes(event.type) && Number.isSafeInteger(food) && food>=session.food) {
    deltas.food=food-session.food;session.food=food;
  }
  let timeDeltas;
  if (session && ['questSample','lifeEnded'].includes(event.type) && session.id === event.lifeId && at > session.sampledAt) {
    // The caller's timestamp is the sampled arena time, not delayed flush time.
    const elapsed = board ? availableDuration(data,Math.max(session.sampledAt,board.start),Math.min(at,board.end)) : 0;
    timeDeltas = {};
    timeDeltas.arenaMs = elapsed;
    if (session.rank >= 1 && session.rank <= 10) timeDeltas.top10Ms = elapsed;
    if (session.rank === 1) timeDeltas.top1Ms = elapsed;
    Object.assign(deltas, timeDeltas);
    session.sampledAt = at;
    if (event.type === 'questSample') session.rank = event.rank;
  }
  if (board && !blocked(data,board,at) && (data.clanQuests.calendarVersion!==1 || engine.period(at).active) && at >= board.start && at < board.end && Object.hasOwn(board.eligible,p.id)) {
    // Existing persistent victim cooldowns, including clanmates, remain authoritative.
    deltas.kills = Math.max(0,p.progress.absorptionKills-before.kills);
    deltas.absorbedMass = Math.max(0,p.progress.absorbedMass-before.mass);
    deltas.xp = Math.max(0,earned);
    const result=engine.record(board,{playerId:p.id,clanId:clan.id,at,sequence:(board.cursors[p.id]||0)+1,deltas});
    if(result.accepted) clanDrafts.set(clan.id,{...clan,dailyQuests:{...clan.dailyQuests,board:result.board}});
  } else if (board && at >= board.end && timeDeltas?.arenaMs > 0 && Object.hasOwn(board.eligible,p.id)) {
    // A sample may arrive on the first tick after 21:00. Credit only the
    // measured interval clipped to the deadline, never that tick's actions,
    // food or XP. The boundary barrier keeps this board open until publication.
    const result=engine.record(board,{playerId:p.id,clanId:clan.id,at:board.end-1,
      sequence:(board.cursors[p.id]||0)+1,deltas:timeDeltas});
    if(result.accepted) clanDrafts.set(clan.id,{...clan,dailyQuests:{...clan.dailyQuests,board:result.board}});
  }
  if (event.type==='lifeEnded' && event.lifeId===session?.id) p.clanQuestSession=null;
}
function gift(data,p,at) {
  const clan=data.clans[p.clanId], board=clan?.dailyQuests?.board;
  if(!data.clanQuests || !board || blocked(data,board,at)) return;
  const result=engine.record(board,{playerId:p.id,clanId:clan.id,at,sequence:(board.cursors[p.id]||0)+1,deltas:{gifts:1}});
  if(result.accepted) data.clans={...data.clans,[clan.id]:{...clan,dailyQuests:{...clan.dailyQuests,board:result.board}}};
}
function view(data,clan,at,part) {
  if(!data.clanQuests) return {};
  const season=active(data,at), day=engine.period(at), board=clan.dailyQuests?.board;
  const result={mode:season?'battle':'quests',announcedSeason:season,calendarSeason:calendar.season(at),questSeasonMedals:structuredClone(clan.questSeasonMedals||[])};
  if(!part || part==='battle' || part==='preview') result.dailyQuests={
    active:!!(board?.day===day.id && day.active && !season && board.quests.length),
    resultsVisible:!!(board?.day===day.id && !season && board.quests.length && at>=board.end && at<board.end+engine.RESULTS_MS),
    settled:!!board?.settledAt,resultsUntil:(board?.end??day.end)+engine.RESULTS_MS,
    day:day.id,start:board?.day===day.id?board.start:day.start,end:board?.day===day.id?board.end:day.end,nextStart:day.nextStart,serverNow:at,
    quests:board?.day===day.id ? board.quests.map(q=>({...structuredClone(q),greatness:engine.questGreatness(q.metric),description:descriptions[q.id]||q.description})) : []};
  if(!part || part==='league') result.dailyRanking=data.clanQuests.calendarVersion===1 ? seasonal.rows(data,seasonal.current(data,at)) : engine.ranking(Object.values(data.clans).map(c=>({...c,level:clanProgress(c.xp).level})),
    Object.fromEntries(Object.entries(data.clans).map(([id,c])=>[id,c.dailyQuests?.board])),at);
  return result;
}
function validate(data) {
  if(data.clanQuests===undefined) return;
  const state=data.clanQuests;
  if(state.version!==1 || !Number.isSafeInteger(state.revision) || !Number.isSafeInteger(state.nextAt) || !Array.isArray(state.seasons)) throw Error('Invalid clan quest schedule');
  if(state.recruitRulesVersion!==undefined && state.recruitRulesVersion!==1)throw Error('Invalid clan newcomer rules');
  if(state.windowVersion!==undefined && ![1,2,engine.WINDOW_VERSION].includes(state.windowVersion))throw Error('Invalid clan quest window');
  seasonal.validate(data);
  let history=[];
  for(const s of state.seasons) {history=seasons.announce(history,s,{role:'owner'}); history.at(-1).cancelled=!!s.cancelled;}
  for(const c of Object.values(data.clans)) for(const b of [c.dailyQuests?.board].filter(Boolean)) {
    if(b.clanId!==c.id || !b.eligible || b.quests.length>5 || b.quests.some(q=>!Number.isSafeInteger(q.progress)||q.progress<0||q.progress>q.target || (q.completedAt!==null && (q.progress!==q.target || q.completedAt<b.start || q.completedAt>=b.end)))) throw Error('Invalid clan quest board');
    engine.validateCatalog({version:b.catalogVersion,items:[...catalog.items.filter(q=>!b.quests.some(r=>r.id===q.id)),...b.quests]});
  }
  for(const [key,r] of Object.entries(data.clanQuestRewards||{})) {
    if(r.quests?.some(q=>q.greatness!==undefined && (!Number.isSafeInteger(q.greatness)||q.greatness<0)))throw Error('Invalid clan quest greatness');
    if(key!==r.day+':'+r.clanId || !Number.isSafeInteger(r.issuedAt) || r.issuedAt<r.earnedAt || !Array.isArray(r.members) || new Set(r.members).size!==r.members.length || r.members.some(id=>typeof id!=='string') || !Array.isArray(r.quests) || r.quests.length>5)throw Error('Invalid clan quest reward ledger');
  }
}
module.exports={initialize,capture,progress,gift,due,active,view,validate,catalog,availableDuration};
