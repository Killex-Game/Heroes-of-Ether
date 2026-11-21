"use strict";
// Experimental two-phase cast boundary. No disk work runs in this process.
const { BOOSTERS, BoosterError } = require("../../../src/server/boosters/booster-catalog");
const { massLimitForLevel } = require("../../../src/server/arena/arena-simulation");
const pets = require("../../../src/server/pets/arena-pets");
const gifts = require("../../../src/server/profiles/gift-effects");
class RoomCasts {
  constructor(room, send) {
    this.room = room; this.send = send; this.requests = new Map(); this.locks = new Map();
    this.metrics = { submitted: 0, applied: 0, rejected: 0, replays: 0, lockPauses: 0, maxPending: 0 };
    this.lockDurations = [];
    this.completed = new Map();
    this.ackLatencies = []; this.applyLatencies = [];
  }
  get locked() { return this.locks.size > 0; }
  release(id) {
    const lock=this.locks.get(id);
    if (lock) this.lockDurations.push(performance.now()-lock.startedAt);
    this.locks.delete(id);
  }
  prepare(playerId, command) {
    const arena = this.room.arena, p = arena.players.get(playerId);
    const apply = arena.prepareBooster(playerId, command, performance.now());
    const booster = BOOSTERS.get(command.boosterId);
    const gain = booster.kind === "mass" ? Math.max(0, Math.min(
      Math.floor(booster.amount * pets.positiveFactor(p) * gifts.arena(p, "outgoing")),
      massLimitForLevel(p.level) - arena.mainBody(p).mass)) : 0;
    return { apply, predictedMass: p.mass + gain };
  }
  request(p, command) {
    if (this.requests.has(command.requestId)) throw Error("Duplicate fixture request");
    const prepared = this.prepare(p.id, command);
    for (const [id, done] of this.completed)
      if (done.playerId === p.id && done.lifeId !== p.lifeId) this.completed.delete(id);
    const startedAt = performance.now();
    const intent = { type: "castRequest", roomId: this.room.id, epoch: this.room.epoch,
      playerId: p.id, profileId: p.profileId, lifeId: p.lifeId, command: structuredClone(command),
      predictedMass: prepared.predictedMass };
    this.requests.set(command.requestId, { playerId: p.id, command: intent.command, lifeId: p.lifeId,
      intent, startedAt, retryAt: startedAt + 500, retryDelay: 500 });
    this.metrics.submitted++; this.metrics.maxPending = Math.max(this.metrics.maxPending, this.requests.size);
    this.send(intent);
  }
  retryPending(at = performance.now()) {
    // A timeout has an unknown outcome. Keep the original ID, payload and
    // reservation; never create a second debit or activate an unconfirmed cast.
    for (const request of this.requests.values()) if (at >= request.retryAt) {
      this.send(request.intent);
      request.retryDelay = Math.min(4000, request.retryDelay * 2);
      request.retryAt = at + request.retryDelay;
    }
  }
  acknowledge(m) {
    this.send({ type: "castReceived", roomId: this.room.id, epoch: this.room.epoch,
      requestId: m.requestId, playerId: m.playerId || this.requests.get(m.requestId)?.playerId });
  }
  receive(m) {
    if (m.epoch !== this.room.epoch) return;
    const request = this.requests.get(m.requestId);
    if (m.type === "castAbort") { this.release(m.validationId); return; }
    if (m.type === "castRejected") {
      this.acknowledge(m);
      if (request) { this.metrics.rejected++; this.room.socketInputs?.result(request.playerId,m.requestId,false,m.message); }
      this.requests.delete(m.requestId); return;
    }
    if (m.type === "castValidate") {
      let response;
      try {
        if (!request || request.playerId !== m.playerId ||
            this.room.arena.players.get(m.playerId)?.lifeId !== request.lifeId)
          throw new BoosterError("Life ended before cast", 409);
        const prepared = this.prepare(m.playerId, request.command);
        this.locks.set(m.validationId, { requestId: m.requestId, startedAt:performance.now(), ...prepared });
        response = { valid: true, predictedMass: prepared.predictedMass };
      } catch (error) { response = { valid: false, error: error.message }; }
      this.send({ type: "castValidation", roomId: this.room.id, epoch: this.room.epoch,
        requestId: m.requestId, validationId: m.validationId, ...response });
      return;
    }
    if (m.type === "castCommit") {
      const done = this.completed.has(m.requestId);
      const lock = this.locks.get(m.validationId);
      if (done || (m.replay && !request)) this.metrics.replays++;
      else {
        if (!request || !lock || lock.requestId !== m.requestId)
          throw Error("Commit without room reservation");
        if (this.room.arena.players.get(request.playerId)?.lifeId !== request.lifeId)
          throw Error("Committed cast belongs to a departed life");
        this.ackLatencies.push(performance.now() - request.startedAt);
        lock.apply(); this.metrics.applied++;
        this.applyLatencies.push(performance.now() - request.startedAt);
        this.completed.set(m.requestId, { playerId: request.playerId, lifeId: request.lifeId });
        if (process.env.ROOM_BENCH_APPLIED_DIR) {
          const fs = require("node:fs"), path = require("node:path");
          fs.mkdirSync(process.env.ROOM_BENCH_APPLIED_DIR, { recursive: true });
          fs.appendFileSync(path.join(process.env.ROOM_BENCH_APPLIED_DIR, process.pid + ".ndjson"),
            JSON.stringify({ profileId: request.intent.profileId, requestId: m.requestId, boosterId: request.command.boosterId }) + "\n");
        }
        const kind = request.command.boosterId;
        this.room.metrics.boosters[kind] = (this.room.metrics.boosters[kind] || 0) + 1;
      }
      if (m.profile && !done) {
        const previous = this.room.lookup.get(m.profile.id);
        if (!Number.isSafeInteger(previous?.revision) || m.profile.revision >= previous.revision)
          this.room.lookup.set(m.profile.id, m.profile);
      }
      // A retried owner can validate the same operation again. Both aliases
      // protect the same cast and must be released after its single application.
      for (const [id, reservation] of this.locks)
        if (reservation.requestId === m.requestId) this.release(id);
      if (request) this.room.socketInputs?.result(request.playerId,m.requestId,true);
      this.acknowledge(m);
      this.requests.delete(m.requestId);
    }
  }
}
module.exports = { RoomCasts };
