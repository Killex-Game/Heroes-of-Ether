"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { PerformanceMonitor, METRIC_LIMITS } = require("../../src/server/runtime/performance-monitor");
test("server metrics retain bounded recent samples and distinguish paused ticks", () => {
  let at = 0;
  const monitor = new PerformanceMonitor({ observeLoop: false, now: () => at });
  assert.equal(monitor.snapshot().updatesHz, 0);
  for (let i = 0; i < 3000; i++) { at += 50; monitor.record(at, i % 20 ? 5 : 30, i % 10 !== 0); }
  const value = monitor.snapshot();
  assert.equal(monitor.count, METRIC_LIMITS.SAMPLES);
  assert.equal(value.windowMs, 60000);
  assert.equal(value.ticks, 1201);
  assert.equal(value.advancedTicks, 1081);
  assert.equal(value.tickIntervalMs.p95, 50);
  assert.equal(value.tickWorkMs.max, 30);
  assert.equal(value.eventLoop, null);
  at += 60001;
  assert.equal(monitor.snapshot().ticks, 0);
  assert.equal(monitor.snapshot().updatesHz, 0);
  monitor.close();
});
