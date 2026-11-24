"use strict";
const fs = require("node:fs"), { createHash } = require("node:crypto");
const { recover, REVISION } = require("../profiles/profile-journal");
const fail = code => { throw Object.assign(Error(code), { code }); };
// A pin contains hard links to a closed checkpoint and sealed journals. Their
// contents never change in place. Link creation affects ctime, not these fields.
function identity(file) {
  const s = fs.statSync(file, { bigint: true });
  if (!s.isFile()) fail("DATABASE_PIN_NOT_FILE");
  return [s.dev, s.ino, s.size, s.mtimeNs].join(":");
}
function sources(pin) {
  const files = [pin.file, ...require("../profiles/profile-read-snapshot").filesFor(pin)];
  return { files, identities: files.map((source, i) => {
    try { return identity(source); } catch (e) { if (i === 0 && e.code === "ENOENT") return "missing"; throw e; }
  }) };
}
function equal(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
function* entries(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length && bytes.at(-1) !== 10) fail("DATABASE_PIN_TRUNCATED");
  for (const line of bytes.toString("utf8").split("\n")) {
    if (!line) continue;
    const body = line.slice(65);
    if (line[64] !== " " || createHash("sha256").update(body).digest("hex") !== line.slice(0, 64))
      fail("DATABASE_PIN_CHECKSUM");
    const entry = JSON.parse(body);
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1) fail("DATABASE_INVALID_REVISION");
    yield entry;
  }
}
// Private copy-on-write replay. The last verified world remains intact on any
// parse, checksum, sequence or packing error. Only edited ancestor records are
// detached, once per read; unchanged histories are never traversed or copied.
function draftWriter(base) {
  const owned = new WeakSet();
  const own = value => {
    if (!value || typeof value !== "object") throw Error("Missing journal patch base");
    if (owned.has(value)) return value;
    const result = Array.isArray(value) ? value.slice() : { ...value };
    owned.add(result); return result;
  };
  const fields = (value, patch) => {
    if (!patch?.set || !Array.isArray(patch.remove)) throw Error("Invalid journal fields");
    const result = own(value);
    for (const key of patch.remove) delete result[key];
    if (Object.hasOwn(patch.set, "__proto__")) {
      for (const [key, item] of Object.entries(patch.set)) Object.defineProperty(result, key,
        { value: item, writable: true, enumerable: true, configurable: true });
    } else Object.assign(result, patch.set);
    for (const [key, nested] of Object.entries(patch.nested || {})) result[key] = fields(result[key], nested);
    return result;
  };
  let data = base;
  return {
    apply(change) {
      if (!change || typeof change !== "object" || !change.set || !change.tables || !Array.isArray(change.remove))
        throw Error("Invalid profile journal change");
      data = own(data);
      for (const key of change.remove) delete data[key];
      Object.assign(data, change.set);
      for (const [key, table] of Object.entries(change.tables)) {
        if (key === "profileEdits" || key === "residentRoomEdits") {
          const name = key === "profileEdits" ? "profiles" : "residentRooms";
          data[name] = own(data[name]);
          for (const [id, edit] of Object.entries(table)) data[name][id] = fields(data[name][id], edit);
        } else {
          if (!["profiles", "clans", "achievementCounts", "messageReceipts", "roomFrames", "residentRooms"].includes(key))
            throw Error("Invalid profile journal table");
          const target = data[key] ? own(data[key]) : own({}); data[key] = target;
          for (const id of table.remove) delete target[id];
          Object.assign(target, table.set);
        }
      }
    },
    finish(revision) { data = own(data); if (revision) data[REVISION] = revision; return data; },
  };
}
class PinnedWorldReader {
  constructor() { this.previous = null; this.stats = null; }
  owns(world) { return this.previous?.data === world; }
  read(pin) {
    if (!pin || typeof pin.file !== "string" || !Number.isSafeInteger(pin.revision) || pin.revision < 0)
      fail("DATABASE_INVALID_REVISION");
    const before = sources(pin), previous = this.previous;
    const reusable = previous && pin.revision >= previous.revision &&
      previous.identities.length <= before.identities.length &&
      previous.identities.every((value, i) => value === before.identities[i]);
    let saved, replayed = 0;
    if (reusable) {
      const writer = draftWriter(previous.data); let revision = previous.revision;
      for (const file of before.files.slice(previous.identities.length)) for (const entry of entries(file)) {
        if (entry.revision <= revision) continue;
        if (entry.revision !== revision + 1) fail("DATABASE_PIN_SEQUENCE");
        writer.apply(entry.change); revision = entry.revision; replayed++;
      }
      saved = { data: writer.finish(revision), revision, activeBytes: 0 };
    } else if (previous && before.identities[0] !== "missing") {
      const base = require("../profiles/checkpoint-json").readCheckpoint(pin.file, { reuseRecords: previous.data });
      let revision = base[REVISION] || 0;
      if (!Number.isSafeInteger(revision) || revision < 0) fail("DATABASE_INVALID_REVISION");
      // Reused records belong to earlier snapshots. The ordinary recovery
      // mutates its fresh parse; this path must detach every edited ancestor.
      const writer = draftWriter(base);
      for (const file of before.files.slice(1)) for (const entry of entries(file)) {
        if (entry.revision <= revision) continue;
        if (entry.revision !== revision + 1) fail("DATABASE_PIN_SEQUENCE");
        writer.apply(entry.change); revision = entry.revision; replayed++;
      }
      saved = { data: writer.finish(revision), revision, activeBytes: 0 };
    } else saved = recover(pin.file, false, before.files.slice(1));
    if (saved.revision !== pin.revision) fail("DATABASE_INVALID_REVISION");
    if (!equal(before.identities, sources(pin).identities)) fail("DATABASE_PIN_CHANGED");
    this.previous = { data: saved.data, revision: saved.revision, identities: before.identities };
    this.stats = { incremental: !!reusable, replayed, readFiles: reusable ? before.files.length - previous.identities.length : before.files.length };
    return saved;
  }
}
module.exports = { PinnedWorldReader, draftWriter };
