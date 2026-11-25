"use strict";
const calendar = require('../../../../public/shared/clan-season-calendar');
const engine = require('./engine');
const service = require('./service');
const ranking = require('./season-ranking');

// Build one immutable draft. ProfileStore.save commits settlement, rewards,
// the next calendar segment and the administration receipt in the same WAL entry.
function prepare(data, at, mode) {
  const current = calendar.season(at, data.clanQuests.calendarSchedule);
  if (!['quests', 'battle'].includes(mode) || mode === current.mode || at <= current.start)
    throw Error('Выбери другой тип сезона.');
  const base = calendar.season(at), entries = new Map((data.clanQuests.calendarSchedule || []).map(s => [s.start, s]));
  const row = entries.get(base.start) || {start:base.start,mode:base.mode};
  entries.set(base.start, {...row,switches:[...(row.switches || []),{at,mode}]});
  const schedule = [...entries.values()].sort((a,b) => a.start-b.start);
  calendar.validateSchedule(schedule);
  let control = {...data.clanQuests,calendarSchedule:schedule,nextAt:0};
  if (current.mode === 'quests') {
    const state = ranking.current(data, at);
    if (Object.values(state?.scores || {}).some(s => s.reachedAt >= at))
      throw Error('Подожди окончания текущего такта и повтори смену сезона.');
    if (state && !state.settledAt) control.questSeason = {...state,end:at};
  }
  const clans = {...data.clans};
  for (const [id,c] of Object.entries(clans)) {
    const board = c.dailyQuests?.board;
    if (current.mode === 'quests' && board && !board.settledAt && board.start < at && board.end > at)
      clans[id] = {...c,dailyQuests:{...c.dailyQuests,board:{...board,end:at}}};
    if (mode === 'quests' && engine.period(at).active) {
      const eligible = Object.fromEntries(c.members.filter(pid => (c.competition?.joined?.[pid] ?? c.createdAt ?? 0) < at)
        .map(pid => [pid,c.competition?.joined?.[pid] || 0]));
      const fresh = engine.createBoard(id, service.catalog, at, eligible, engine.period(at).end-at);
      clans[id] = {...c,dailyQuests:{board:{...fresh,start:at,cycle:at}}};
    }
  }
  let next = {...data,clans,clanQuests:control};
  if (current.mode === 'battle' && data.competition?.season.id === current.id && !data.competition.season.settled) {
    const c = structuredClone(data.competition);
    c.season.end = at;
    if (c.day) c.day.end = Math.min(c.day.end, at);
    if (c.week) c.week.end = Math.min(c.week.end, at);
    next.competition = c;
  }
  // Daily quest prizes must settle before the new mode hides the old board.
  if (current.mode === 'quests') next = service.capture(next, data, at, {canSettle:true});
  return next;
}
module.exports = {prepare};
