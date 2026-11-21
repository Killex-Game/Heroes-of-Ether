"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {seedTestClans,TestBots}=require('../../src/server/testing/arena-test-bots');
const {prepareChampionshipOpponents,BATCH}=require('../../src/server/testing/championship-opponents');
const competition=require('../../src/server/clans/clan-competition-service');
const {levelForXp}=require('../../src/server/progression/experience-progression');
const AT=Date.parse('2026-11-07T12:00:00Z');
test('Six playable league groups, varied levels, unchanged existing data and idempotent setup',()=>{
  const store=new ProfileStore({now:()=>AT});
  seedTestClans(store,AT);
  const before=structuredClone(store.data), result=prepareChampionshipOpponents(store.data,AT);
  assert.deepEqual(result.summary.leagueCounts,[16,16,16,16,16,16]);
  assert.equal(result.summary.addedClans,80); assert.equal(result.summary.addedBots,320);
  for(let league=0;league<6;league++) assert.equal(result.data.competition.week.groups.filter(g=>g.league===league).reduce((n,g)=>n+g.clans.length,0),16);
  assert.deepEqual(store.data,before);
  for(const table of ['profiles','clans'])for(const [key,value]of Object.entries(before[table]))assert.deepEqual(result.data[table][key],value);
  const added=new Set(Object.values(result.data.clans).filter(c=>c.testSeedKey?.startsWith(BATCH)).flatMap(c=>c.members));
  const bots=Object.values(result.data.profiles).filter(p=>added.has(p.id));
  assert.equal(Math.min(...bots.map(p=>p.level)),12); assert.equal(Math.max(...bots.map(p=>p.level)),500);
  assert.ok(new Set(bots.map(p=>p.level)).size>100);
  // Reload through the normal validator: stored level must agree with total XP.
  const staged=new ProfileStore({now:()=>AT}); staged.save(result.data,AT);
  for(const bot of bots)assert.equal(staged.byId(bot.id).level,bot.level);
  competition.validate(staged.data);
  const repeated=prepareChampionshipOpponents(staged.data,AT+1000);
  assert.equal(repeated.summary.addedClans,0); assert.deepEqual(repeated.data,staged.data);
});
