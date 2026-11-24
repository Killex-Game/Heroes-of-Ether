/* Bounded room replication workers. One authoritative simulation/profile store
 * remains in game-server. Only network snapshots cross this boundary. */
"use strict";
const path = require("node:path");
const { Worker, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { ArenaStateStream } = require("./state-stream");
const { stateFramePayload } = require("./socket-frames");
const { FoodTransferEncoder } = require("./worker-food-transfer");
const { packPlayers } = require("./worker-part-transfer");
const wire = require("../../../public/shared/arena-wire");
const { STATE_WORKER_LIMITS } = require("./state-worker-policy");
const eventKinds = ["events", "audioEvents", "visualEvents"];

// Shared by peers seeing the same snapshots; used only if a worker falls behind.
const merges = new WeakMap();
const pendingSnapshots = new WeakMap();
function replacePending(previous, snapshot, at) {
  if (!previous) {
    let pending = pendingSnapshots.get(snapshot);
    if (!pending) pendingSnapshots.set(snapshot, (pending = { snapshot, at }));
    return pending;
  }
  let cache = merges.get(previous);
  if (!cache) merges.set(previous, (cache = new WeakMap()));
  if (cache.has(snapshot)) return cache.get(snapshot);
  const combined = { ...snapshot },
    batches = {};
  for (const key of eventKinds) {
    const rows = new Map(
      previous.batches?.[key] ||
        (previous.snapshot[key] || []).map((row) => [
          JSON.stringify(row),
          { at: previous.at, row },
        ]),
    );
    for (const row of snapshot[key] || []) {
      const id = JSON.stringify(row);
      if (!rows.has(id)) rows.set(id, { at, row });
    }
    for (const [id, item] of rows) if (at - item.at > 2000) rows.delete(id);
    while (rows.size > 128) rows.delete(rows.keys().next().value);
    batches[key] = rows;
    combined[key] = [...rows.values()].map((item) => item.row);
  }
  for (const key of ["leaderboard", "clanLeaderboard"])
    if (!combined[key] && previous.snapshot[key]) combined[key] = previous.snapshot[key];
  const result = { snapshot: combined, batches, at };
  cache.set(snapshot, result);
  return result;
}

class WorkerStream extends ArenaStateStream {
  constructor(room, ws, send, now) {
    super(
      ws,
      (socket, data) => {
        if (this.resetNext) {
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
          data = Buffer.concat([Buffer.from('{"stateReset":true,'), bytes.subarray(1)]);
          this.resetNext = false;
        }
        send(socket, data);
      },
      now,
    );
    this.room = room;
    this.key = ++room.pool.serial;
    this.deliver = send;
    room.peers.set(this.key, this);
  }
  publish(snapshot) {
    this.latest = snapshot;
    if (!this.room) return super.publish(snapshot);
    if (this.disposed) return;
    if (this.queued) this.room.pool.stats.replaced++;
    this.queued = replacePending(this.queued, snapshot, this.now());
    this.room.dirty = true;
    this.room.lane.schedule();
  }
  acknowledge(sequence) {
    if (!this.room) return super.acknowledge(sequence);
    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= this.acknowledgedSequence ||
      sequence > this.sequence
    )
      return false;
    this.acknowledgedSequence = sequence;
    this.room.ackDirty = true;
    // Healthy peers send ACK metadata with the next state. Do not dispatch a
    // separate worker job for every network ACK (35 peers can ACK separately).
    // A stalled peer still resumes promptly without waiting for a new tick.
    if (this.room.workerPending) {
      this.room.dirty = true;
      this.room.lane.schedule();
    }
    return true;
  }
  flush() {
    if (!this.room) return super.flush();
    this.room.dirty = true;
    this.room.lane.schedule();
  }
  fallback() {
    const latest = this.queued?.snapshot || this.latest;
    this.room = null;
    this.queued = null;
    this.resetNext = true;
    // Sequence/ACK credit continues; the client clears only its presentation
    // baseline on the first full state. The life and all transactions survive.
    if (!this.disposed && latest) super.publish(latest);
  }
  dispose() {
    this.disposed = true;
    this.latest = this.queued = this.pending = this.pendingSnapshot = null;
    if (!this.room) return;
    this.room.peers.delete(this.key);
    this.room.dirty = true;
    this.room.lane.schedule();
  }
}

