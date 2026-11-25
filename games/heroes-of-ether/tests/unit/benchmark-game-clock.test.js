"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { fromStart, clock } = require("../../scripts/benchmarks/game-clock.cjs");
const calendar = require("../../public/shared/clan-season-calendar");
const { seedParts } = require("../../scripts/benchmarks/seed-arena-parts.cjs");
const { Arena, RULES, massLimitForLevel, radiusForMass } = require("../../src/server/arena/arena-simulation");

test("synthetic calendar advances normally through closing while real wall time is unchanged", () => {
  let real = Date.parse("2026-11-24T23:00:00.000Z");
  const start = "2026-11-24T09:00:00.000Z", config = fromStart(start, real);
  const gameNow = clock(String(config.offsetMs), () => real);
  assert.equal(gameNow(), Date.parse(start));
  assert.equal(real, Date.parse("2026-11-24T23:00:00.000Z"));
  assert.equal(calendar.season(gameNow()).mode, "quests");
  const day = calendar.daily(gameNow());
  assert(day.start <= gameNow() && gameNow() < day.end);
  real += 60000;
  assert.equal(gameNow(), Date.parse(start) + 60000);
  real += day.end - gameNow();
  assert.equal(gameNow(), day.end);
  assert(!(day.start <= gameNow() && gameNow() < day.end));
});

test("clock defaults to live wall time and rejects ambiguous or unbounded shifts", () => {
  const at = Date.parse("2026-11-24T23:00:00.000Z");
  assert.equal(fromStart(undefined, at).offsetMs, 0);
  assert.equal(clock(undefined, () => at)(), at);
  for (const input of ["tomorrow", "2026-11-24", "2026-11-24T09:00:00+03:00", "2020-01-01T00:00:00.000Z"])
    assert.throws(() => fromStart(input, at));
  for (const input of ["NaN", "0.5", "1e9", "Infinity", "", String(367 * 86400000)])
    assert.throws(() => clock(input, () => at));
});

test("seeded split bodies use simulation time, preserve legal mass and later merge normally", () => {
  const arena = new Arena({ etherCount: 0 }), now = 5000, p = arena.addPlayer(now, "fixture");
  const cap = massLimitForLevel(p.level), mass = 3 * cap + 1;
  Object.assign(p, { mass: cap, radius: radiusForMass(cap), protectedUntil: 0 });
  seedParts(arena, p, mass, p.level, now);
  assert.equal(p.mass, mass);
  assert.equal(p.parts.length, 4);
  assert(p.parts.every(part => part.mass <= cap));
  assert(p.parts.every(part => part.mergeAt === now + RULES.MERGE_DELAY_MS));
  assert.equal(p.splitSequence, 0);
  // Shrink below the per-part ceiling so this test permits all parts to merge.
  for (const part of p.parts) Object.assign(part, { mass: 10, radius: radiusForMass(10), x: 1000, y: 1000, vx: 0, vy: 0 });
  p.stopped = true;
  arena.syncParts(p);
  arena.moveParts(p, now + RULES.MERGE_DELAY_MS - 1, 0);
  assert.equal(p.parts.length, 4);
  arena.moveParts(p, now + RULES.MERGE_DELAY_MS, 0);
  assert.equal(arena.bodies(p).length, 1);
  assert.equal(p.mass, 40);
});

test("closed or unused clan boards cannot pass the requested active-quest workload", () => {
  const { assessCapacity } = require("../../scripts/benchmarks/capacity-assessment.cjs");
  const summary = { requiresActiveClanQuests: true, mixedMinutes: 1, phaseSeconds: 60 };
  const row = { phase: "combined", clanQuests: { active: 0, eligible: 1280, contributions: 0 } };
  let result = assessCapacity([row], summary);
  assert(result.problems.includes("clan-quest-contribution-unverified"));
  assert(result.phases[0].issues.includes("clan-quests-not-active"));
  row.clanQuests.active = 128; row.clanQuests.contributions = 1;
  result = assessCapacity([row], summary);
  assert(!result.problems.includes("clan-quest-contribution-unverified"));
  assert(!result.phases[0].issues.includes("clan-quests-not-active"));
});
