"use strict";
// Isolated receipt copy-cost comparison. Both paths retain the same receipts.
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");
const { record } = require("../../src/server/progression/quest-receipts");
const seed = { seen: {}, seenBuckets: {} };
for (let i = 0; i < 5000; i++) record(seed, `victim-${i}:part-${i}`);
const run = (batched) => {
  const session = { seen: seed.seen, seenBuckets: seed.seenBuckets };
  const start = performance.now();
  for (let batch = 0; batch < 20; batch++) {
    const scope = batched ? new WeakMap() : undefined;
    for (let i = 0; i < 200; i++) record(session, `new-${batch}:${i}`, scope);
  }
  return { ms: performance.now() - start,
    hash: createHash("sha256").update(JSON.stringify(session)).digest("hex") };
};
const rows = [false, true, true, false].map(batched => ({ batched, ...run(batched) }));
if (new Set(rows.map(x => x.hash)).size !== 1) throw Error("Receipt mismatch");
console.log(JSON.stringify(rows));
