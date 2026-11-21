"use strict";

// Only the synchronous preparation phase owns this table. It is sealed before
// snapshot preparation, asynchronous WAL I/O, or publication can observe it.
const owned = new WeakMap();
const tableDeltas = require("./immutable-table-delta");
const { copyRecord } = require("./copy-record");
function createProfileBatch(next) {
  const batch = { next };
  owned.set(batch, null);
  return batch;
}
function replaceBatchProfile(batch, world, key, profile) {
  if (!batch || !owned.has(batch)) return null;
  const previous = owned.get(batch);
  const table = previous?.world === world && previous.table === world.profiles
    ? previous.table : copyRecord(world.profiles);
  Object.defineProperty(table, key, { value: profile, enumerable: true, configurable: true, writable: true });
  const next = { ...world, profiles: table };
  const continuing=previous?.world===world && previous.table===world.profiles;
  const keys=continuing ? previous.keys : new Set(); keys.add(key);
  owned.set(batch, { world: next, table, keys, base:continuing ? previous.base : world.profiles });
  return next;
}
function sealProfileBatch(batch) {
  const entry=owned.get(batch);
  if (entry) tableDeltas.remember(entry.table,entry.base,entry.keys);
  owned.delete(batch);
}
module.exports = { createProfileBatch, replaceBatchProfile, sealProfileBatch };
