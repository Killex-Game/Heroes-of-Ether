/* Opt-in diagnostics for synthetic runs, never imported by the game. */
"use strict";
const fs = require("node:fs");
const { performance, PerformanceObserver } = require("node:perf_hooks");
const { isMainThread, threadId } = require("node:worker_threads");
const totals = {};
function record(name, ms) {
  const row = totals[name] ||= { count: 0, totalMs: 0, maxMs: 0, over50: 0 };
  row.count++; row.totalMs += ms; row.maxMs = Math.max(row.maxMs, ms);
  if (ms >= 50) {
    row.over50++;
    const stack = isMainThread && name === "ProfileStore.writeSnapshot" ? new Error().stack.split("\n").slice(3,9) : undefined;
    process.stdout.write(JSON.stringify({ stall: name, ms, threadId, at: performance.now(), stack }) + "\n");
  }
}
function wrap(target, key, prefix) {
  const original = target[key];
  if (typeof original !== "function") throw Error("Missing diagnostic target " + key);
  target[key] = function (...args) {
    const start = performance.now();
    try { return original.apply(this, args); }
    finally { record(prefix + key, performance.now() - start); }
  };
}
for (const key of ["writeSync", "fsyncSync", "renameSync", "readFileSync", "unlinkSync"])
  wrap(fs, key, "fs.");
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) record("gc." + entry.detail.kind, entry.duration);
});
observer.observe({ entryTypes: ["gc"] });
if (isMainThread) {
  const { ProfileStore } = require("../../src/server/profiles/profile-store");
  const { ProfileJournal } = require("../../src/server/profiles/profile-journal");
  const { Arena } = require("../../src/server/arena/arena-simulation");
  for (const [target, names] of [[ProfileStore, ["prepareSnapshot", "writeSnapshot"]],
    [ProfileJournal, ["encode", "publishStaged", "sealActive"]], [Arena, ["step", "snapshot"]]])
    for (const name of names) wrap(target.prototype, name, target.name + ".");
}
process.on("exit", () => process.stdout.write(JSON.stringify({ stallTotals: totals, threadId }) + "\n"));
