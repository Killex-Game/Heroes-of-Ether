"use strict";
// Diagnostic targets, not a certification of browser FPS or long-run stability.
const PHASES = ["move", "split", "feed", "boosters", "combined"];
const LOBBY_ACTIONS = ["profile", "rankings", "social-view", "loadout", "purchase"];
const TARGETS = Object.freeze({ updatesHz: 19, tickP95Ms: 100, stateGapP99Ms: 150, lobbyP95Ms: 1000, actionP95Ms: 500 });

function assessCapacity(rows, summary) {
  const problems = [];
  if (summary.code !== 0 || summary.failure) problems.push("run-not-completed");
  if (summary.mode === "database" && summary.databaseVerification?.matched !== true)
    problems.push("database-consistency-unverified");
  // A soak run consists of consecutive mixed minutes, not the five diagnostic
  // phases. Judge EVERY requested window without averaging away a slow minute.
  const mixed = summary.mixedMinutes !== undefined && summary.mixedMinutes !== 0;
  const validMixed = Number.isInteger(summary.mixedMinutes) && summary.mixedMinutes > 0 &&
    summary.mixedMinutes <= 120 && summary.phaseSeconds === 60;
  if (mixed && !validMixed) problems.push("mixed-window-configuration");
  if (mixed && validMixed && rows.length !== summary.mixedMinutes) problems.push("mixed-window-count");
  const requested = mixed && validMixed
    ? Array.from({ length: summary.mixedMinutes }, (_, index) => ({ name: "combined", index }))
    : PHASES.map(name => ({ name }));
  const phases = requested.map(({ name, index }) => {
    const window = index !== undefined;
    const matches = window ? (rows[index]?.phase === name ? [rows[index]] : []) : rows.filter(row => row.phase === name);
    const issues = [], row = matches[0];
    if (matches.length !== 1) issues.push("phase-missing-or-duplicated");
    const max = (value, limit, label) => {
      if (!Number.isFinite(value) || value > limit) issues.push(label);
    };
    if (row) {
      if (window && (!Number.isFinite(row.elapsed) || row.elapsed < 60000)) issues.push("mixed-window-duration");
      // Fast snapshots of a paused simulation are not successful gameplay.
      if (!row.persistence || row.persistence.pausedSamples !== 0 || row.persistence.end?.paused !== false)
        issues.push("progress-paused-or-unverified");
      if (["boosters", "combined"].includes(name) &&
          (!row.usedByType || Object.keys(row.usedByType).length !== 30 ||
           Object.values(row.usedByType).some(count => !(count > 0))))
        issues.push("booster-coverage");
      if (["boosters", "combined"].includes(name)) {
        if (!(row.actionRequests > 0) || !Number.isFinite(row.actionPending))
          issues.push("action-latency-unverified");
        max(row.actionLatencyP95Max ?? row.actionLatencyMs?.p95, TARGETS.actionP95Ms, "action-delay");
        max(row.successfulActionLatencyP95Max ?? row.successfulActionLatencyMs?.p95, TARGETS.actionP95Ms, "successful-action-delay");
        max(row.oldestPendingActionMs, 1000, "pending-action-delay");
      }
      if (summary.profileWorker && (!row.profileWorker?.jobs || row.profileWorker.failures !== 0))
        issues.push("profile-worker-not-active");
      if (row.connections !== summary.players) issues.push("connections");
      if (!Number.isFinite(row.updatesPerClient) || row.updatesPerClient < TARGETS.updatesHz)
        issues.push("state-frequency");
      max(row.tickGaps?.p95, TARGETS.tickP95Ms, "tick-delay");
      max(row.clientGapP99Max ?? row.clientGaps?.p99, TARGETS.stateGapP99Ms, "state-delay");
      if (summary.lobby > 0) {
        if (row.lobby?.clients !== summary.lobby || !(row.lobby?.success > 0)) issues.push("lobby-unverified");
        max(row.lobby?.latencyMs?.p95, TARGETS.lobbyP95Ms, "lobby-delay");
        if (!row.lobby?.errors || Object.values(row.lobby.errors).some(count => count !== 0)) issues.push("lobby-errors");
        if (summary.mixedSocial && (!(row.lobby?.actions?.gift > 0) || !(row.lobby?.actions?.["gift-read"] > 0)))
          issues.push("social-write-coverage");
        // Reads can remain quick while all modifying requests are stuck.
        // After all six account bonuses, the driver uses daily-reward in that slot.
        const actions = row.lobby?.actions;
        if (LOBBY_ACTIONS.some(action => !(actions?.[action] > 0)) ||
            !((actions?.["account-bonus"] || 0) + (actions?.["daily-reward"] || 0) > 0))
          issues.push("lobby-action-coverage");
      }
    }
    return { phase: name, ...(window ? { window: index + 1 } : {}), meetsTargets: issues.length === 0, issues };
  });
  return { targets: TARGETS, shortRunMeetsTargets: problems.length === 0 && phases.every(p => p.meetsTargets),
    problems, phases, scope: "Server and WebSocket clients only; no browser rendering or long-duration guarantee." };
}
module.exports = { assessCapacity, TARGETS };
