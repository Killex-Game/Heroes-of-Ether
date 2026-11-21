"use strict";
// Experimental room IPC integration. The parent is the only profile writer.
// Child claims are trusted only after binding an epoch to that exact process.
// Authentication/admission are intentionally NOT supplied by this benchmark.
const { randomUUID } = require("node:crypto");
const { ArenaBoosterQueue } = require("../../../src/server/profiles/arena-booster-queue");
const { BOOSTERS, BoosterError } = require("../../../src/server/boosters/booster-catalog");
const accounts = require("../../../src/server/accounts/account-benefits");
const loadout = require("../../../public/shared/quick-slot-rules");
const { roomProfile } = require('./room-profile.cjs');

class DurableCasts {
  constructor(store, sink, tokens, { lateValidation = process.env.ROOM_BENCH_LATE_CASTS === "1" } = {}) {
    this.store = store; this.sink = sink; this.tokens = tokens; this.owners = new Map(); this.pending = new Map();
    this.lateValidation = lateValidation;
    this.commandReplies = new Map();
    this.auditByProfile = new Map();
    const maxBatchSize = Number(process.env.ROOM_BENCH_CAST_BATCH || 256);
    if (![16,32,64,128,256,512].includes(maxBatchSize)) throw Error('Invalid benchmark cast batch');
    this.queue = new ArenaBoosterQueue(store, { maxBatchSize: Math.min(256, maxBatchSize), fairRetries: true,
      retryBatchSize: Math.min(256, maxBatchSize), retryEvery: 2 });
    // Diagnostic policy only. Do not widen the production constructor's bound
    // until an identical workload proves that larger groups reduce action lag.
    this.queue.maxBatchSize = this.queue.retryBatchSize = maxBatchSize;
    sink.isPaused = () => this.queue.staging;
    this.queue.onProgressIdle = () => sink.flushPromise;
    this.queue.onProgressTurn = () => sink.barrier();
    this.metrics = { submitted: 0, completed: 0, replays: 0, rejected: 0, failures: 0, validations: 0, latency: [] };
  }
  claim(child, config) {
    const registered = this.sink.owners.get(config.id);
    if (this.owners.has(config.id) || !registered || registered.epoch !== config.epoch ||
        (registered.channel && registered.channel !== child) ||
        !Array.isArray(config.profiles) || config.profiles.length !== registered.profiles.size ||
        new Set(config.profiles.map(p => p.id)).size !== config.profiles.length ||
        config.profiles.some(p => !registered.profiles.has(p.id))) throw Error('Invalid cast owner claim');
    for (const p of config.profiles) this.auditByProfile.set(p.id,
      require("../load-ack-audit.cjs").createAckAudit(this.tokens.get(p.id)));
    this.owners.set(config.id, { child, epoch: config.epoch, profiles: new Set(config.profiles.map(p => p.id)),
      players: new Map(config.profiles.map((p, i) => [`room-${config.id}-player-${i}`, p.id])) });
  }
  reply(child, message) { if (child.connected) child.send(message); }
  receive(child, message) {
    if (message.type === "castValidation") {
      const pending = this.pending.get(message.validationId);
      if (!pending || pending.child !== child || pending.roomId !== message.roomId ||
          pending.epoch !== message.epoch || pending.requestId !== message.requestId) return;
      clearTimeout(pending.timer); this.pending.delete(message.validationId);
      pending.resolve(message); return;
    }
    if (message.type === "castReceived") {
      const owner = this.owners.get(message.roomId);
      if (owner?.child !== child || owner.epoch !== message.epoch) return;
      const key = JSON.stringify([message.roomId, message.epoch, message.playerId, message.requestId]);
      if (this.commandReplies.get(key)?.result) this.commandReplies.delete(key);
      return;
    }
    if (message.type !== "castRequest") return;
    const owner = this.owners.get(message.roomId);
    if (!owner || owner.child !== child || owner.epoch !== message.epoch ||
        owner.players.get(message.playerId) !== message.profileId)
      throw Error("Unowned room cast");
    const commandKey = JSON.stringify([message.roomId, message.epoch, message.playerId, message.command.requestId]);
    const signature = JSON.stringify([message.profileId, message.lifeId, message.command]);
    const pending = this.commandReplies.get(commandKey);
    if (pending) {
      if (pending.signature !== signature) throw Error("Conflicting pending cast replay");
      if (pending.result) this.reply(child, pending.result);
      return;
    }
    const commandReply = { signature, result: null };
    this.commandReplies.set(commandKey, commandReply);
    const started = performance.now(), input = message.command, store = this.store;
    const earlyReservation = !this.lateValidation || BOOSTERS.get(input.boosterId)?.kind === "mass";
    let predicted = message.predictedMass, terminal, validationId;
    const token = this.tokens.get(message.profileId);
    this.metrics.submitted++;
    const envelope = { roomId: message.roomId, epoch: owner.epoch, requestId: input.requestId, playerId: message.playerId, lifeId: message.lifeId };
    const send = (type, data) => {
      const reply = { type, ...envelope, ...data };
      if (type === "castCommit" || type === "castRejected") commandReply.result = reply;
      this.reply(child, reply);
    };
    const release = () => {
      if (validationId) send("castAbort", { validationId });
      validationId = null;
    };
    const reserve = async () => {
      if (terminal || !child.connected) return;
      validationId = randomUUID(); this.metrics.validations++;
      const response = await new Promise((resolve, reject) => {
        const id = validationId;
        const timer = setTimeout(() => { this.pending.delete(id); reject(Error("Room validation timed out")); }, 5000);
        this.pending.set(id, { child, timer, resolve, roomId: message.roomId,
          epoch: message.epoch, requestId: input.requestId });
        send("castValidate", { validationId: id, playerId: message.playerId, command: input });
      });
      if (response.error || response.valid !== true) terminal = response.error || "Room validation failed";
      else if (earlyReservation) predicted = response.predictedMass;
    };
    this.queue.use({
      owner: message.profileId,
      target: BOOSTERS.get(input.boosterId)?.target === "opponent" ? owner.players.get(input.targetId) : null,
      reserve: earlyReservation ? reserve : undefined, release,
      prepare: batch => {
        let recordedPeak;
        const validateProfile = () => {
          if (!child.connected || terminal) throw new BoosterError(terminal || "Room disconnected", 409);
          const profile = store.byId(message.profileId), benefits = accounts.benefits(profile, store.now());
          if (profile.progress.session?.id !== message.lifeId) throw new BoosterError("Life not committed", 409);
          if (!profile.quickSlots?.some((id, index) => id === input.boosterId && loadout.unlocked(index, benefits, profile.level)))
            throw new BoosterError("Booster not equipped", 409);
          if (!Number.isFinite(predicted) || predicted < 0) throw Error("Invalid room mass prediction");
          return profile;
        };
        const result = store.consume(token, input.boosterId, input.requestId,
          JSON.stringify(["resident-cast", owner.epoch, message.playerId, input]), () => {
            const profile = validateProfile(); recordedPeak = Math.max(profile.progress.maxMass, predicted);
            return { mass: predicted };
          }, true, batch);
        return {
          valid: !result.replay && (earlyReservation ? (() => {
            validateProfile();
            return !!validationId && Math.max(store.byId(message.profileId).progress.maxMass, predicted) === recordedPeak;
          }) : (async () => {
            await reserve();
            if (terminal) return false;
            validateProfile();
            return !!validationId && Math.max(store.byId(message.profileId).progress.maxMass, predicted) === recordedPeak;
          })),
          abort: release,
          finish: () => {
            send("castCommit", { validationId, replay: !!result.replay, profile: roomProfile(store.byId(message.profileId)) });
            validationId = null;
            this.metrics[result.replay ? "replays" : "completed"]++;
            if (!result.replay) this.auditByProfile.get(message.profileId)?.(input.requestId, "booster:" + input.boosterId);
            this.metrics.latency.push(performance.now() - started);
          },
        };
      },
      fail: error => {
        if (validationId) send("castAbort", { validationId });
        this.metrics[error instanceof BoosterError ? "rejected" : "failures"]++;
        send("castRejected", { message: error.message });
      },
    });
  }
}
module.exports = { DurableCasts };
