"use strict";
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");

const METRIC_LIMITS = Object.freeze({ WINDOW_MS: 60000, SAMPLES: 2048, LOOP_RESOLUTION_MS: 20, LOOP_WINDOW_MS: 10000 });
const rounded = n => Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
function distribution(values) {
  if (!values.length) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  values.sort((a, b) => a - b);
  const percentile = p => rounded(values[Math.max(0, Math.ceil(values.length * p) - 1)]);
  return { count: values.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: rounded(values.at(-1)) };
}
class PerformanceMonitor {
  constructor({ observeLoop = true, now = () => performance.now() } = {}) {
    this.now = now;
    this.startedAt = now();
    this.starts = new Float64Array(METRIC_LIMITS.SAMPLES);
    this.durations = new Float64Array(METRIC_LIMITS.SAMPLES);
    this.gaps = new Float64Array(METRIC_LIMITS.SAMPLES);
    this.advanced = new Uint8Array(METRIC_LIMITS.SAMPLES);
    this.count = 0; this.cursor = 0; this.previousAt = null;
    if (observeLoop) {
      this.loop = monitorEventLoopDelay({ resolution: METRIC_LIMITS.LOOP_RESOLUTION_MS });
      this.loop.enable();
      this.loopStartedAt = now();
      this.timer = setInterval(() => {
        this.lastLoop = this.loopSnapshot();
        this.loop.reset(); this.loopStartedAt = now();
      }, METRIC_LIMITS.LOOP_WINDOW_MS);
      this.timer.unref();
    }
  }
  record(startedAt, durationMs, advanced = true) {
    const index = this.cursor;
    this.starts[index] = startedAt; this.durations[index] = durationMs;
    this.gaps[index] = this.previousAt === null ? 0 : startedAt - this.previousAt;
    this.advanced[index] = advanced ? 1 : 0;
    this.previousAt = startedAt;
    this.cursor = (index + 1) % METRIC_LIMITS.SAMPLES;
    this.count = Math.min(this.count + 1, METRIC_LIMITS.SAMPLES);
  }
  loopSnapshot() {
    if (!this.loop) return null;
    return { windowMs: rounded(this.now() - this.loopStartedAt), resolutionMs: METRIC_LIMITS.LOOP_RESOLUTION_MS,
      samples: this.loop.count, p95Ms: rounded(this.loop.percentile(95) / 1e6),
      p99Ms: rounded(this.loop.percentile(99) / 1e6), maxMs: rounded(this.loop.max / 1e6) };
  }
  snapshot() {
    const at = this.now(), since = Math.max(this.startedAt, at - METRIC_LIMITS.WINDOW_MS);
    const durations = [], gaps = []; let advanced = 0;
    for (let i = 0; i < this.count; i++) if (this.starts[i] >= since) {
      durations.push(this.durations[i]); if (this.gaps[i] > 0) gaps.push(this.gaps[i]);
      advanced += this.advanced[i];
    }
    const windowMs = at - since;
    return { windowMs: rounded(windowMs), ticks: durations.length, advancedTicks: advanced,
      updatesHz: windowMs > 0 ? rounded(advanced * 1000 / windowMs) : 0,
      tickWorkMs: distribution(durations), tickIntervalMs: distribution(gaps),
      eventLoop: this.lastLoop || this.loopSnapshot() };
  }
  close() { clearInterval(this.timer); this.loop?.disable(); }
}
module.exports = { PerformanceMonitor, METRIC_LIMITS };
