"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {SettlementCache} = require("../../src/server/profiles/settlement-cache");
const service = require("../../src/server/clans/clan-competition-service");
const rules = require("../../public/shared/clan-competition-rules");
const at = Date.UTC(2026, 10, 11, 12);
const clan = deadline => ({competition: {seasonPeak: {}, trophies: [], recruits: {p: deadline}}});
test("clan deadline cache honors exact expiry, rewind, table replacement and missing migrations", () => {
  const cache = new SettlementCache(), first = {a: clan(at+500), b: clan(at+1000)};
  assert.equal(cache.clanExpiryDue(first, at), false);
  assert.equal(cache.clanExpiryDue(first, at+499), false);
  assert.equal(cache.clanExpiryDue(first, at+500), true);
  assert.equal(cache.clanExpiryDue(first, at-1000), false);
  const replaced = {...first, a: clan(at+2000)};
  assert.equal(cache.clanExpiryDue(replaced, at+500), false);
  assert.equal(cache.clanExpiryDue(replaced, at+1000), true);
  assert.equal(cache.clanExpiryDue({a: {}}, at), true);
  assert.equal(cache.clanExpiryDue({a: {competition:{seasonPeak:{}}}}, at), true);
  assert.equal(cache.clanExpiryDue({}, at), false);
});
test("cached and uncached competition deadlines agree through battle/week/season boundaries", () => {
  const data = {profiles: {}, clans: {a: clan(at+500)}, competition: {
    season: rules.season(at), week: rules.week(at), day: {end: rules.dayStart(at)+rules.DAY}, lastScheduledDay: rules.dayStart(at)
  }};
  const cache = new SettlementCache();
  for(const t of [at,at+499,at+500,at-1000,data.competition.day.end,data.competition.week.end,data.competition.season.end])
    assert.equal(service.due(data,t,cache), service.due(data,t));
  const noDay = {...data, clans:{}, competition:{...data.competition, day:null,lastScheduledDay:0}};
  for(const hour of [7,8,9]) {
    const t=rules.dayStart(at)+hour*rules.HOUR;
    assert.equal(service.due(noDay,t,cache),service.due(noDay,t));
  }
});
