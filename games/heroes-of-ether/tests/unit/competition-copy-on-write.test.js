"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { seedTestClans } = require("../../src/server/testing/arena-test-bots"),
  competition = require("../../src/server/clans/clan-competition-service"),
  chests = require("../../src/server/clans/clan-chest-rewards");
const AT = Date.UTC(2026, 9, 24, 12);
function fixture() {
  const store = new ProfileStore({ now: () => AT });
  store.open();
  seedTestClans(store);
  for (const clan of Object.values(store.data.clans)) clan.competition.recruits = {};
  return store;
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
test("competition leaves unaffected profiles shared and accepts frozen committed state", () => {
  const store = fixture(),
    previous = freeze(store.data);
  const result = competition.capture(previous, previous, AT + 50);
  assert.deepEqual(result, previous);
  for (const key of Object.keys(previous.profiles))
    assert.equal(result.profiles[key], previous.profiles[key]);
});
test("competition clones the scorer before awarding a kill, leaving input drafts untouched", () => {
  const store = fixture(),
    previous = freeze(store.data);
  const clanId = previous.competition.day.pairs[0].a;
  const key = Object.keys(previous.profiles).find(
    (key) => previous.profiles[key].clanId === clanId,
  );
  const player = structuredClone(previous.profiles[key]);
  player.progress.kills++;
  const next = freeze({ ...previous, profiles: { ...previous.profiles, [key]: player } });
  const result = competition.capture(next, previous, AT + 50);
  assert.equal(player.activity.values.league_fighter, 0);
  assert.equal(result.profiles[key].activity.values.league_fighter, 1);
  assert.equal(result.competition.day.scores[clanId].kills, 1);
  assert.notEqual(result.profiles[key], player);
  for (const other of Object.keys(previous.profiles).filter((id) => id !== key))
    assert.equal(result.profiles[other], previous.profiles[other]);
});
test("new league grants and chest expiry are isolated even if a subsequent disk write fails", () => {
  const store = fixture();
  const key = Object.keys(store.data.profiles).find((key) => store.data.profiles[key].clanId);
  const original = store.data.profiles[key],
    clanId = original.clanId;
  const waiting = chests.grant(original, "low", AT - 2 * 86400000);
  // Only an outside chest expires; stored chests are now safe indefinitely.
  waiting.stored = false;
  waiting.expiresAt = AT;
  store.data.clans[clanId].competition.league = 1;
  const previous = freeze(store.data),
    before = JSON.stringify(previous);
  store.filePath = __filename + "/invalid/profiles.json";
  assert.throws(() => store.save(previous, AT));
  assert.equal(JSON.stringify(store.data), before);
  store.filePath = null;
  store.save(previous, AT);
  const after = store.data.profiles[key];
  assert.ok(after.activity.leagueVisits.includes("silver"));
  assert.equal(after.clanChests.items.length, 0);
  assert.equal(after.clanChests.notices.filter((n) => n.kind === "expired").length, 1);
  const saved = JSON.stringify(store.data);
  store.save(store.data, AT);
  assert.equal(JSON.stringify(store.data), saved);
});

test("XP and cosmetic changes preserve validated competition without copying every clan", () => {
  const store = fixture();
  store.save(store.data, AT);
  const previous = freeze(store.data), id = Object.keys(previous.clans)[0];
  const clan = { ...previous.clans[id], xp: previous.clans[id].xp + 100, name: "Новое имя" };
  const next = freeze({ ...previous, clans: { ...previous.clans, [id]: clan } });
  const fast = competition.capture(next, previous, AT + 50);
  // Cloning the competition removes its validated identity and forces the
  // original full calculation. The persisted values must still be identical.
  const full = competition.capture({ ...next, competition: structuredClone(next.competition) }, previous, AT + 50);
  assert.deepEqual(fast, full);
  assert.equal(fast.competition, previous.competition);
  assert.equal(fast.clans[id], clan);
  const prepared = store.prepareSnapshot(next, AT + 50, undefined, previous);
  assert.equal(prepared.competition, previous.competition);
  assert.equal(prepared.clans, next.clans);
});

test("participation edits, scored kills and deadlines match the full competition path", () => {
  const store = fixture();
  store.save(store.data, AT);
  const previous = freeze(store.data), id = previous.competition.day.pairs[0].a;
  const key = Object.keys(previous.profiles).find(k => previous.profiles[k].clanId === id);
  const scenarios = [
    [{ ...previous, clans: { ...previous.clans, [id]: { ...previous.clans[id],
      members: previous.clans[id].members.slice() } } }, AT + 50],
    [{ ...previous, profiles: { ...previous.profiles, [key]: { ...previous.profiles[key],
      progress: { ...previous.profiles[key].progress, kills: previous.profiles[key].progress.kills + 1 } } } }, AT + 50],
    [previous, previous.competition.day.end],
  ];
  for (const [next, at] of scenarios) {
    freeze(next);
    const fast = competition.capture(next, previous, at);
    const full = competition.capture({ ...next, competition: structuredClone(next.competition) }, previous, at);
    assert.deepEqual(fast, full);
    assert.notEqual(fast.competition, previous.competition);
  }
});

test("repeated mixed clan scores exactly match a full capture and keep unrelated records shared", () => {
  const store = fixture();
  store.save(store.data, AT);
  let previous = freeze(store.data);
  const active = new Set(previous.competition.day.pairs.flatMap(pair => [pair.a, pair.b]));
  const keys = Object.keys(previous.profiles).filter(k => active.has(previous.profiles[k].clanId));
  assert.ok(keys.length > 4);
  for (let step = 1; step <= 16; step++) {
    const profiles = { ...previous.profiles };
    for (let i = 0; i < keys.length; i++) {
      if ((i + step) % 3 === 0) continue;
      const p = profiles[keys[i]];
      profiles[keys[i]] = { ...p, progress: { ...p.progress, kills: p.progress.kills + (i % 5) + 1 } };
    }
    const next = freeze({ ...previous, profiles });
    const at = AT + step * 50;
    const full = competition.capture({ ...next, competition: structuredClone(next.competition) }, previous, at);
    const fast = competition.capture(next, previous, at);
    assert.deepEqual(fast, full);
    assert.equal(fast.clans, next.clans);
    assert.equal(fast.competition.day.pairs, next.competition.day.pairs);
    assert.equal(fast.competition.day.rosters, next.competition.day.rosters);
    assert.equal(fast.competition.week.groups, next.competition.week.groups);
    for (const key of keys.filter((_, i) => (i + step) % 3 === 0))
      assert.equal(fast.profiles[key], next.profiles[key]);
    previous = freeze(fast);
  }
});

test("stable score capture rejects invalid profiles and score overflow without mutating input", () => {
  const store = fixture();
  store.save(store.data, AT);
  const previous = freeze(store.data), clanId = previous.competition.day.pairs[0].a;
  const key = Object.keys(previous.profiles).find(k => previous.profiles[k].clanId === clanId);
  const bad = structuredClone(previous.profiles[key]);
  bad.progress.kills++;
  bad.activity.values.league_fighter = -1;
  assert.throws(() => competition.capture({ ...previous, profiles: { ...previous.profiles, [key]: bad } }, previous, AT + 50));
  const max = structuredClone(previous);
  max.competition.day.scores[clanId] = { kills: Number.MAX_SAFE_INTEGER, members: {} };
  const captured = freeze(competition.capture(max, max, AT));
  const scorer = structuredClone(captured.profiles[key]);
  scorer.progress.kills++;
  const next = freeze({ ...captured, profiles: { ...captured.profiles, [key]: scorer } });
  const before = JSON.stringify(next);
  assert.throws(() => competition.capture(next, captured, AT + 50), /Превышен/);
  assert.equal(JSON.stringify(next), before);
});
