"use strict";
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { difference } = require("./profile-journal");
const { applyTransfer } = require("./profile-transfer");
const competition = require("../clans/clan-competition-service");
const optionKeys = ["petEvents", "baseRouletteConfig", "promotionConfig", "unlockLeagueBackgrounds",
  "unlockLeagueFrames", "unlockClanCrests", "clanDailyQuests"];
function context(store, batches) {
  return { options: Object.fromEntries(optionKeys.map(key => [key, store[key]])),
    events: store.events?.data, rankingReady: store.eventRankingReady?.() !== false,
    clanQuestSettlement: [...new Set(batches.map(batch => batch.at))]
      .map(at => [at, store.clanQuestSettlementReady?.(at) !== false]),
    incrementalSettlement: !!store.settlementCache };
}
function sameContext(store, before) {
  return store.events?.data === before.events && (store.eventRankingReady?.() !== false) === before.rankingReady &&
    before.clanQuestSettlement.every(([at, ready]) => (store.clanQuestSettlementReady?.(at) !== false) === ready) &&
    !!store.settlementCache === before.incrementalSettlement &&
    optionKeys.every(key => store[key] === before.options[key]);
}
class ArenaProgressPreparer {
  constructor({ timeoutMs = 10000, parallelism = 0, computeBudgetMs = null, batched = false, workerFactory } = {}) {
    if (!Number.isInteger(parallelism) || parallelism < 0 || parallelism > 8) throw Error("Invalid progress parallelism");
    if (computeBudgetMs !== null && (!Number.isFinite(computeBudgetMs) || computeBudgetMs < 1 || computeBudgetMs > 100)) throw Error("Invalid progress compute budget");
    this.timeoutMs = timeoutMs;
    this.computeBudgetMs = computeBudgetMs;
    this.workerFactory = workerFactory || (() => new Worker(path.join(__dirname, "arena-progress-worker.js"), {workerData:{parallelism,batched}}));
    this.base = {};
    this.sequence = 0;
    this.stats = { jobs: 0, conflicts: 0, failures: 0, computeMs: 0, transferMs: 0, roundTripMs: 0 };
  }
  async prepare(store, batches, budgetMs) {
    if (this.failed || this.closed) return undefined;
    if (this.pending) throw Error("Concurrent arena progress preparation");
    const base = store.data, ctx = context(store, batches), started = performance.now();
    try {
      if (!this.worker) {
        this.worker = this.workerFactory();
        this.worker.on("message", message => this.complete(message));
        this.worker.on("error", error => this.fail("worker-error", error));
        this.worker.on("messageerror", error => this.fail("worker-message", error));
        this.worker.on("exit", () => { if (!this.closed) this.fail("worker-exit"); });
      }
      const adopt = this.last ? this.last.id : null;
      const patch = difference(base, adopt ? this.last.snapshot : this.base);
      const id = ++this.sequence;
      const result = new Promise(resolve => {
        this.pending = { id, base, ctx, store, resolve, started };
        this.timer = setTimeout(() => this.fail("timeout"), this.timeoutMs);
      });
      this.worker.ref();
      // Queue entries also contain socket notifications and promise waiters.
      // They belong to the owning thread; send only deterministic game inputs.
      const inputs = batches.map(({ id, at, progress }) => ({ id, at, progress }));
      this.worker.postMessage({ id, adopt, patch, context: ctx, batches: inputs, budgetMs: this.computeBudgetMs ?? budgetMs,
        competitionCaptured: competition.isCaptured(base) });
      this.base = base;
      this.last = null;
      this.stats.jobs++;
      this.stats.transferMs += performance.now() - started;
      return await result;
    } catch (error) {
      this.fail("send", error);
      return undefined;
    }
  }
  complete(message) {
    const pending = this.pending;
    if (!pending || message.id !== pending.id) return;
    if (message.failed || !Array.isArray(message.changes) || !message.patch) return this.fail("calculation");
    clearTimeout(this.timer);
    this.pending = null;
    this.worker.unref();
    this.stats.computeMs += message.computeMs;
    if (message.shards) this.stats.shards = message.shards;
    this.stats.roundTripMs += performance.now() - pending.started;
    if (pending.store.data !== pending.base || !sameContext(pending.store, pending.ctx)) {
      this.stats.conflicts++;
      pending.resolve(null); // Retry the same FIFO prefix on the new committed state.
      return;
    }
    try {
      const started = performance.now();
      const snapshot = message.changed ? applyTransfer(pending.base, message.patch) : pending.base;
      if (message.competitionCaptured === true) competition.adoptCapturedFromWorker(snapshot);
      this.last = { id: message.id, snapshot };
      this.stats.transferMs += performance.now() - started;
      pending.resolve({ snapshot, changes: message.changes });
    } catch (error) {
      // Preserve the caller's fallback even if patch validation fails.
      this.fail("patch", error);
      pending.resolve(undefined);
    }
  }
  fail(reason, error) {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.stats.failures++;
    this.stats.failureReason = reason;
    clearTimeout(this.timer);
    this.pending?.resolve(undefined);
    this.pending = this.last = null;
    this.base = {};
    this.stopped = this.worker?.terminate();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.pending?.resolve(undefined);
    this.pending = this.last = null;
    this.base = {};
    await (this.stopped || this.worker?.terminate());
  }
}
module.exports = { ArenaProgressPreparer };
