"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { install } = require("../../scripts/benchmarks/slow-io-probe.cjs");
test("I/O diagnostics preserve returns, receiver and exact failures without recording input", () => {
  let time = 0;
  const failure = Error("private pathname"), target = {
    writeSync(value) { assert.equal(this, target); assert.equal(value, "private buffer"); time += 31; return 123; },
    fsyncSync() { time += 21; throw failure; },
  }, original = target.writeSync;
  const probe = install({ target, now: () => time, limit: 2 });
  assert.equal(target.writeSync("private buffer"), 123);
  assert.throws(() => target.fsyncSync(), error => error === failure);
  const report = probe.snapshot();
  assert.equal(report.stats.writeSync.bytes, 123);
  assert.equal(report.stats.fsyncSync.failures, 1);
  assert.equal(report.slow.length, 2);
  assert(!JSON.stringify(report).includes("private"));
  report.slow[0].elapsedMs = 0;
  assert.equal(probe.snapshot().slow[0].elapsedMs, 31);
  target.writeSync("private buffer");
  assert.equal(probe.snapshot().discarded, 1);
  probe.reset(); assert.deepEqual(probe.snapshot().stats, {});
  probe.close(); assert.equal(target.writeSync, original);
});
test("closing a diagnostic never overwrites a later instrumentation owner", () => {
  const target = { statSync() { return 1; } }, probe = install({ target, now: () => 0 });
  const replacement = () => 2; target.statSync = replacement;
  probe.close(); assert.equal(target.statSync, replacement);
  assert.throws(() => install({ target, limit: 0 }));
});
