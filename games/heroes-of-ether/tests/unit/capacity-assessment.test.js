"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { assessCapacity } = require("../../scripts/benchmarks/capacity-assessment.cjs");
const make = () => ({
  summary: { code: 0, mode: "database", players: 35, lobby: 30, databaseVerification: { matched: true } },
  rows: ["move", "split", "feed", "boosters", "combined"].map(phase => ({
    phase, connections: 35, updatesPerClient: 20, tickGaps: {p95: 65}, clientGaps: {p99: 80},
    actionRequests: 500, actionPending: 2, actionLatencyP95Max: 100,
    successfulActionLatencyP95Max: 100, oldestPendingActionMs: 100,
    persistence: { pausedSamples: 0, end: { paused: false } },
    usedByType: Object.fromEntries(Array.from({length:30}, (_, i) => ["booster-" + i, 1])),
    lobby: {clients: 30, success: 100, errors: {}, latencyMs: {p95: 200},
      actions: { profile: 1, rankings: 1, "social-view": 1, loadout: 1, purchase: 1, "account-bonus": 1 }},
  })),
});

test("fast snapshots cannot mask delayed booster confirmations or missing measurements", () => {
  const { rows, summary } = make();
  rows[3].actionLatencyP95Max = 4000;
  rows[3].oldestPendingActionMs = 12000;
  rows[4].successfulActionLatencyP95Max = 4000;
  delete rows[4].actionRequests;
  const result = assessCapacity(rows, summary);
  assert.equal(result.shortRunMeetsTargets, false);
  assert.ok(result.phases[3].issues.includes("action-delay"));
  assert.ok(result.phases[3].issues.includes("pending-action-delay"));
  assert.ok(result.phases[4].issues.includes("successful-action-delay"));
  assert.ok(result.phases[4].issues.includes("action-latency-unverified"));
});
test("completed short run must meet latency and throughput targets", () => {
  const { rows, summary } = make();
  assert.equal(assessCapacity(rows, summary).shortRunMeetsTargets, true);
  rows[4].updatesPerClient = 2.8;
  rows[4].lobby.latencyMs.p95 = 14000;
  const result = assessCapacity(rows, summary);
  assert.equal(result.shortRunMeetsTargets, false);
  assert.deepEqual(result.phases[4].issues, ["state-frequency", "lobby-delay"]);
});
test("no passing result from missing, duplicate or missing-measurement phases", () => {
  for (const change of [r => r.pop(), r => r.push(r[0]), r => delete r[0].tickGaps]) {
    const { rows, summary } = make(); change(rows);
    assert.equal(assessCapacity(rows, summary).shortRunMeetsTargets, false);
  }
});
test("database consistency and successful process exit are required independently of speed", () => {
  for (const change of [s => s.code = 1, s => delete s.databaseVerification, s => s.databaseVerification.matched = false]) {
    const { rows, summary } = make(); change(summary);
    assert.equal(assessCapacity(rows, summary).shortRunMeetsTargets, false);
  }
});
test("multi-room client latency, lobby failures and lost connections fail the gate", () => {
  const { rows, summary } = make();
  rows[0].clientGapP99Max = 200;
  rows[1].lobby.errors.timeout = 1;
  rows[2].connections = 34;
  const result = assessCapacity(rows, summary);
  assert.ok(result.phases[0].issues.includes("state-delay"));
  assert.ok(result.phases[1].issues.includes("lobby-errors"));
  assert.ok(result.phases[2].issues.includes("connections"));
});

test("fallback to the main thread cannot pass as a successful worker experiment", () => {
  const { rows, summary } = make();
  summary.profileWorker = true;
  for (const row of rows) row.profileWorker = { jobs: 10, failures: 0 };
  assert.equal(assessCapacity(rows, summary).shortRunMeetsTargets, true);
  rows[0].profileWorker.failures = 1;
  assert.ok(assessCapacity(rows, summary).phases[0].issues.includes("profile-worker-not-active"));
});

test("fast reads and snapshots cannot hide paused progress or stalled gameplay actions", () => {
  const { rows, summary } = make();
  rows[0].persistence.pausedSamples = 1;
  delete rows[1].persistence;
  delete rows[2].lobby.actions.purchase;
  rows[3].usedByType["booster-0"] = 0;
  const result = assessCapacity(rows, summary);
  assert.equal(result.shortRunMeetsTargets, false);
  assert.ok(result.phases[0].issues.includes("progress-paused-or-unverified"));
  assert.ok(result.phases[1].issues.includes("progress-paused-or-unverified"));
  assert.ok(result.phases[2].issues.includes("lobby-action-coverage"));
  assert.ok(result.phases[3].issues.includes("booster-coverage"));
});

test("long runs use daily rewards after the driver exhausts account bonuses", () => {
  const { rows, summary } = make();
  delete rows[4].lobby.actions["account-bonus"];
  rows[4].lobby.actions["daily-reward"] = 8;
  assert.equal(assessCapacity(rows, summary).shortRunMeetsTargets, true);
  delete rows[4].lobby.actions["daily-reward"];
  assert.ok(assessCapacity(rows, summary).phases[4].issues.includes("lobby-action-coverage"));
});

function mixedRun() {
  const { rows, summary } = make();
  return { summary: { ...summary, mixedMinutes: 2, phaseSeconds: 60 },
    rows: [structuredClone(rows[4]), structuredClone(rows[4])].map(row => ({ ...row, elapsed: 60020 })) };
}
test("mixed minutes are assessed individually and cannot hide one slow or failed minute", () => {
  const { rows, summary } = mixedRun();
  const good = assessCapacity(rows, summary);
  assert.equal(good.shortRunMeetsTargets, true);
  assert.deepEqual(good.phases.map(p => p.window), [1, 2]);
  rows[1].updatesPerClient = 18;
  rows[1].persistence.pausedSamples = 1;
  const result = assessCapacity(rows, summary);
  assert.equal(result.shortRunMeetsTargets, false);
  assert.equal(result.phases[0].meetsTargets, true);
  assert.deepEqual(result.phases[1].issues, ["progress-paused-or-unverified", "state-frequency"]);
});
test("missing, extra, wrong-phase and incomplete mixed windows fail assessment", () => {
  for (const change of [rows => rows.pop(), rows => rows.push(rows[0]),
    rows => rows[1].phase = "move", rows => rows[1].elapsed = 59000,
    rows => delete rows[1].elapsed, rows => delete rows[1].usedByType]) {
    const { rows, summary } = mixedRun(); change(rows);
    assert.equal(assessCapacity(rows, summary).shortRunMeetsTargets, false);
  }
});
test("mixed mode retains storage, lobby and action requirements and rejects invalid durations", () => {
  for (const change of [s => s.code = 1, s => s.databaseVerification.matched = false,
    s => s.phaseSeconds = 30, s => s.mixedMinutes = 1.5, s => s.mixedMinutes = -1]) {
    const { rows, summary } = mixedRun(); change(summary);
    assert.equal(assessCapacity(rows, summary).shortRunMeetsTargets, false);
  }
  for (const change of [r => r.successfulActionLatencyP95Max = 2000, r => r.connections = 34,
    r => r.lobby.errors.timeout = 1]) {
    const { rows, summary } = mixedRun(); change(rows[1]);
    assert.equal(assessCapacity(rows, summary).shortRunMeetsTargets, false);
  }
});
