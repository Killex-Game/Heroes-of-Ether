"use strict";
// Experimental resident owner boundary; not wired into live game-server.
// The owner must buffer ALL arena mutations while this gate is pending. It
// must not publish snapshots, casts, rewards or input ACKs from simulate().
// Durable profile reservation/receiver fencing are separate prerequisites.
const { RoomOutbox } = require("./room-outbox");

class RoomFrameGate {
  constructor(outbox, { onFault = () => {}, maxApplied = 100000 } = {}) {
    if (!(outbox instanceof RoomOutbox) || outbox.blocked || outbox.sequence !== 0 ||
        outbox.ackSequence !== 0 || !Number.isSafeInteger(maxApplied) || maxApplied < 1 || maxApplied > 1000000)
      throw Error("Room frame gate requires a fresh, exclusively owned epoch");
    this.outbox = outbox;
    this.onFault = onFault;
    this.maxApplied = maxApplied;
    this.applied = new Set();
    this.pending = false;
    this.fault = null;
    this.lastAt = 0;
  }
  get blocked() { return this.pending || !!this.fault || this.outbox.blocked; }
  fail(error) {
    this.fault = error;
    // Failure after private mutation is terminal, including publication errors.
    // A recovery owner replays the journal; it never resumes this arena image.
    try { this.onFault(error); } catch { /* Preserve the original owner fault. */ }
  }
  async advance({ at, kind = "tick", boundaryAt }, simulate, publish) {
    if (this.blocked) throw Error("Room frame gate cannot advance");
    if (!Number.isSafeInteger(at) || at < this.lastAt || !["tick", "boundary", "end"].includes(kind) ||
        typeof simulate !== "function" || typeof publish !== "function")
      throw Error("Invalid room frame request");
    this.pending = true;
    try {
      const result = simulate();
      if (!result || typeof result.then === "function" || !Array.isArray(result.progress) || !Array.isArray(result.applied))
        throw Error("Room simulation must return synchronous private events");
      if (result.cancelled !== undefined && !Array.isArray(result.cancelled)) throw Error('Invalid private cancellation list');
      const resolved=[...result.applied,...(result.cancelled || [])];
      if (this.applied.size + resolved.length > this.maxApplied)
        throw Error("Room applied transaction capacity reached");
      for (const cast of resolved) if (this.applied.has(cast?.txId))
        throw Error("Room transaction was already applied in this epoch");
      const entry = await this.outbox.append({ at, kind, boundaryAt, progress: result.progress, applied: result.applied,
        cancelled:result.cancelled || [] }, committed => {
        this.lastAt = at;
        for (const cast of [...committed.frame.applied,...(committed.frame.cancelled || [])]) this.applied.add(cast.txId);
        // Build/send the presentation here, after fsync, while all subsequent
        // inputs and ticks are still gated. The outbox rejects async publishing.
        return publish(committed);
      });
      return entry;
    } catch (error) {
      this.fail(error);
      throw error;
    } finally { this.pending = false; }
  }
}

module.exports = { RoomFrameGate };