class Lane {
  constructor(pool) {
    this.pool = pool;
    this.rooms = [];
    const { port1, port2 } = new MessageChannel();
    this.output = port1;
    try {
      this.worker = pool.workerFactory(port2);
    } catch (error) {
      port1.close();
      port2.close();
      throw error;
    }
    this.output.on("message", (message) => this.complete(message));
    this.output.on("messageerror", (error) => this.fail(error));
    // Factories used by recovery tests may still reply on the Worker emitter.
    this.worker.on("message", (message) => this.complete(message));
    this.worker.on("error", (error) => this.fail(error));
    this.worker.on("messageerror", (error) => this.fail(error));
    this.worker.on("exit", (code) => {
      if (!pool.closed && !this.failed) this.fail(new Error("State worker exited: " + code));
    });
  }
  schedule() {
    if (this.scheduled || this.failed || this.pool.closed) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = null;
      this.dispatch();
    });
  }
  drain() {
    if (this.failed || this.pool.closed) return;
    // Non-blocking: collect a completed batch even when the main event loop
    // has not reached its message callbacks yet. Only one job is in flight.
    const ready = receiveMessageOnPort(this.output);
    if (ready) {
      this.pool.stats.drained++;
      this.complete(ready.message);
    }
  }
  dispatch() {
    clearImmediate(this.scheduled);
    this.scheduled = null;
    if (this.busy || this.failed || this.pool.closed) return;
    // Batch all assigned dirty rooms: one room per round trip would let a busy
    // main event loop throttle 10 rooms to one update per second, even while
    // the workers have spare CPU. Still only one in-flight batch per lane.
    const rooms = this.rooms.filter((room) => room.dirty);
    if (!rooms.length) return;
    const transferList = [];
    const emptied = [];
    const updates = rooms.map((room) => {
      room.dirty = false;
      room.ackDirty = false;
      const states = new Map(),
        peers = [];
      for (const peer of room.peers.values()) {
        peers.push({
          id: peer.key,
          playerId: peer.ws.playerId,
          protocol: peer.ws.protocol,
          bufferedAmount: peer.ws.bufferedAmount,
          viewport: peer.viewport,
          acknowledgedSequence: peer.acknowledgedSequence,
        });
        if (peer.queued) {
          const snapshot = peer.queued.snapshot;
          let group = states.get(snapshot);
          if (!group) states.set(snapshot, (group = { snapshot, ids: [] }));
          group.ids.push(peer.key);
          peer.queued = null;
        }
      }
      // Transfer only new/moved food. Old snapshots retained by slow peers
      // remain untouched; a fallback still owns the complete source snapshot.
      if (!peers.length) {
        room.foodTransfer = new FoodTransferEncoder({ packed: this.pool.packedFood });
        emptied.push(room);
      }
      const transferred = [...states.values()].map(group => {
        const { ether, ...snapshot } = group.snapshot;
        const food = room.foodTransfer.encode(ether || []);
        if (food?.refs) transferList.push(food.refs.buffer, food.positions.buffer);
        const packed = this.pool.packedParts && packPlayers(snapshot.players || []);
        if (packed?.partValues) {
          snapshot.players = packed.players;
          transferList.push(packed.partValues.buffer);
        }
        return { ids: group.ids, snapshot, food, partValues: packed?.partValues || null };
      });
      return { id: room.id, peers, states: transferred };
    });
    const id = ++this.pool.job;
    this.busy = { id, rooms, emptied, started: performance.now() };
    this.timer = setTimeout(() => {
      if (this.busy?.id !== id) return;
      // A congested main loop can run this timer before an already completed
      // result's callback. Check the mailbox before declaring the worker dead.
      this.drain();
      if (this.busy?.id === id) this.fail(new Error("State worker timed out"));
    }, this.pool.timeoutMs);
    this.timer.unref();
    try {
      this.worker.postMessage({ id, at: this.pool.now(), rooms: updates }, transferList);
      this.pool.stats.cloneMs += performance.now() - this.busy.started;
      this.pool.stats.jobs++;
    } catch (error) {
      this.fail(error);
    }
  }
  complete(message) {
    if (this.failed || this.pool.closed || message.job !== this.busy?.id) return;
    clearTimeout(this.timer);
    const { rooms, emptied, started } = this.busy;
    this.busy = null;
    for (const room of rooms) {
      room.workerPending = (message.pendingRooms || []).includes(room.id);
      if (room.workerPending && room.ackDirty) room.dirty = true;
    }
    this.pool.stats.workerMs += message.workerMs;
    this.pool.stats.turnaroundMs += performance.now() - started;
    const bytes = Buffer.from(message.buffer);
    const deliveryStarted = performance.now();
    for (const entry of message.entries) {
      const peer = this.pool.rooms.get(entry.room)?.peers.get(entry.id);
      if (!peer || peer.disposed || peer.ws.readyState !== 1) continue;
      peer.sequence = entry.sequence;
      peer.deliver(peer.ws, stateFramePayload(bytes, entry.offset, entry.length, entry.headroom));
      this.pool.stats.delivered++;
    }
    this.pool.stats.deliveryMs += performance.now() - deliveryStarted;
    // The worker has now consumed an explicit empty peer list and discarded
    // that room's decoder baselines. Free its slot only after this matching
    // completion, and only if no connection rejoined during the round trip.
    // Existing active rooms/overflow streams never migrate or reset.
    for (const room of emptied) if (!room.peers.size && this.pool.rooms.get(room.id) === room) {
      this.pool.rooms.delete(room.id);
      this.rooms.splice(this.rooms.indexOf(room), 1);
      this.pool.stats.retiredRooms++;
    }
    // Deliver one completed batch, then give persistence/input callbacks a
    // turn before cloning the next batch. A busy lane must not form a chain
    // of delivery + preparation inside a single event-loop callback.
    this.schedule();
  }
  fail(error) {
    if (this.failed || this.pool.closed) return;
    this.pool.stats.failures++;
    this.pool.onError(error);
    this.stop(true);
  }
  stop(fallback) {
    if (this.stopped) return this.stopped;
    this.failed = true;
    this.output.close();
    clearTimeout(this.timer);
    clearImmediate(this.scheduled);
    this.busy = null;
    for (const room of this.rooms) {
      for (const peer of room.peers.values()) {
        if (fallback) peer.fallback();
        else peer.dispose();
      }
      room.peers.clear();
    }
    this.stopped = this.worker.terminate().catch(() => {});
    return this.stopped;
  }
  close() {
    return this.stop(false);
  }
}

