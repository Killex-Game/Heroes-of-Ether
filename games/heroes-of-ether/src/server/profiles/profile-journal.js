/* Durable small commits; full JSON checkpoints are built outside the arena thread. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Worker } = require("node:worker_threads");
const receiptDeltas = require("./immutable-receipt-delta");
const tableDeltas = require("./immutable-table-delta");
const REVISION = "_journalRevision";
const digest = (text) => createHash("sha256").update(text).digest("hex");
const walPath = (file) => file + ".wal";
const openJournal = (file) => fs.openSync(file, fs.existsSync(file) ? "r+" : "w+", 0o600);
function segments(file) {
  const dir = path.dirname(file),
    prefix = path.basename(file) + ".wal-";
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
    .map((name) => path.join(dir, name));
}
function syncDirectory(directory) {
  if (process.platform === "win32") return;
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function atomicSnapshot(file, data, checkpointTree = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp",
    fd = fs.openSync(temporary, "w", 0o600);
  try {
    if (checkpointTree) require("./checkpoint-json").writeCheckpoint(fd, data);
    else fs.writeFileSync(fd, JSON.stringify(data) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  syncDirectory(path.dirname(file));
}
function apply(data, change) {
  if (
    !change ||
    typeof change !== "object" ||
    !change.set ||
    !change.tables ||
    !Array.isArray(change.remove)
  )
    throw Error("Invalid profile journal change");
  for (const key of change.remove) delete data[key];
  Object.assign(data, change.set);
  for (const [key, table] of Object.entries(change.tables)) {
    if (key === "profileEdits" || key === "residentRoomEdits") {
      const records = key === "profileEdits" ? data.profiles : data.residentRooms;
      for (const [id, edit] of Object.entries(table)) {
        const row = records?.[id];
        if (!row) throw Error("Missing base profile for journal edit");
        applyFields(row, edit);
      }
      continue;
    }
    if (!["profiles", "clans", "achievementCounts", "messageReceipts", "roomFrames", "residentRooms"].includes(key))
      throw Error("Invalid profile journal table");
    const target = data[key] || (data[key] = {});
    for (const id of table.remove) delete target[id];
    Object.assign(target, table.set);
  }
}
function applyFields(object, patch) {
  if (!object || !patch.set || !Array.isArray(patch.remove)) throw Error("Invalid journal fields");
  for (const key of patch.remove) delete object[key];
  if (Object.hasOwn(patch.set, "__proto__")) {
    for (const [key, value] of Object.entries(patch.set))
      Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
  } else Object.assign(object, patch.set);
  for (const [field, nested] of Object.entries(patch.nested || {}))
    applyFields(object[field], nested);
}
function fieldChanges(old, next) {
  const tracked = receiptDeltas.changes(old, next);
  if (tracked) return tracked;
  const set = Object.create(null),
    remove = [];
  for (const key of Object.keys(old)) if (!Object.hasOwn(next, key) || next[key] === undefined) remove.push(key);
  for (const [key, value] of Object.entries(next))
    if (value !== undefined && old[key] !== value) set[key] = value;
  return { set: Object.setPrototypeOf(set, Object.prototype), remove };
}
function recordObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
// Counters change frequently, but their sibling histories and achievement
// definitions do not. Keep the existing journal format; descend only through
// bounded plain records. Arrays/type changes remain atomic replacements.
function counterChanges(old, next, depth = 3) {
  const patch = fieldChanges(old, next);
  if (depth > 0) for (const [key, value] of Object.entries(patch.set)) {
    if (!recordObject(old[key]) || !recordObject(value)) continue;
    const nested = counterChanges(old[key], value, depth - 1);
    delete patch.set[key];
    if (Object.keys(nested.set).length || nested.remove.length || nested.nested)
      (patch.nested ||= {})[key] = nested;
  }
  return patch;
}
function arenaProfileEdit(old, row) {
  const edit = { ...fieldChanges(old, row), nested: {} };
  for (const key of ["receipts", "roulette", "quests"]) {
    if (!Object.hasOwn(edit.set, key) || !old[key] || !row[key]) continue;
    edit.nested[key] = fieldChanges(old[key], row[key]);
    delete edit.set[key];
  }
  for (const key of ["progress", "activity", "arenaReceipts"]) {
    if (!Object.hasOwn(edit.set, key) || !recordObject(old[key]) || !recordObject(row[key])) continue;
    const nested = counterChanges(old[key], row[key]);
    delete edit.set[key];
    if (Object.keys(nested.set).length || nested.remove.length || nested.nested)
      edit.nested[key] = nested;
  }
  // A spin appends one result to an immutable archive. Keep old results in
  // place; replacements/removals still use the same checked field patches.
  const wheel = edit.nested.roulette;
  if (wheel && Object.hasOwn(wheel.set, "results") &&
      recordObject(old.roulette.results) && recordObject(row.roulette.results)) {
    (wheel.nested ||= {}).results = fieldChanges(old.roulette.results, row.roulette.results);
    delete wheel.set.results;
  }
  // Time/mass samples change session counters, not the potentially large
  // absorption history. Journal only changed session fields and changed receipt
  // buckets, preserving the complete duplicate ledger across crash recovery.
  const questEdit = edit.nested.quests;
  if (questEdit && Object.hasOwn(questEdit.set, "session") && old.quests.session && row.quests.session) {
    questEdit.nested = { session: fieldChanges(old.quests.session, row.quests.session) };
    delete questEdit.set.session;
    const sessionEdit = questEdit.nested.session;
    if (Object.hasOwn(sessionEdit.set, "seenBuckets") && old.quests.session.seenBuckets && row.quests.session.seenBuckets) {
      sessionEdit.nested = { seenBuckets: fieldChanges(old.quests.session.seenBuckets, row.quests.session.seenBuckets) };
      delete sessionEdit.set.seenBuckets;
      const buckets = sessionEdit.nested.seenBuckets;
      for (const [id, entries] of Object.entries(buckets.set)) {
        if (!old.quests.session.seenBuckets[id]) continue;
        (buckets.nested ||= {})[id] = fieldChanges(old.quests.session.seenBuckets[id], entries);
        delete buckets.set[id];
      }
    }
  }
  // Transaction history is append-only on normal gameplay paths. The existing
  // nested-field WAL format can address numeric array indices, so persist only
  // a verified new tail. Rewrites/truncations retain the complete-array path.
  if (Object.hasOwn(edit.set, "transactions") && old.transactions && row.transactions) {
    const before = old.transactions.entries, after = row.transactions.entries;
    if (Array.isArray(before) && Array.isArray(after) && after.length >= before.length &&
        before.every((entry, i) => entry === after[i])) {
      const history = fieldChanges(old.transactions, row.transactions);
      delete history.set.entries;
      if (after.length > before.length) {
        const set = {};
        for (let i = before.length; i < after.length; i++) set[i] = after[i];
        history.nested = { entries: { set, remove: [] } };
      }
      edit.nested.transactions = history;
      delete edit.set.transactions;
    }
  }
  return edit;
}
function recover(file, includeActive = true, sealedFiles = null) {
  const data = fs.existsSync(file) ? require("./checkpoint-json").readCheckpoint(file) : {};
  return replay(data, file, includeActive, sealedFiles);
}
function replay(data, file, includeActive, sealedFiles) {
  let revision = data[REVISION] || 0,
    activeBytes = 0;
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw Error("Invalid profile journal revision");
  const files = sealedFiles ? [...sealedFiles] : segments(file),
    active = walPath(file);
  if (includeActive && fs.existsSync(active)) files.push(active);
  for (const source of files) {
    const buffer = fs.readFileSync(source);
    // Only a torn final append may be discarded. A corrupt complete commit is fatal.
    const end = buffer.lastIndexOf(10) + 1;
    if (source !== active && end !== buffer.length) throw Error("Truncated sealed profile journal");
    if (source === active) activeBytes = end;
    for (const line of buffer.subarray(0, end).toString("utf8").split("\n")) {
      if (!line) continue;
      const body = line.slice(65);
      if (line[64] !== " " || digest(body) !== line.slice(0, 64))
        throw Error("Profile journal checksum mismatch");
      const entry = JSON.parse(body);
      if (!Number.isSafeInteger(entry.revision) || entry.revision < 1)
        throw Error("Invalid journal sequence");
      if (entry.revision <= revision) continue; // checkpoint committed before journal cleanup
      if (entry.revision !== revision + 1) throw Error("Missing profile journal commit");
      apply(data, entry.change);
      revision = entry.revision;
    }
  }
  if (revision) data[REVISION] = revision;
  return { data, revision, activeBytes };
}
function checkpointIdentity(file) {
  try {
    const s = fs.statSync(file, { bigint: true });
    return [s.dev, s.ino, s.size, s.mtimeNs].join(":");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function checkpoint(file, files = null) { return writeCheckpoint(file, null, files); }
// Private to a single checkpoint worker. No mutable world crosses the worker
// boundary. Retirement drops this cache; a replacement starts from disk.
function createCheckpointWriter(file) {
  const cache = { value: null };
  return files => writeCheckpoint(file, cache, files);
}
function writeCheckpoint(file, cache, selected = null) {
  // Only sealed files: the arena can append to a new active WAL concurrently.
  const files = selected || segments(file);
  if (!files.length) return { revision: 0, bytes: 0 };
  // Take one immutable set of sealed files. A booster may publish a newer
  // segment while this checkpoint is being reconstructed in another worker.
  const previous = cache?.value;
  // Invalidate before any replay or I/O: even a partially applied invalid WAL
  // must never become the next base. Only an acknowledged complete checkpoint
  // is reusable, with identity checked against the actual atomically written file.
  if (cache) cache.value = null;
  const { data, revision } = previous && previous.identity === checkpointIdentity(file)
    ? replay(previous.data, file, false, files) : recover(file, false, files);
  atomicSnapshot(file, data, true);
  const identity = cache ? checkpointIdentity(file) : null;
  if (cache && identity === null) throw Error("Checkpoint disappeared before journal cleanup");
  let bytes = 0;
  try {
    for (const source of files) {
      if (Number(source.slice(source.lastIndexOf("-") + 1)) > revision) continue;
      const size = fs.statSync(source).size;
      fs.unlinkSync(source);
      bytes += size;
    }
    syncDirectory(path.dirname(file));
  } catch (error) {
    error.removedBytes = bytes;
    throw error;
  }
  if (cache) cache.value = { data, identity };
  return { revision, bytes, removedBytes: bytes };
}
function difference(next, previous) {
  const change = { set: {}, remove: [], tables: {} };
  for (const key of Object.keys(previous || {}))
    if (key !== REVISION && !(key in next)) change.remove.push(key);
  for (const [key, value] of Object.entries(next)) {
    if (key === REVISION) continue;
    if (value === undefined) {
      if (key in (previous || {})) change.remove.push(key);
      continue;
    }
    if (key === "profiles" || key === "clans" || key === "residentRooms") {
      const old = previous?.[key] || {},
        set = {},
        remove = [];
      if (old === value) continue;
      const tracked=tableDeltas.changedKeys(old,value);
      for (const id of tracked || Object.keys(value)) {
        if (!Object.hasOwn(value,id)) continue;
        const row=value[id];
        if (old[id] === row) continue;
        // Existing profiles use field patches even before their first spin or
        // when the wheel archive changes. Unchanged inventory/history need not
        // be rewritten just because a different profile field changed.
        if (
          key === "profiles" &&
          old[id] && row &&
          typeof old[id] === "object" && typeof row === "object"
        ) {
          (change.tables.profileEdits ||= {})[id] = arenaProfileEdit(old[id], row);
        } else if (key === "residentRooms" && old[id] && row) {
          (change.tables.residentRoomEdits ||= {})[id] = counterChanges(old[id], row);
        } else set[id] = row;
      }
      for (const id of tracked || Object.keys(old)) if (!(id in value)) remove.push(id);
      if (!previous?.[key] || Object.keys(set).length || remove.length)
        change.tables[key] = { set, remove };
    } else if (!previous || previous[key] !== value) change.set[key] = value;
  }
  return change;
}
class ProfileJournal {
  constructor(file, { intervalMs = 30000, maxPendingBytes = 64 * 1024 * 1024, checkpointIdleMs = 60000, readWindow = {} } = {}) {
    if (!Number.isFinite(checkpointIdleMs) || checkpointIdleMs < 1)
      throw new RangeError("Invalid checkpoint idle interval");
    this.checkpointIdleMs = checkpointIdleMs;
    this.retiringWorkers = new Set();
    this.file = file;
    const restored = recover(file);
    // The store has exclusive writer ownership before opening its journal.
    // Remove only flat read-link directories left by a previous process crash.
    require("./profile-read-snapshot").cleanup(file);
    this.readWindow = readWindow === false ? null : new (require("./profile-read-window").ProfileReadWindow)(file, readWindow);
    this.revision = restored.revision;
    this.maxPendingBytes = maxPendingBytes;
    this.pendingBytes =
      segments(file).reduce((sum, name) => sum + fs.statSync(name).size, 0) + restored.activeBytes;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(walPath(file))) fs.truncateSync(walPath(file), restored.activeBytes);
    this.fd = openJournal(walPath(file));
    syncDirectory(path.dirname(file));
    this.activeBytes = restored.activeBytes;
    // First commit includes migrations performed by ProfileStore during startup.
    this.previous = restored.data;
    this.sealedBatches = 0;
    this.closed = false;
    this.timer = setInterval(
      () => this.requestCheckpoint().catch((error) => this.reportCheckpointError(error)),
      intervalMs,
    );
    this.timer.unref();
  }
  reportCheckpointError(error) {
    if (this.reportedError !== error.message) {
      console.error("Снимок профилей отложен; прогресс сохранён в журнале:", error.message);
      this.reportedError = error.message;
    }
  }
  encode(next) {
    return this.encodeChange(difference(next, this.previous));
  }
  encodeChange(change) {
    if (this.closed || this.fault) throw Error("Profile journal unavailable");
    if (this.pendingBytes >= this.maxPendingBytes)
      throw Error("Profile checkpoint backlog is full");
    const revision = this.revision + 1;
    const body = JSON.stringify({ revision, change });
    const buffer = Buffer.from(digest(body) + " " + body + "\n");
    if (this.pendingBytes + buffer.length > this.maxPendingBytes)
      throw Error("Profile checkpoint backlog is full");
    return buffer;
  }
  // Only a numeric, sealed segment is recoverable. The temporary file can be
  // discarded after any intervening wallet change, death or invalid target.
  async stage(next) {
    const buffer = this.encode(next);
    const revision = this.revision;
    const temporary = this.file + ".booster-pending";
    if (!this.boosterWorker) {
      const worker = new Worker(path.join(__dirname, "profile-booster-worker.js"), {
        workerData: temporary,
      });
      this.boosterWorker = worker;
      worker.on("error", (error) => {
        if (this.boosterWorker === worker) this.boosterWorker = null;
        this.stageFailed?.(error);
      });
      worker.on("exit", () => {
        if (this.boosterWorker !== worker) return;
        this.boosterWorker = null;
        this.stageFailed?.(Error("Booster journal worker stopped"));
      });
    }
    if (this.stageFailed) throw Error("Concurrent booster journal preparation");
    const worker = this.boosterWorker;
    worker.ref();
    try {
      await new Promise((resolve, reject) => {
        this.stageFailed = reject;
        worker.once("message", (error) =>
          error ? reject(Error("Booster journal: " + error)) : resolve(),
        );
        worker.postMessage(buffer);
      });
    } finally {
      this.stageFailed = null;
      worker.unref();
    }
    return { revision, bytes: buffer.length, temporary };
  }
  publishStaged(entry, next) {
    if (this.closed || this.fault) throw Error("Profile journal unavailable");
    if (entry.revision !== this.revision || this.arenaFlush) return false;
    // The checkpoint reader must see all older records before the staged one.
    this.sealActive();
    const sealed = walPath(this.file) + "-" + (this.revision + 1);
    fs.renameSync(entry.temporary, sealed);
    try {
      syncDirectory(path.dirname(this.file));
    } catch (error) {
      try {
        fs.unlinkSync(sealed);
        syncDirectory(path.dirname(this.file));
      } catch {
        this.fault = true;
      }
      throw error;
    }
    this.previous = next;
    this.revision++;
    this.pendingBytes += entry.bytes;
    // Small durable casts otherwise rewrite the whole world every 64 actions.
    // Keep a bounded 256-batch window (at most two seals per cast), while the
    // existing 4 MiB threshold, periodic checkpoint and final drain still win.
    if (++this.sealedBatches >= 256 || this.pendingBytes >= this.checkpointThreshold())
      this.queueCheckpoint();
    return true;
  }
  append(buffer) {
    let offset = 0;
    while (offset < buffer.length) {
      const written = fs.writeSync(this.fd, buffer, offset, buffer.length - offset, this.activeBytes + offset);
      if (!written) throw Error("Incomplete profile journal write");
      offset += written;
    }
  }
  rollbackAppend() {
    try {
      fs.ftruncateSync(this.fd, this.activeBytes);
      fs.fsyncSync(this.fd);
    } catch {
      this.fault = true;
    }
  }
  commit(next) {
    const buffer = this.encode(next);
    try {
      if (this.arenaPending) {
        // A concurrent synchronous transaction wins this WAL revision. Its
        // fsync covers the truncation too. The arena rebuilds on the new base.
        this.arenaPending = false;
        fs.ftruncateSync(this.fd, this.activeBytes);
      }
      this.append(buffer);
      fs.fsyncSync(this.fd);
    } catch (error) {
      this.rollbackAppend();
      throw error;
    }
    this.finishAppend(next, buffer);
  }
  commitDelta(change, publish) {
    // Separate chat/room journals submit already bounded table edits.
    // Its checkpoint is reconstructed from the WAL, never from mutable RAM.
    return this.commitArena(this.previous, publish, change);
  }
  commitArena(next, publish, change) {
    if (this.arenaFlush) return this.arenaFlush.then(() => false);
    const buffer = change === undefined ? this.encode(next) : this.encodeChange(change);
    try {
      this.append(buffer);
    } catch (error) {
      this.rollbackAppend();
      throw error;
    }
    this.arenaPending = true;
    this.arenaFlush = new Promise((resolve, reject) => {
      fs.fsync(this.fd, error => error ? reject(error) : resolve());
    }).then(() => {
      if (!this.arenaPending) return false;
      this.arenaPending = false;
      this.finishAppend(next, buffer);
      publish();
      return true;
    }, error => {
      if (!this.arenaPending) return false;
      this.rollbackAppend();
      throw error;
    }).finally(() => {
      this.arenaPending = false;
      this.arenaFlush = null;
    });
    return this.arenaFlush;
  }
  finishAppend(next, buffer) {
    this.activeBytes += buffer.length;
    this.pendingBytes += buffer.length;
    this.revision++;
    this.previous = next;
    // Do not serialize the entire world every second. Busy rooms still rotate
    // before the bounded WAL fills; entries are durable at either interval.
    // Booster publication seals the active file early. Count ALL outstanding
    // segments or repeated small seals can fill the WAL before either the
    // active-file threshold or the periodic checkpoint is reached.
    if (this.pendingBytes >= this.checkpointThreshold())
      this.queueCheckpoint();
  }
  checkpointThreshold() {
    return Math.min(4 * 1024 * 1024, this.maxPendingBytes / 4);
  }
  queueCheckpoint() {
    if (this.running || this.checkpointQueued) return;
    this.checkpointQueued = setImmediate(() => {
      this.checkpointQueued = null;
      this.requestCheckpoint().catch((error) => this.reportCheckpointError(error));
    });
  }
  sealActive() {
    if (this.activeBytes) {
      fs.closeSync(this.fd);
      this.fd = null;
      try {
        fs.renameSync(walPath(this.file), walPath(this.file) + "-" + this.revision);
        this.activeBytes = 0;
      } finally {
        this.fd = openJournal(walPath(this.file));
        syncDirectory(path.dirname(this.file));
      }
    }
  }
  async pinSnapshot() {
    if (this.closed || this.fault) throw Error("Profile journal unavailable");
    if (this.running) { await this.running; return this.pinSnapshot(); }
    if (this.arenaFlush) { await this.arenaFlush.catch(() => {}); return this.pinSnapshot(); }
    // No await between sealing and linking: a checkpoint cannot start/delete
    // segments in this turn. Hard links keep immutable bytes alive afterwards.
    // The active append is never read or copied by the PostgreSQL worker.
    this.sealActive();
    const files = segments(this.file);
    return this.readWindow ? this.readWindow.pin(files, this.revision)
      : require("./profile-read-snapshot").pin(this.file, files, this.revision);
  }
  async requestCheckpoint() {
    if (this.running) return this.running;
    if (this.closed) return Promise.resolve();
    // Keep the active descriptor open until its off-thread fsync returns,
    // including when a different transaction superseded that append.
    if (this.arenaFlush) {
      await this.arenaFlush.catch(() => {});
      return this.requestCheckpoint();
    }
    this.sealActive();
    const files = segments(this.file);
    if (!files.length) return Promise.resolve();
    // Capture exactly the set sent to this checkpoint. A later staged action
    // must not be deleted before its segment enters the retained read window.
    this.readWindow?.capture(files);
    clearTimeout(this.workerIdleTimer);
    this.sealedBatches = 0;
    if (!this.worker) {
      const worker = (this.worker = new Worker(
        path.join(__dirname, "profile-checkpoint-worker.js"),
        { workerData: { file: this.file } },
      ));
      worker.on("error", (error) => {
        if (this.worker !== worker) return;
        this.worker = null;
        this.workerFailed(error);
        worker.terminate();
      });
      worker.on("exit", (code) => {
        if (this.worker !== worker) return;
        this.worker = null;
        if (this.running) this.workerFailed(Error("Profile checkpoint worker exited: " + code));
      });
      worker.on("message", (message) => {
        if (this.worker !== worker || !this.running) return;
        const resolve = this.resolve,
          reject = this.reject;
        this.running = this.resolve = this.reject = null;
        worker.unref();
        this.workerIdleTimer = setTimeout(() => {
          if (this.worker === worker && !this.running)
            this.retireCheckpointWorker().catch(error => this.reportCheckpointError(error));
        }, this.checkpointIdleMs);
        this.workerIdleTimer.unref();
        // Subtract only files actually removed. A scan made in the worker can
        // miss segments published after that scan but before this message.
        if (Number.isSafeInteger(message.removedBytes) && message.removedBytes >= 0)
          this.pendingBytes = Math.max(this.activeBytes, this.pendingBytes - message.removedBytes);
        if (message.error) {
          this.lastError = message.error;
          reject(Error(message.error));
        } else {
          this.lastError = this.reportedError = null;
          resolve();
        }
      });
    }
    this.worker.ref();
    this.running = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.worker.postMessage({ files });
    return this.running;
  }
  retireCheckpointWorker() {
    clearTimeout(this.workerIdleTimer);
    const worker = this.worker;
    if (!worker) return Promise.resolve();
    // The acknowledgement follows atomicSnapshot/fsync and segment cleanup.
    // An idle worker retains only its acknowledged checkpoint, never live
    // arena state. The replacement worker recovers its next job from disk.
    this.worker = null;
    const done = worker.terminate();
    this.retiringWorkers.add(done);
    done.then(() => this.retiringWorkers.delete(done), () => this.retiringWorkers.delete(done));
    return done;
  }
  workerFailed(error) {
    this.lastError = error.message;
    const reject = this.reject;
    this.running = this.resolve = this.reject = null;
    reject?.(error);
  }
  async close() {
    clearInterval(this.timer);
    clearImmediate(this.checkpointQueued);
    clearTimeout(this.workerIdleTimer);
    try {
      if (this.running) await this.running;
      await this.requestCheckpoint();
    } finally {
      this.closed = true;
      if (this.fd !== null) {
        fs.closeSync(this.fd);
        this.fd = null;
      }
      await this.retireCheckpointWorker();
      this.readWindow?.reset();
      await this.readWindow?.drainCleanup();
      await Promise.all(this.retiringWorkers);
      if (this.boosterWorker) await this.boosterWorker.terminate();
      fs.rmSync(this.file + ".booster-pending", { force: true });
    }
  }
}
module.exports = { ProfileJournal, recover, checkpoint, createCheckpointWriter, atomicSnapshot, segments, REVISION, difference };
