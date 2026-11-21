"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { ProfileStore } = require("./profile-store");
const { EventManager } = require("../events/event-manager");
const { difference } = require("./profile-journal");
const { applyTransfer } = require("./profile-transfer");
const competition = require("../clans/clan-competition-service");
// Persistent calculation replica. No file descriptors, sockets, Mongo client or
// authority to publish rewards. Only the owner can accept and persist a result.
const store = new ProfileStore();
const Shards = workerData?.batched
  ? require("./arena-progress-batched-shards").BatchedArenaProgressShards
  : require("./arena-progress-shards").ArenaProgressShards;
const shards = workerData?.parallelism ? new Shards({count:workerData.parallelism}) : null;
const clanShards = workerData?.parallelism ? new (require('./clan-arena-progress-shards').ClanArenaProgressShards)({count:workerData.parallelism}) : null;
let base = {}, prepared = null, currentTime = 0;
store.now = () => currentTime;
parentPort.on("message", async message => {
  const started = performance.now();
  try {
    if (message.adopt) {
      if (!prepared || prepared.id !== message.adopt) throw Error("Missing prepared profile baseline");
      base = prepared.snapshot;
    }
    base = applyTransfer(base, message.patch);
    if (message.competitionCaptured === true) competition.adoptCapturedFromWorker(base);
    prepared = null;
    store.data = base;
    currentTime = message.batches[0].at;
    Object.assign(store, message.context.options);
    if (message.context.incrementalSettlement)
      store.settlementCache ||= new (require("./settlement-cache").SettlementCache)();
    else store.settlementCache = null;
    store.events = message.context.events ? new EventManager({ now: store.now }) : undefined;
    if (store.events) store.events.data = message.context.events;
    store.eventRankingReady = () => message.context.rankingReady;
    const clanQuestSettlement = new Map(message.context.clanQuestSettlement);
    store.clanQuestSettlementReady = at => clanQuestSettlement.get(at) === true;
    let result;
    const pool=base.clanQuests ? clanShards : shards;
    if (!pool || (store.clanDailyQuests && !base.clanQuests))
      result = store.prepareArenaBatches(message.batches, message.budgetMs);
    else if (workerData.batched && !base.clanQuests) {
      result = await pool.prepare(store, message.batches);
      if (!result) throw Error("Batched progress pipeline failed");
    } else {
      const start = performance.now(), changes = [];
      for (const batch of message.batches) {
        // Preserve every original timestamp and every intermediate global
        // settlement. Calendar boundaries return to the authoritative owner.
        if (changes.length && (performance.now() - start >= message.budgetMs || store.competitionDue(store.data,batch.at))) break;
        currentTime = batch.at;
        const step = await pool.prepare(store,[batch]);
        if (!step) throw Error("Progress pipeline failed");
        store.data = step.snapshot;
        changes.push(step.changes[0]);
      }
      result = {snapshot:store.data,changes};
    }
    prepared = { id: message.id, snapshot: result.snapshot };
    parentPort.postMessage({ id: message.id, patch: difference(result.snapshot, base),
      changed: result.snapshot !== base, changes: result.changes, computeMs: performance.now() - started,
      competitionCaptured: competition.isCaptured(result.snapshot),
      ...(pool ? {shards:pool.stats} : {}) });
  } catch (error) {
    // Fail closed; do not send profile values or credentials in an error.
    parentPort.postMessage({ id: message.id, failed: true });
  }
});