class ArenaStateWorkers {
  constructor({
    maxWorkers = 0,
    maxRooms = STATE_WORKER_LIMITS.DEFAULT_MAX_ROOMS,
    packedFood = false,
    packedParts = true,
    now = () => performance.now(),
    timeoutMs = STATE_WORKER_LIMITS.TIMEOUT_MS,
    onError = (e) => console.error("Подготовка состояния: переход на основной поток:", e.message),
    workerFactory = (outputPort) =>
      new Worker(path.join(__dirname, "state-worker.js"), {
        workerData: { outputPort },
        transferList: [outputPort],
        // Small short-lived snapshots need room in the young generation.
        // The default coupled to the 128 MB old-space cap caused excessive
        // GC CPU on the measured 3 x 35-player workload. Keep both bounded.
        resourceLimits: { maxOldGenerationSizeMb: STATE_WORKER_LIMITS.OLD_GENERATION_MB, maxYoungGenerationSizeMb: STATE_WORKER_LIMITS.YOUNG_GENERATION_MB },
      }),
  } = {}) {
    this.maxWorkers = Number.isInteger(maxWorkers) ? Math.max(0, Math.min(STATE_WORKER_LIMITS.MAX_WORKERS, maxWorkers)) : 0;
    // Bound the number of rooms offloaded, not the number allowed to play.
    // Keep room assignments stable for this pool's lifetime: opening another
    // room must not reset healthy peers or move all encoding back to main.
    // Zero is an explicit benchmark opt-in for offloading unlimited rooms.
    this.maxRooms = Number.isInteger(maxRooms) ? Math.max(0, maxRooms) : STATE_WORKER_LIMITS.DEFAULT_MAX_ROOMS;
    Object.assign(this, { now, timeoutMs, onError, workerFactory, packedFood, packedParts });
    this.lanes = [];
    this.rooms = new Map();
    this.overflowPeers = new Set();
    this.serial = this.job = 0;
    this.stats = {
      jobs: 0, replaced: 0, workerMs: 0, cloneMs: 0, turnaroundMs: 0,
      failures: 0, overflowStreams: 0, retiredRooms: 0, drained: 0, delivered: 0, deliveryMs: 0,
    };
  }
  createStream(roomId, ws, send) {
    if (!this.maxWorkers || this.closed || ![wire.PROTOCOL, wire.SCHEMA_PROTOCOL, wire.PRIVATE_STATE_PROTOCOL].includes(ws.protocol))
      return new ArenaStateStream(ws, send, this.now);
    let room = this.rooms.get(roomId);
    if (!room && this.maxRooms && this.rooms.size >= this.maxRooms) {
      // Overflow uses the existing main-thread stream. The admitted rooms
      // retain their workers, ACK credit and delta baselines; no extra workers
      // or snapshot clones are created for the overflow.
      this.stats.overflowStreams++;
      const stream = new ArenaStateStream(ws, send, this.now);
      this.overflowPeers.add(stream);
      const dispose = stream.dispose;
      stream.dispose = () => {
        this.overflowPeers.delete(stream);
        dispose?.call(stream);
      };
      return stream;
    }
    if (!room) {
      let lane;
      try {
        lane = this.lanes.find(candidate => !candidate.failed && !candidate.rooms.length) || (
          this.lanes.length < this.maxWorkers
            ? new Lane(this)
            : this.lanes.filter(candidate => !candidate.failed)
              .reduce((best, candidate) => !best || candidate.rooms.length < best.rooms.length ? candidate : best, null));
        if (!lane) return new ArenaStateStream(ws, send, this.now);
      } catch (error) {
        this.onError(error);
        return new ArenaStateStream(ws, send, this.now);
      }
      if (!this.lanes.includes(lane)) this.lanes.push(lane);
      room = { id: roomId, lane, pool: this, peers: new Map(), dirty: false,
        foodTransfer: new FoodTransferEncoder({ packed: this.packedFood }) };
      lane.rooms.push(room);
      this.rooms.set(roomId, room);
    }
    return room.lane.failed
      ? new ArenaStateStream(ws, send, this.now)
      : new WorkerStream(room, ws, send, this.now);
  }
  flush() {
    // The broadcast has queued every recipient. Start cloning before the
    // tick hands control to potentially hundreds of incoming commands.
    this.drainMixed();
    for (const lane of this.lanes) lane.dispatch();
  }
  drainMixed() {
    // Synchronous encoding in overflow rooms can starve result callbacks.
    // With only worker rooms, keep delivery in callbacks: moving socket writes
    // into the simulation turn regresses its latency in three-room tests.
    if (this.overflowPeers.size) this.drain();
  }
  drain() {
    for (const lane of this.lanes) lane.drain();
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.overflowPeers.clear();
    this.closePromise = Promise.all(this.lanes.map((lane) => lane.close()));
    return this.closePromise;
  }
}
module.exports = { ArenaStateWorkers };
