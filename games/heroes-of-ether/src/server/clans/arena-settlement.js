"use strict";
// A bounded, durable accumulator for one arena life. Never queue raw events.
const enabled = data => data.clanQuests?.arenaSettlementVersion === 1;
function add(p, kind, scope, deltas) {
  const pending = p.clanArenaPending;
  if (!pending) return;
  let entry = pending[kind];
  if (!entry || Object.keys(scope).some(k => entry[k] !== scope[k]))
    entry = pending[kind] = {...scope, deltas:{}};
  for (const [key, value] of Object.entries(deltas)) {
    if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid pending clan contribution');
    if (!value) continue;
    const sum = (entry.deltas[key] || 0) + value;
    if (!Number.isSafeInteger(sum)) throw Error('Clan contribution overflow');
    entry.deltas[key] = sum;
  }
}
const questScope = (clan, board, p) => ({clanId:clan.id, start:board.start, end:board.end,
  joinedAt:board.eligible[p.id]});
function quest(data, clan, board, p, deltas) {
  if (enabled(data)) {
    if(!p.clanArenaPending && p.progress.session)p.clanArenaPending={lifeId:p.progress.session.id};
    add(p,'quests',questScope(clan,board,p),deltas);
  }
}
function questDeltas(clan, board, p, at) {
  const entry=p.clanArenaPending?.quests;
  return entry && at>=entry.start && at<entry.end &&
    Object.entries(questScope(clan,board,p)).every(([k,v])=>entry[k]===v) ? entry.deltas : null;
}
function observe(data, p, event, at, previousKills) {
  if (!enabled(data)) return;
  if (event.type === 'lifeStarted') {
    if (p.clanArenaPending?.lifeId !== event.lifeId)
      p.clanArenaPending={lifeId:event.lifeId};
    return;
  }
  if(!p.clanArenaPending && p.clanQuestSession?.id &&
      (p.progress.session?.id===p.clanQuestSession.id || event.type==='lifeEnded'&&event.lifeId===p.clanQuestSession.id))
    p.clanArenaPending={lifeId:p.clanQuestSession.id};
  const pending=p.clanArenaPending;
  if (!pending) return;
  const day=data.competition?.day,clan=data.clans[p.clanId],gain=p.progress.kills-previousKills;
  if (gain>0 && clan && day && at>=day.start && at<day.end &&
      require('./daily-quests/service').active(data,at) &&
      clan.members.includes(p.id) && !(clan.competition.recruits[p.id]>at) && day.rosters[clan.id]?.includes(p.id))
    add(p,'battle',{clanId:clan.id,start:day.start,end:day.end,joinedAt:clan.competition.joined[p.id]||0},{kills:gain});
  if (event.type==='lifeEnded' && pending.lifeId===event.lifeId) {
    const entry=pending.battle;
    if (entry && clan && clan.id===entry.clanId && day?.start===entry.start &&
        at>=entry.start && at<entry.end && (clan.competition.joined[p.id]||0)===entry.joinedAt)
      {
        const old=p.clanArenaCredit,prior=old && ['clanId','start','end','joinedAt'].every(k=>old[k]===entry[k]) ? old.deltas.kills||0 : 0;
        const total=prior+(entry.deltas.kills||0);if(!Number.isSafeInteger(total))throw Error('Clan contribution overflow');
        p.clanArenaCredit={lifeId:event.lifeId,at,...entry,deltas:{kills:total}};
      }
  }
}
function battleGain(data, p, before, at) {
  if (!enabled(data)) return p.progress.kills-(before?.progress.kills||0);
  const credit=p.clanArenaCredit;
  return credit && credit.lifeId!==before?.clanArenaCredit?.lifeId && credit.at===at &&
    credit.start===data.competition?.day?.start && credit.clanId===p.clanId &&
    credit.joinedAt===(data.clans[p.clanId]?.competition.joined[p.id]||0) ?
      Math.max(0,(credit.deltas.kills||0)-(['clanId','start','end','joinedAt'].every(k=>credit[k]===before?.clanArenaCredit?.[k]) ? before.clanArenaCredit.deltas.kills||0 : 0)) : 0;
}
function finish(p,event){if(event.type==='lifeEnded'&&event.lifeId===p.clanArenaPending?.lifeId)p.clanArenaPending=null;}
function validate(p) {
  const pending=p.clanArenaPending,credit=p.clanArenaCredit;
  const id=x=>typeof x==='string'&&x.length>0&&x.length<=128;
  function entry(e,kind){
    if(!id(e.clanId)||![e.start,e.end,e.joinedAt].every(n=>Number.isSafeInteger(n)&&n>=0)||e.end<=e.start ||
      !e.deltas || Array.isArray(e.deltas) || typeof e.deltas!=='object')throw Error('Invalid pending clan scope');
    const metrics=require('./daily-quests/engine').METRICS;
    for(const [key,value] of Object.entries(e.deltas))if(!metrics.has(key)||kind==='battle'&&key!=='kills'||
      !Number.isSafeInteger(value)||value<0)throw Error('Invalid pending clan metric');
  }
  if(pending){if(!id(pending.lifeId))throw Error('Invalid pending clan life');
    if(pending.quests)entry(pending.quests,'quests');if(pending.battle)entry(pending.battle,'battle');}
  if(credit){if(!id(credit.lifeId)||!Number.isSafeInteger(credit.at))throw Error('Invalid settled clan life');entry(credit,'battle');}
}
module.exports={enabled,quest,questDeltas,observe,battleGain,finish,validate};
