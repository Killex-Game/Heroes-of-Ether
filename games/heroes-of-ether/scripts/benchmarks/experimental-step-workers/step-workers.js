"use strict";
const path = require("node:path");
const { Worker, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { serialize, deserialize } = require("node:v8");
const { capture, install, RandomTape } = require("./step-state");
const { GraphDelta } = require("./graph-delta");

// First isolation stage: compute rooms concurrently, commit at a common step
// boundary. The parent still waits at this barrier. No callback can interleave
// a mutation with a checkpoint, and profile transactions stay in one authority.
// Disabled by default; benchmarks must include checkpoint/transfer overhead.
class ArenaStepWorkers {
  constructor({ maxWorkers = 0, timeoutMs = 100, delta = false, workerFile = path.join(__dirname, "step-worker.js") } = {}) {
    if (!Number.isInteger(maxWorkers) || maxWorkers < 0 || maxWorkers > 20 ||
        !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw RangeError("Invalid step worker configuration");
    this.maxWorkers = maxWorkers;
    this.timeoutMs = timeoutMs;
    this.workerFile = workerFile;
    this.delta = delta;
    this.lanes = [];
    this.tapes = new WeakMap();
    this.sequence = 0;
    this.closed = false;
    this.stopping = [];
    this.stats = { dispatched: 0, completed: 0, fallback: 0, entropyFallback: 0, computeMs: 0, batchMs: 0 };
  }
  lane() {
    const { port1, port2 } = new MessageChannel();
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(this.workerFile, { workerData: { signal: signal.buffer, output: port2, delta: this.delta }, transferList: [port2] });
    const lane = { worker, signal, port: port1, failed: false };
    worker.on("error", () => { lane.failed = true; });
    worker.on("exit", () => { lane.failed = true; });
    worker.unref();
    port1.unref();
    this.lanes.push(lane);
    return lane;
  }
  retire(lane) {
    if (lane.retired) return;
    lane.failed = lane.retired = true;
    lane.port.close();
    this.stopping.push(lane.worker.terminate());
  }
  step(arenas, at) {
    if (this.closed) throw Error("Step workers closed");
    if (this.maxWorkers < 2 || arenas.length < 2) return arenas.map(arena => arena.step(at));
    while (this.lanes.length < Math.min(this.maxWorkers, arenas.length)) this.lane();
    const ready = this.lanes.filter(lane => !lane.failed && Atomics.load(lane.signal, 0) !== 0);
    const results = new Map(), pending = [];
    const start = performance.now();
    for (let i = 0; i < Math.min(ready.length, arenas.length); i++) {
      const arena = arenas[i], lane = ready[i], id = ++this.sequence;
      let tape = this.tapes.get(arena);
      if (!tape) { tape = new RandomTape(arena); this.tapes.set(arena, tape); }
      try {
        const reset = this.delta && (lane.arena !== arena || !lane.codec);
        if (reset) { lane.codec = new GraphDelta(0); lane.arena = arena; }
        const state = this.delta ? lane.codec.encode(capture(arena)) : serialize(capture(arena));
        lane.worker.postMessage({ id, state, at, reset, randomValues: tape.reserve(tape.capacity || 256) }, this.delta ? [] : [state.buffer]);
        pending.push({ arena, lane, id, tape });
        this.stats.dispatched++;
      } catch (_) {
        this.retire(lane);
        this.stats.fallback++;
      }
    }
    // Rooms beyond the worker budget execute while workers compute their rooms.
    const submitted = new Set(pending.map(job => job.arena));
    for (const arena of arenas) if (!submitted.has(arena)) results.set(arena, arena.step(at));
    const deadline = performance.now() + this.timeoutMs;
    for (const { arena, lane, id, tape } of pending) {
      while (Atomics.load(lane.signal, 0) !== id && performance.now() < deadline) {
        const current = Atomics.load(lane.signal, 0);
        if (current === id) break;
        Atomics.wait(lane.signal, 0, current, Math.max(0, deadline - performance.now()));
      }
      const reply = Atomics.load(lane.signal, 0) === id ? receiveMessageOnPort(lane.port)?.message : null;
      if (reply?.id === id && !reply.error) {
        const result = this.delta ? lane.codec.decode(reply.result) : deserialize(reply.result);
        tape.consume(reply.used);
        install(arena, result.state);
        results.set(arena, result.events);
        this.stats.completed++;
        this.stats.computeMs += reply.computeMs;
      } else {
        // Nothing from the failed calculation was published or persisted.
        // Retire timed-out lanes so a late result can never overwrite fallback.
        if (reply?.error === "RANDOM_TAPE_EXHAUSTED") {
          tape.capacity = Math.min(16384, (tape.capacity || 256) * 4);
          this.stats.entropyFallback++;
          lane.codec = null;
        } else this.retire(lane);
        this.stats.fallback++;
        results.set(arena, arena.step(at));
      }
    }
    this.stats.batchMs += performance.now() - start;
    return arenas.map(arena => results.get(arena));
  }
  async close() {
    this.closed = true;
    for (const lane of this.lanes) this.retire(lane);
    await Promise.allSettled(this.stopping);
  }
}
module.exports = { ArenaStepWorkers };
