"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const ranking = require("../../src/server/rankings/event-leaderboards");
const DAY = 86400000, AT = Date.UTC(2026, 10, 13, 12), DAY_NO = ranking.dayAt(AT);
function fixture(pack) {
  const run = { id: "run", startsAt: AT, endsAt: AT + 3 * DAY, manifest: { contentPack: pack } };
  const manager = { data: { runs: [run] } };
  const data = { profiles: {}, eventDailyRankingStartedAt: AT, luckyRankingStartedAt: AT, luckyDailyRankingStartedAt: AT };
  const participant = day => pack === "black-friday-v1" ? { blackFriday: { runs: { run: { days: { [day]: { earned: 5 } } } } } }
    : pack === "lucky-week-v1" ? { eventAchievements: { run: { dailySpins: { [day]: 5 } } } }
    : { easter: { runs: { run: { dailyFound: { [day]: 5 } } } } };
  return { data, manager, run, participant };
}
for (const pack of ["black-friday-v1", "lucky-week-v1", "easter-hunt-v1"]) {
  test(pack + ": active/settled days do not inspect the population", () => {
    const { data, manager } = fixture(pack), midnight = ranking.dayEnd(DAY_NO);
    Object.defineProperty(data, "profiles", { get() { throw Error("Unexpected population scan"); } });
    assert.equal(ranking.due(data, manager, AT), false);
    assert.equal(ranking.due(data, manager, midnight - 1), false);
    assert.strictEqual(ranking.settle(data, manager, midnight - 1), data);
    data.eventDailyRankingResults = { [ranking.resultKey("run", DAY_NO)]: { settledAt: midnight } };
    assert.equal(ranking.due(data, manager, midnight), false);
    assert.strictEqual(ranking.settle(data, manager, midnight + 1), data);
    assert.equal(ranking.due(data, manager, AT - DAY), false);
  });
  test(pack + ": midnight, late history, missing receipt and stop/reschedule remain authoritative", () => {
    const { data, manager, run, participant } = fixture(pack), midnight = ranking.dayEnd(DAY_NO);
    assert.equal(ranking.due(data, manager, midnight), false);
    data.profiles.first = participant(DAY_NO);
    assert.equal(ranking.due(data, manager, midnight - 1), false);
    assert.equal(ranking.due(data, manager, midnight), true);
    assert.equal(ranking.due(data, manager, midnight), true); // failed publication must stay due
    data.profiles.first.testBot = true;
    assert.equal(ranking.due(data, manager, midnight), false);
    delete data.profiles.first.testBot;
    data.eventDailyRankingResults = { [ranking.resultKey("run", DAY_NO)]: {} };
    assert.equal(ranking.due(data, manager, midnight), false);
    data.profiles.second = participant(DAY_NO + 1);
    run.stoppedAt = midnight; // the next day is outside this run
    assert.equal(ranking.due(data, manager, midnight + DAY), false);
    delete run.stoppedAt;
    assert.equal(ranking.due(data, manager, midnight + DAY), true);
    data.eventDailyRankingStartedAt = midnight + DAY; // installing after closure never pays old days
    assert.equal(ranking.due(data, manager, midnight + DAY), false);
    delete data.eventDailyRankingStartedAt;
    assert.equal(ranking.due(data, manager, midnight + DAY), true); // migration is still due
  });
}
