"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFixture, simulateSeason } = require("../../scripts/benchmarks/database-room-fixture.cjs");
test("isolated 1280-player fixture starts all 128 clans in Bronze and reaches a legal Champion group", () => {
  const fixture = createFixture(Date.parse("2026-11-10T09:00:00Z"));
  const before = JSON.stringify(fixture);
  assert.equal(Object.keys(fixture.data.profiles).length, 1280);
  assert.equal(new Set(fixture.tokens).size, 1280);
  const players = Object.values(fixture.data.profiles);
  assert.equal(Math.min(...players.map(p => p.level)), 1);
  assert.equal(Math.max(...players.map(p => p.level)), 500);
  for (const c of Object.values(fixture.data.clans)) {
    assert.equal(c.competition.league, 0);
    assert.equal(c.members.length, 10);
    assert.equal(new Set(c.members).size, 10);
    for (const id of c.members) assert.equal(players.find(p => p.id === id).clanId, c.id);
  }
  const result = simulateSeason(fixture);
  assert.equal(result.firstChampionGroupWeek, 19);
  assert.ok(result.history.some(h => h.championsAwarded > 0));
  for (const h of result.history) {
    assert.equal(h.leagues.reduce((n, l) => n + l.clans, 0), 128);
    assert.ok(h.championGroups.every(n => n >= 10 && n <= 16 && n % 2 === 0));
  }
  assert.equal(JSON.stringify(fixture), before);
});
