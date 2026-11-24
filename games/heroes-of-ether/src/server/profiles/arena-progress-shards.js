"use strict";
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { difference } = require("./profile-journal");
const { applyTransfer } = require("./profile-transfer");
const tableDeltas = require("./immutable-table-delta");
const { profileKeys } = require("./profile-index");
const optionKeys = ["petEvents", "baseRouletteConfig", "promotionConfig", "unlockLeagueBackgrounds",
  "unlockLeagueFrames", "unlockClanCrests"];
const context = store => ({ options: Object.fromEntries(optionKeys.map(k => [k, store[k]])),
  events: store.events?.data, rankingReady: store.eventRankingReady?.() !== false });
const sameContext = (store, ctx) => store.events?.data === ctx.events &&
  (store.eventRankingReady?.() !== false) === ctx.rankingReady && optionKeys.every(k => store[k] === ctx.options[k]);
function laneFor(id, count) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % count;
}
class ArenaProgressShards {
  constructor({ count = 3, timeoutMs = 10000 } = {}) {
    if (!Number.isInteger(count) || count < 1 || count > 8) throw Error("Invalid progress shard count");
    this.count = count; this.timeoutMs = timeoutMs; this.sequence = 0; this.lanes = [];
    this.stats = { jobs: 0, conflicts: 0, failures: 0, computeMs: 0, transferMs: 0, roundTripMs: 0 };
  }
  lane(index) {
    if (this.lanes[index]) return this.lanes[index];
    const worker = new Worker(path.join(__dirname, "arena-progress-shard-worker.js"));
    const lane = { worker, base: { profiles: {}, clans: {} } };
    this.lanes[index] = lane;
    worker.on("message", m => {
      if (!lane.pending || m.id !== lane.pending.id) return;
      const { resolve, reject, timer } = lane.pending;
      clearTimeout(timer); lane.pending = null; worker.unref();
      if (m.failed) reject(Error("Profile shard failed"));
      else {
        try {
          let predicted = lane.base;
          for (const step of m.steps || [m]) {
            step.before = predicted;
            predicted = applyTransfer(predicted, step.patch);
            if (step.clanXp.length) {
              predicted.clans = { ...predicted.clans };
              for (const [id, earned] of step.clanXp)
                predicted.clans[id] = { ...predicted.clans[id], xp: predicted.clans[id].xp + earned };
            }
            step.predicted = predicted;
          }
          lane.prediction = { id: m.id, world: predicted };
          // This reference stays inside the owning process. Reuse its immutable
          // rows when publishing a checked result instead of applying the same
          // patch twice and losing identity with the next worker baseline.
          m.predicted = predicted;
          resolve(m);
        } catch (error) { reject(error); }
      }
    });
    worker.on("error", () => this.fail("worker-error"));
    worker.on("exit", () => { if (!this.closed && !this.failed) this.fail("worker-exit"); });
    worker.unref();
    return lane;
  }
  submit(index, input, batch, ctx) {
    const lane = this.lane(index), id = ++this.sequence;
    if (lane.pending) throw Error("Concurrent profile shard job");
    const prior = lane.prediction?.world || lane.base;
    // Keep idle identities resident. Alternating small samples must not remove
    // and resend their complete inventories/history on the next sample.
    const world = { profiles: { ...prior.profiles, ...input.profiles }, clans: { ...prior.clans, ...input.clans } };
    if (Object.hasOwn(input, 'clanQuests')) world.clanQuests = input.clanQuests;
    if (input.competition) world.competition = input.competition;
    tableDeltas.remember(world.profiles,prior.profiles,Object.keys(input.profiles));
    tableDeltas.remember(world.clans,prior.clans,Object.keys(input.clans));
    const patch = difference(world, prior);
    const adopt = lane.prediction?.id ?? null;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail("timeout"); }, this.timeoutMs);
      lane.pending = { id, resolve, reject, timer };
    });
    lane.worker.ref();
    try { lane.worker.postMessage({ id, adopt, patch,
      ...(Array.isArray(batch) ? { batches: batch } : { batch }), context: ctx }); }
    catch { this.fail("send"); }
    lane.base = world;
    return result;
  }
  async prepare(store, batches) {
    if (this.failed || this.closed) return undefined;
    // Returning undefined selects the caller's canonical progress path. These
    // partial inputs cannot represent shared daily quest boards or settlement.
    if (store.data.clanQuests || store.clanDailyQuests) return undefined;
    if (this.pending) throw Error("Concurrent arena progress preparation");
    this.pending = true;
    const base = store.data, ctx = context(store), started = performance.now(), batch = batches[0];
    try {
      if (base.progressReceipt === batch.id) return { snapshot: base, changes: [[]] };
      const keys = profileKeys(base.profiles);
      const groups = Array.from({length: this.count}, () => ({ profiles: {}, clans: {}, progress: [] }));
      const order = new Set();
      for (const event of batch.progress) {
        const key = keys.get(event.profileId);
        if (!key) continue;
        order.add(event.profileId);
        const p = base.profiles[key], group = groups[laneFor(p.id, this.count)];
        group.profiles[key] = p; group.progress.push(event);
        if (p.clanId && base.clans[p.clanId])
          group.clans[p.clanId] = { xp: base.clans[p.clanId].xp };
      }
      const jobs = groups.flatMap((group, index) => group.progress.length ? [this.submit(index,
        { profiles: group.profiles, clans: group.clans },
        { id: batch.id, at: batch.at, progress: group.progress }, ctx)] : []);
      this.stats.jobs++;
      this.stats.transferMs += performance.now() - started;
      const results = await Promise.all(jobs);
      this.stats.roundTripMs += performance.now() - started;
      if (store.data !== base || !sameContext(store, ctx)) {
        this.stats.conflicts++; return null;
      }
      const mergeAt = performance.now(), changed = new Set(), clanXp = new Map();
      const combined = { set: {}, remove: [], tables: { profiles: { set: {}, remove: [] }, profileEdits: {} } };
      const assigned = new Set();
      for (const result of results) {
        this.stats.computeMs += result.computeMs;
        for (const id of result.ids) changed.add(id);
        // Patches contain only disjoint profile keys; clans are additive and
        // checked separately, never last-writer-wins on a shared clan balance.
        if (result.ids.length) {
          const patch = result.patch;
          if (Object.keys(patch.set).length || patch.remove.length ||
              Object.keys(patch.tables || {}).some(key => !["profiles", "profileEdits"].includes(key)))
            throw Error("Invalid shard result scope");
          for (const key of [...Object.keys(patch.tables.profiles?.set || {}),
            ...Object.keys(patch.tables.profileEdits || {}), ...(patch.tables.profiles?.remove || [])]) {
            if (assigned.has(key)) throw Error("Overlapping shard profiles");
            assigned.add(key);
          }
          Object.assign(combined.tables.profiles.set, patch.tables.profiles?.set);
          combined.tables.profiles.remove.push(...(patch.tables.profiles?.remove || []));
          Object.assign(combined.tables.profileEdits, patch.tables.profileEdits);
        }
        for (const [id, amount] of result.clanXp) {
          if (!base.clans[id] || !Number.isSafeInteger(amount) || amount < 0) throw Error("Invalid clan XP delta");
          clanXp.set(id, (clanXp.get(id) || 0) + amount);
        }
      }
      if (!changed.size) return { snapshot: base, changes: [[]] };
      let next = { ...applyTransfer(base, combined), progressReceipt: batch.id };
      if (clanXp.size) {
        next.clans = { ...base.clans };
        for (const [id, earned] of clanXp) {
          const xp = base.clans[id].xp + earned;
          if (!Number.isSafeInteger(xp)) throw Error("Clan XP overflow");
          next.clans[id] = { ...base.clans[id], xp };
        }
      }
      // Exactly one global settlement, at the original FIFO timestamp.
      const snapshot = store.prepareSnapshot(next, batch.at, undefined, base);
      this.stats.transferMs += performance.now() - mergeAt;
      return { snapshot, changes: [[...order].filter(id => changed.has(id))] };
    } catch {
      this.fail("calculation"); return undefined;
    } finally { this.pending = false; }
  }
  fail(reason) {
    if (this.failed || this.closed) return;
    this.failed = true; this.stats.failures++; this.stats.failureReason = reason;
    for (const lane of this.lanes.filter(Boolean)) {
      if (lane.pending) {
        clearTimeout(lane.pending.timer); lane.pending.reject(Error("Profile shard unavailable")); lane.pending = null;
      }
      lane.stopped = lane.worker.terminate();
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const lane of this.lanes.filter(Boolean)) {
      if (lane.pending) {
        clearTimeout(lane.pending.timer); lane.pending.reject(Error("Profile shard closed")); lane.pending = null;
      }
      lane.stopped ||= lane.worker.terminate();
    }
    await Promise.all(this.lanes.filter(Boolean).map(lane => lane.stopped));
  }
}
module.exports = { ArenaProgressShards, laneFor };
