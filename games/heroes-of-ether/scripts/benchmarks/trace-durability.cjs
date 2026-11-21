/* Diagnostic preloader for isolated benchmarks. Never imported by the server. */
"use strict";
const { performance } = require("node:perf_hooks");
const { ProfileJournal } = require("../../src/server/profiles/profile-journal");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ArenaBoosterQueue } = require("../../src/server/profiles/arena-booster-queue");
const totals = {};
for (const [type, methods] of [[ProfileJournal, ["stage", "commit", "commitArena"]],
  [ProfileStore, ["prepareSnapshot", "writeSnapshot"]], [ArenaBoosterQueue, ["prepare", "commit"]]]) {
  for (const method of methods) {
    const original = type.prototype[method];
    if (!original) throw Error("Missing diagnostic method: " + method);
    const name = type.name + "." + method;
    type.prototype[method] = function (...args) {
      const started = performance.now();
      const finish = () => {
        const ms = performance.now() - started;
        const row = totals[name] ||= { n: 0, ms: 0, max: 0, over50: 0 };
        row.n++; row.ms += ms; row.max = Math.max(row.max, ms);
        if (ms > 50) {
          row.over50++;
          console.log(JSON.stringify({ durability: name, ms, at: performance.now() }));
        }
      };
      let result;
      try { result = original.apply(this, args); } catch (e) { finish(); throw e; }
      if (result && typeof result.then === "function") return result.finally(finish);
      finish(); return result;
    };
  }
}
process.on("exit", () => console.log(JSON.stringify({ durabilityTotals: totals })));
