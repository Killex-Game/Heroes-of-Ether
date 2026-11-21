"use strict";
// Foundation for a resident room owner, not yet enabled in the game server.
// A frame must become durable BEFORE its world/effects/response are published.
// Failure ends/fences the private simulation; it must never continue after an
// unjournaled mutation. This file cannot make arbitrary caller side effects atomic.
const { createHash } = require("node:crypto");
const { ProfileJournal, recover } = require("../../profiles/profile-journal");
const { copyArenaData } = require("../../profiles/arena-profile-copy");
const { acquireServerLock } = require("../../runtime/process-lock");
const FORMAT = "arena-room-outbox-v1";
const identifier = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validSequence = value => Number.isSafeInteger(value) && value >= 0;
function validateFrame(frame, sequence, roomId, epoch) {
  if (!frame || frame.sequence !== sequence || frame.roomId !== roomId || frame.epoch !== epoch ||
      !Number.isSafeInteger(frame.at) || frame.at < 0 || !["tick", "boundary", "end"].includes(frame.kind) ||
      !Array.isArray(frame.progress) || !Array.isArray(frame.applied) ||
      (frame.cancelled !== undefined && !Array.isArray(frame.cancelled)) ||
      frame.progress.length > 10000 || frame.applied.length + (frame.cancelled?.length || 0) > 256)
    throw Error("Invalid room frame");
  if (frame.boundaryAt !== undefined && (frame.kind !== 'boundary' || !Number.isSafeInteger(frame.boundaryAt) || frame.boundaryAt <= frame.at))
    throw Error('Invalid room boundary timestamp');
  const seen = new Set();
  for (const cast of [...frame.applied,...(frame.cancelled || [])]) {
    if (!cast || !identifier(cast.txId) || !identifier(cast.profileId) || !identifier(cast.lifeId) ||
        !identifier(cast.boosterId) || seen.has(cast.txId) ||
        (cast.mass !== undefined && (!Number.isSafeInteger(cast.mass) || cast.mass < 0)))
      throw Error("Invalid applied room transaction");
    seen.add(cast.txId);
  }
}
function validateState(data, roomId, epoch) {
  if (data.format !== FORMAT || data.roomId !== roomId || data.epoch !== epoch ||
      !validSequence(data.sequence) || !validSequence(data.ackSequence) || data.ackSequence > data.sequence ||
      typeof data.ended !== "boolean" || !data.roomFrames || Array.isArray(data.roomFrames))
    throw Error("Invalid room outbox identity or sequence");
  if (Object.keys(data.roomFrames).length !== data.sequence - data.ackSequence)
    throw Error("Room outbox contains a sequence gap");
  for (let sequence = data.ackSequence + 1; sequence <= data.sequence; sequence++) {
    const entry = data.roomFrames[sequence];
    validateFrame(entry?.frame, sequence, roomId, epoch);
    if (entry.digest !== hash(entry.frame)) throw Error("Room frame checksum mismatch");
  }
}
class RoomOutbox {
  static openExisting(options) { return this.open({ ...options, recoveryOnly: true }); }
  static async open({ file, roomId, epoch, maxFrames = 256, maxFrameBytes = 2 * 1024 * 1024, recoveryOnly = false }) {
    if (!identifier(roomId) || !identifier(epoch) || !Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 4096 ||
        !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 256 || maxFrameBytes > 4 * 1024 * 1024)
      throw Error("Invalid room outbox configuration");
    const release = acquireServerLock(file + ".lock");
    let journal;
    try {
      let data = recover(file).data;
      const fresh = !Object.keys(data).length;
      // Missing bytes do not prove that a paid effect never happened. Recovery
      // must never replace a lost journal with an apparently empty new epoch.
      if (fresh && recoveryOnly) throw Error("Room recovery journal is missing");
      if (!fresh) validateState(data, roomId, epoch);
      journal = new ProfileJournal(file);
      if (fresh) {
        data = { format: FORMAT, roomId, epoch, sequence: 0, ackSequence: 0, ackDigest: null, ended: false, roomFrames: {} };
        if (!await journal.commitDelta({ set: data, remove: [], tables: {} }, () => {}))
          throw Error("Room outbox initialization was superseded");
      }
      return new RoomOutbox({ journal, release, data, maxFrames, maxFrameBytes, recoveryOnly });
    } catch (error) {
      try { await journal?.close(); } finally { release(); }
      throw error;
    }
  }
  constructor({ journal, release, data, maxFrames, maxFrameBytes, recoveryOnly }) {
    Object.assign(this, { journal, release, roomId: data.roomId, epoch: data.epoch,
      sequence: data.sequence, ackSequence: data.ackSequence, ackDigest: data.ackDigest,
      persistedAck: data.ackSequence, ended: data.ended, maxFrames, maxFrameBytes, recoveryOnly });
    this.frames = new Map(Object.values(data.roomFrames).map(entry => [entry.frame.sequence, entry]));
    this.closed = false; this.fault = null; this.pending = null;
  }
  get blocked() { return this.closed || this.recoveryOnly || !!this.fault || !!this.pending || this.ended || this.frames.size >= this.maxFrames; }
  // Stored frames have already passed through the JSON persistence boundary.
  // Their public copies need no generic structured-clone type dispatch.
  list() { return copyArenaData([...this.frames.values()]); }
  pendingSequences() { return [...this.frames.keys()]; }
  entry(sequence) {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw Error('Invalid frame sequence');
    const entry = this.frames.get(sequence);
    return entry ? copyArenaData(entry) : null;
  }
  append({ at, progress = [], applied = [], cancelled = [], kind = "tick", boundaryAt }, publish) {
    if (this.blocked) return Promise.reject(Error("Room outbox cannot advance"));
    let frame, entry;
    try {
      // Own the event values before awaiting disk. Callers cannot alter a frame
      // while fsync is pending, nor mutate a recovered row through list().
      frame = structuredClone({ roomId: this.roomId, epoch: this.epoch, sequence: this.sequence + 1, at, kind, progress, applied,
        ...(cancelled.length ? {cancelled} : {}), ...(boundaryAt===undefined?{}:{boundaryAt}) });
      validateFrame(frame, this.sequence + 1, this.roomId, this.epoch);
      const json = JSON.stringify(frame);
      if (Buffer.byteLength(json) > this.maxFrameBytes) throw Error("Room frame exceeds byte budget");
      // Publish exactly the values that a crash recovery will read, including
      // omitted optional fields. Keep the original caller clone above so its
      // custom serializers cannot execute across this persistence boundary.
      frame = JSON.parse(json);
      entry = { frame, digest: createHash('sha256').update(json).digest('hex') };
    } catch (error) { return Promise.reject(error); }
    const ack = this.ackSequence, remove = this.ackRemovals(ack), ended = kind === "end";
    const change = { set: { sequence: frame.sequence, ackSequence: ack, ackDigest: this.ackDigest, ended }, remove: [],
      tables: { roomFrames: { set: { [frame.sequence]: entry }, remove } } };
    this.pending = (async () => {
      try {
        if (!await this.journal.commitDelta(change, () => {
          this.sequence = frame.sequence; this.persistedAck = ack; this.ended = ended;
          this.frames.set(frame.sequence, entry);
          // Only a synchronous publication is permitted inside this boundary.
          // A throwing publication is a terminal owner fault, not a rollback.
          const result = publish?.(copyArenaData(entry));
          if (result && typeof result.then === "function") throw Error("Room publication must be synchronous");
        })) throw Error("Room frame commit was superseded");
        return copyArenaData(entry);
      } catch (error) { this.fault = error; throw error; }
      finally { this.pending = null; }
    })();
    return this.pending;
  }
  ackRemovals(through) {
    const remove = [];
    for (let n = this.persistedAck + 1; n <= through; n++) remove.push(String(n));
    return remove;
  }
  acknowledge({ roomId, epoch, sequence, digest }) {
    if (this.closed || this.fault || roomId !== this.roomId || epoch !== this.epoch || !validSequence(sequence))
      throw Error("Stale or unavailable room acknowledgement");
    if (sequence < this.ackSequence) return false;
    if (sequence === this.ackSequence) {
      if (digest !== this.ackDigest) throw Error("Conflicting room acknowledgement");
      return false;
    }
    const entry = this.frames.get(sequence);
    if (sequence !== this.ackSequence + 1 || !entry || digest !== entry.digest)
      throw Error("Room acknowledgement gap or conflict");
    // The receiver must ACK only after applying this prefix durably. Persist
    // deletion with the next frame/close; a crash merely replays old frames.
    this.ackSequence = sequence; this.ackDigest = digest; this.frames.delete(sequence);
    return true;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.pending?.catch(() => {});
      if (!this.fault && this.persistedAck !== this.ackSequence) {
        const ack = this.ackSequence;
        if (!await this.journal.commitDelta({ set: { ackSequence: ack, ackDigest: this.ackDigest }, remove: [],
          tables: { roomFrames: { set: {}, remove: this.ackRemovals(ack) } } }, () => { this.persistedAck = ack; }))
          throw Error("Room acknowledgement commit was superseded");
      }
    } finally {
      try { await this.journal.close(); } finally { this.release(); }
    }
  }
}
module.exports = { RoomOutbox, FORMAT };
