"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const tables = require("../../src/server/profiles/immutable-table-delta");
const clans = require("../../src/server/clans/clan-competition-service");
const daily = require("../../src/server/rankings/daily-leaderboards");
const rankings = require("../../src/server/rankings/event-leaderboards");
const social = require("../../src/server/progression/social-calendar");
const lucky = require("../../src/server/events/lucky-week");
const friday = require("../../src/server/events/black-friday");
const easter = require("../../src/server/events/easter-hunt");
const AT = Date.UTC(2026, 10, 12, 12);
function uncached(store, world, at) {
  return clans.due(world, at) || daily.due(world, at) ||
    rankings.due(world, store.events, at) || social.due(world, at) ||
    lucky.recoveryDue(world, store.events) || friday.recoveryDue(world, store.events) ||
    Object.values(world.profiles).some(p => easter.refreshDue(p, at));
}
function replace(world, key, profile) {
  const profiles = { ...world.profiles, [key]: profile };
  tables.remember(profiles, world.profiles, [key]);
  return { ...world, profiles };
}
function fixture() {
  const store = new ProfileStore({ now: () => AT, incrementalSettlement: true });
  store.open(); store.open(); store.save(store.data);
  assert.ok(store.settlementCache); // production settlement setting
  return store;
}
test("runtime due checks agree with full scans across replacements, deadlines and clock reversal", () => {
  const store = fixture(), key = Object.keys(store.data.profiles)[0];
  let world = store.data;
  const check = at => assert.equal(store.competitionDue(world, at), uncached(store, world, at));
  for (let n = 0; n < 100; n++) { check(AT + n); world = replace(world, key, { ...world.profiles[key], name: `name${n}` }); }
  const p = world.profiles[key];
  world = replace(world, key, { ...p, account: { vipUntil: AT + 500, premiumUntil: 0 },
    clanChests: { items: [], notices: [{ at: AT - 86400000 + 700 }] },
    quests: { ...p.quests, pending: [{ stored: false, receivedAt: null,
      waitingSince: AT - 86400000 + 900, waitingHours: 24, expiresAt: AT + 900 }] },
    easter: { batches: [{ expiresAt: AT + 800 }], runs: {} } });
  for (const at of [AT, AT + 499, AT + 500, AT + 699, AT + 700, AT + 799,
    AT + 800, AT + 900, AT - 1, AT + 1, daily.nextReset(AT)]) check(at);
  world = structuredClone(world); check(AT + 1); // unknown ancestry
  world = replace(world, key, p); check(AT + 900);
  assert.equal(store.competitionDue(world, AT + 900), false);
});
test("runtime due checks detect pending event recovery after cached empty worlds and removals", () => {
  const store = fixture(), key = Object.keys(store.data.profiles)[0], base = store.data;
  // The recovery checks only require a manager's presence; no scheduled run is needed here.
  store.events = { data: { runs: [] }, scheduled: () => [], active: () => [] };
  for (const marker of ["pendingEventLevel", "pendingFridayLevel"]) {
    assert.equal(store.competitionDue(base, AT), false);
    const p = base.profiles[key], marked = replace(base, key, { ...p,
      progress: { ...p.progress, lastLife: { [marker]: { at: AT, runId: "pending" } } } });
    assert.equal(store.competitionDue(marked, AT), true);
    assert.equal(store.competitionDue(marked, AT + 1), true);
    const removed = { ...marked, profiles: { ...marked.profiles } };
    delete removed.profiles[key]; tables.remember(removed.profiles, marked.profiles, [key]);
    assert.equal(store.competitionDue(removed, AT + 2), false);
    assert.equal(store.competitionDue(base, AT + 3), false);
  }
});
test("a failed expiry settlement stays due, then retries exactly once without changing the old snapshot", () => {
  const store = fixture(), key = Object.keys(store.data.profiles)[0];
  const next = structuredClone(store.data);
  next.profiles[key].clanChests = { items: [], notices: [{ id: "notice", kind: "reward", text: "Награда", at: AT - 86400000 + 100 }] };
  store.save(next, AT);
  assert.equal(store.refreshCompetition(AT + 99), false);
  const previous = store.data, saved = structuredClone(previous);
  store.filePath = __filename + "/invalid/profiles.json";
  assert.throws(() => store.refreshCompetition(AT + 100));
  assert.strictEqual(store.data, previous); assert.deepEqual(store.data, saved);
  assert.equal(store.competitionDue(store.data, AT + 100), true);
  store.filePath = null;
  assert.equal(store.refreshCompetition(AT + 100), true);
  assert.equal(store.byId(saved.profiles[key].id).clanChests.notices.length, 0);
  assert.equal(store.refreshCompetition(AT + 101), false);
});
