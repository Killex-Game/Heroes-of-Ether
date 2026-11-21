"use strict";
const { BoosterError } = require("../boosters/booster-catalog");
const { loginRewardDay } = require("../accounts/account-benefits");
const { createProfileBatch, sealProfileBatch } = require("./profile-batch");

// Only independent casts may share a commit. A second cast by (or aimed at)
// the same player must see the first one's effect, cooldown and remaining stock.
class ArenaBoosterQueue {
  constructor(profiles, { maxBatchSize = 32, maxPending = 1024, fairRetries = false, retryBatchSize = 1, retryEvery = 4 } = {}) {
    if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 256)
      throw new RangeError("Invalid arena booster batch size");
    this.profiles = profiles;
    this.maxBatchSize = maxBatchSize;
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 65536)
      throw new RangeError("Invalid pending operation limit");
    this.maxPending = maxPending;
    this.pending = 0;
    this.overloadRejections = 0;
    this.fairRetries = fairRetries;
    if (!Number.isInteger(retryBatchSize) || retryBatchSize < 1 || retryBatchSize > maxBatchSize ||
        !Number.isInteger(retryEvery) || retryEvery < 1 || retryEvery > 4) throw new RangeError('Invalid retry policy');
    this.retryBatchSize = retryBatchSize;
    this.retryEvery = retryEvery;
    this.deferred = new WeakSet();
    this.selectionTurn = 0;
    this.waiting = [];
    this.counts = new Map();
    this.restages = { profile: 0, date: 0, validity: 0, journal: 0 };
  }
  use(command) {
    if (!this.profiles.journal) {
      try {
        command.prepare().finish();
      } catch (error) {
        command.fail(error);
      }
      return;
    }
    const count = this.counts.get(command.owner) || 0;
    // Include the group currently waiting for durability, not only waiting[].
    // Admission happens before prepare/reserve: rejected operations have no
    // debit, effect or receipt, and may safely retry with their original ID.
    if (this.pending >= this.maxPending) {
      this.overloadRejections++;
      command.fail(new BoosterError("Сервер занят. Попробуй действие чуть позже.", 429));
      return;
    }
    if (count >= 8) {
      command.fail(new BoosterError("Предыдущие бустеры ещё применяются.", 429));
      return;
    }
    this.counts.set(command.owner, count + 1);
    this.pending++;
    this.waiting.push(command);
    if (!this.running)
      this.running = new Promise((done) => setImmediate(done)).then(() => this.drain());
  }
  takeBatch() {
    if (this.fairRetries && this.waiting.some(command => this.deferred.has(command))) {
      // A stale instant-food prediction must not hold other owners hostage.
      // Reserve every skipped owner's/target's place, so later conflicting
      // commands still cannot overtake it. One retry gets a turn at least
      // every fourth batch, even under a continuous independent input stream.
      const retryFirst = ++this.selectionTurn % this.retryEvery === 0;
      for (const retry of retryFirst ? [true, false] : [false, true]) {
        const occupied = new Set(), selected = new Set();
        for (const [index, command] of this.waiting.entries()) {
          const conflict = occupied.has(command.owner) || occupied.has(command.target);
          occupied.add(command.owner);
          if (command.target) occupied.add(command.target);
          if (!conflict && this.deferred.has(command) === retry &&
              selected.size < (retry ? this.retryBatchSize : this.maxBatchSize)) selected.add(index);
        }
        if (selected.size) {
          const batch = [...selected].map(index => this.waiting[index]);
          this.waiting = this.waiting.filter((_, index) => !selected.has(index));
          return batch;
        }
      }
    }
    const occupied = new Set(),
      batch = [];
    this.waiting = this.waiting.filter((command) => {
      if (batch.length >= this.maxBatchSize) return true;
      const conflict = occupied.has(command.owner) || occupied.has(command.target);
      occupied.add(command.owner);
      if (command.target) occupied.add(command.target);
      if (!conflict) batch.push(command);
      return conflict;
    });
    return batch;
  }
  prepare(commands) {
    const profiles = this.profiles;
    profiles.refreshCompetition();
    const base = profiles.data;
    const batch = createProfileBatch(base);
    const results = commands.map((command) => {
      try {
        return command.prepare(batch);
      } catch (error) {
        return { finish: () => command.fail(error) };
      }
    });
    sealProfileBatch(batch);
    const next = batch.next === base ? base : profiles.prepareSnapshot(batch.next);
    return { base, next, results };
  }
  async waitForProgress() {
    const pending = this.onProgressIdle?.();
    if (pending) await pending;
    if (this.profiles.journal.arenaFlush) await this.profiles.journal.arenaFlush;
  }
  async retryIndependent(commands, validity) {
    // Do not mix the known-valid part of a rejected draft with fresh arrivals.
    // Otherwise a steady stream of stale casts can invalidate every large
    // group again before any unaffected player gets a durable response.
    const stable = validity ? commands.filter((_, i) => validity[i]) : [];
    const changed = validity ? commands.filter((_, i) => !validity[i]) : commands;
    for (const command of changed) this.deferred.add(command);
    for (const command of stable) this.deferred.delete(command);
    if (!stable.length || !changed.length) return commands;
    let retry;
    try { retry = (await this.commit(stable, true)) || []; }
    catch (error) { for (const command of stable) command.fail(error); retry = []; }
    const pending = new Set([...changed, ...retry]);
    return commands.filter(command => pending.has(command));
  }
  async commit(commands, yieldOnRetry = false) {
    if (commands.some(command => command.reserve)) return this.commitReserved(commands, yieldOnRetry);
    const store = this.profiles;
    let plan;
    for (;;) {
      // Checkpoints read a fixed set of older sealed files. New durable booster
      // segments can be published concurrently without waiting for that work.
      plan = this.prepare(commands);
      if (plan.next === plan.base) break;
      const day = loginRewardDay(store.now());
      const staged = await store.journal.stage(plan.next);
      let published = false,
        validity;
      try {
        if (plan.base !== store.data) this.restages.profile++;
        else if (day !== loginRewardDay(store.now())) this.restages.date++;
        else {
          validity = plan.results.map((item) => {
            try { return !item.valid || item.valid(); }
            catch (error) { return Promise.reject(error); }
          });
          // Resident room owners can validate over IPC. They hold their short
          // commit boundary until finish/abort, never while the disk is staged.
          // The normal in-process path remains synchronous here.
          if (validity.some(value => value && typeof value.then === "function")) {
            // Drain every reply before releasing reservations, including when
            // one room fails. Otherwise a late successful reply can leave a
            // reservation behind after the batch has already been aborted.
            const replies = await Promise.allSettled(validity);
            const failed = replies.find(reply => reply.status === "rejected");
            if (failed) throw failed.reason;
            validity = replies.map(reply => reply.value);
          }
          // Another writer/calendar change can win while an IPC reply travels.
          if (plan.base !== store.data) this.restages.profile++;
          else if (day !== loginRewardDay(store.now())) this.restages.date++;
          else if (validity.includes(false)) this.restages.validity++;
          else if (!(published = store.writeSnapshot(plan.next, staged))) this.restages.journal++;
        }
      } finally {
        if (!published) for (const result of plan.results) result.abort?.();
      }
      if (published) break;
      if (this.fairRetries && yieldOnRetry) {
        // This entire draft is unpublished. The drain retains counts and
        // original conflict order, then gives independent owners a chance.
        return this.retryIndependent(commands, validity);
      }
      // A purchase, life transition or calendar change invalidated the draft.
      // Never fall back to fsyncSync in the arena thread: stage the rebuilt
      // group again, keeping stock/receipt/effect unpublished until durable.
      // A moving/feed/split target can invalidate several drafts in a row.
      // Release progress between retries too, not only after a successful cast.
      // Otherwise the stale peak used by validation can hold every room's WAL.
      this.staging = false;
      try {
        await this.onProgressTurn?.();
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        this.staging = true;
      }
      await this.waitForProgress();
      if (validity?.includes(false) && commands.length > 1) {
        // Independent owners may share a write, but one continually changing
        // instant-mass prediction must not starve every other owner's command.
        // Nothing from the rejected draft was published. Restage the stable
        // subset first, then the invalid subset, preserving conflicts/order.
        const stable = commands.filter((_, i) => validity[i]);
        const changed = commands.filter((_, i) => !validity[i]);
        const groups = stable.length
          ? [stable, changed]
          : [
              commands.slice(0, Math.ceil(commands.length / 2)),
              commands.slice(Math.ceil(commands.length / 2)),
            ];
        for (const group of groups) {
          try {
            await this.commit(group);
          } catch (error) {
            for (const command of group) command.fail(error);
          }
        }
        return;
      }
    }
    for (const [index, result] of plan.results.entries()) {
      try {
        result.finish();
      } catch (error) {
        // A failed response on one socket must not skip the other paid casts.
        commands[index].fail(error);
      }
    }
  }
  async commitReserved(commands, yieldOnRetry = false) {
    // Optional resident-owner protocol. Reserve the exact room state before
    // constructing a durable draft, so instant food does not repeatedly chase
    // a moving mass prediction. Ordinary in-process commands never enter here.
    const store = this.profiles;
    for (;;) {
      let plan, validity, published = false;
      try {
        const reservations = await Promise.allSettled(commands.map(command => command.reserve?.()));
        const failure = reservations.find(result => result.status === "rejected");
        if (failure) throw failure.reason;
        plan = this.prepare(commands);
        if (plan.next === plan.base) published = true;
        else {
          const day = loginRewardDay(store.now());
          const staged = await store.journal.stage(plan.next);
          if (plan.base !== store.data) this.restages.profile++;
          else if (day !== loginRewardDay(store.now())) this.restages.date++;
          else {
            // A mixed resident batch reserves instant mass before staging;
            // other casts can validate and briefly reserve only afterwards.
            // Drain all replies before releasing any reservation. A writer
            // or calendar boundary may change while IPC is in flight.
            const checks = plan.results.map(result => {
              try { return !result.valid || result.valid(); }
              catch (error) { return Promise.reject(error); }
            });
            validity = checks;
            if (checks.some(value => value && typeof value.then === "function")) {
              const replies = await Promise.allSettled(checks);
              const failed = replies.find(reply => reply.status === "rejected");
              if (failed) throw failed.reason;
              validity = replies.map(reply => reply.value);
            }
            if (plan.base !== store.data) this.restages.profile++;
            else if (day !== loginRewardDay(store.now())) this.restages.date++;
            else if (validity.includes(false)) this.restages.validity++;
            else if (!(published = store.writeSnapshot(plan.next, staged))) this.restages.journal++;
          }
        }
        if (published) {
          for (const [index, result] of plan.results.entries()) {
            try { result.finish(); } catch (error) { commands[index].fail(error); }
          }
          return;
        }
      } finally {
        if (!published) for (const result of plan?.results || []) result.abort?.();
        for (const command of commands) command.release?.();
      }
      if (this.fairRetries && yieldOnRetry) {
        return this.retryIndependent(commands, validity);
      }
      this.staging = false;
      try { await this.onProgressTurn?.(); await new Promise(resolve => setImmediate(resolve)); }
      finally { this.staging = true; }
      await this.waitForProgress();
    }
  }
  async drain() {
    while (this.waiting.length) {
      const batch = this.takeBatch();
      let retry = [];
      try {
        this.staging = true;
        await this.waitForProgress();
        retry = (await this.commit(batch, true)) || [];
      } catch (error) {
        for (const command of batch) command.fail(error);
      } finally {
        this.staging = false;
        if (retry.length) this.waiting.unshift(...retry);
        const deferred = new Set(retry);
        for (const command of batch) {
          // The original command remains queued, including its stock limit.
          // It has not failed, acknowledged or published any effect.
          if (deferred.has(command)) continue;
          this.pending--;
          this.deferred.delete(command);
          const { owner } = command;
          const left = this.counts.get(owner) - 1;
          if (left) this.counts.set(owner, left);
          else this.counts.delete(owner);
        }
        await this.onProgressTurn?.();
        // The captured progress prefix has finished. Reserve the next cast's
        // staging turn before yielding to I/O; otherwise a newer progress job
        // can start in this gap and make the same cast wait a second time.
        // No event is skipped: the next batch still waits for any active writer.
        if (this.waiting.length) this.staging = true;
        if (this.fairRetries) await new Promise(resolve => setImmediate(resolve));
      }
    }
    this.running = null;
  }
}
module.exports = { ArenaBoosterQueue };
