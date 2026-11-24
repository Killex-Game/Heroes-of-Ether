"use strict";
const fs = require("node:fs"), { performance } = require("node:perf_hooks");
// Explicit diagnostic mode only. Never logs paths, buffers, profile IDs or
// error messages. Measurements are inclusive when one wrapped call uses another.
function install({ target = fs, now = () => performance.now(), thresholdMs = 20, limit = 40 } = {}) {
  const methods = ["writeSync", "writevSync", "readSync", "ftruncateSync", "fsyncSync", "renameSync",
    "linkSync", "unlinkSync", "readdirSync", "openSync", "closeSync", "statSync", "lstatSync", "readFileSync"];
  if (!(thresholdMs > 0) || !Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw Error("Invalid synchronous I/O diagnostic limits");
  const installed = []; let stats = {}, slow = [], discarded = 0;
  for (const name of methods) {
    const original = target[name]; if (typeof original !== "function") continue;
    function wrapped(...args) {
      const start = now(); let failed = false, bytes;
      try {
        const result = original.apply(this, args);
        if (["writeSync", "writevSync", "readSync"].includes(name) && Number.isSafeInteger(result)) bytes = result;
        return result;
      } catch (error) { failed = true; throw error; }
      finally {
        const elapsedMs = now() - start;
        const row = stats[name] ||= { calls: 0, totalMs: 0, maxMs: 0, failures: 0, bytes: 0 };
        row.calls++; row.totalMs += elapsedMs; row.maxMs = Math.max(row.maxMs, elapsedMs);
        row.failures += Number(failed); row.bytes += bytes || 0;
        if (elapsedMs >= thresholdMs) {
          if (slow.length === limit) { slow.shift(); discarded++; }
          slow.push({ name, elapsedMs, failed, ...(bytes === undefined ? {} : { bytes }) });
        }
      }
    }
    target[name] = wrapped; installed.push({ name, original, wrapped });
  }
  return {
    reset() { stats = {}; slow = []; discarded = 0; },
    snapshot() { return { stats: structuredClone(stats), slow: structuredClone(slow), discarded, thresholdMs, inclusive: true }; },
    close() { for (const { name, original, wrapped } of installed) if (target[name] === wrapped) target[name] = original; },
  };
}
module.exports = { install };
