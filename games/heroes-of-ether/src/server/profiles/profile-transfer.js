"use strict";
const receiptDeltas = require("./immutable-receipt-delta");
const tableDeltas = require("./immutable-table-delta");
const { copyRecord } = require("./copy-record");
// The journal patch format, applied with copy-on-write. Published profiles and
// their nested receipt buckets must remain immutable on both sides of IPC.
function fields(previous, patch, location = "") {
  if (!previous || !patch.set || !Array.isArray(patch.remove)) throw Error("Invalid profile transfer fields");
  const receiptBucket = /^quests\.session\.seenBuckets\.\d+$/.test(location);
  const next = Array.isArray(previous) ? previous.slice() : receiptBucket
    ? Object.setPrototypeOf(Object.assign(Object.create(null), previous, patch.set), Object.prototype)
    : { ...previous, ...patch.set };
  if (Array.isArray(previous)) for (const [key, value] of Object.entries(patch.set)) {
    if (key === "__proto__") Object.defineProperty(next, key, { value, writable: true, enumerable: true, configurable: true });
    else next[key] = value;
  }
  for (const key of patch.remove) delete next[key];
  for (const [key, nested] of Object.entries(patch.nested || {}))
    next[key] = fields(previous[key], nested, location ? location + "." + key : key);
  if (receiptBucket && !Object.keys(patch.nested || {}).length)
    receiptDeltas.remember(next, previous, patch.set, patch.remove);
  return next;
}
function applyTransfer(previous, patch) {
  const next = fields(previous, patch);
  const profileKeys=new Set();
  let profileTableChanged = false;
  for (const [name, table] of Object.entries(patch.tables || {})) {
    if (name === "profileEdits") {
      const edits = Object.entries(table);
      if (!edits.length) continue;
      if (next.profiles === previous.profiles)
        // Small worker-local tables measured faster with native spread. Use
        // the large-table path only where the measured copy cost warrants it.
        next.profiles = tableDeltas.keysForCopy(previous.profiles).length >= 128
          ? copyRecord(previous.profiles) : { ...previous.profiles };
      for (const [id, edit] of edits) {
        next.profiles[id] = fields(next.profiles[id], edit); profileKeys.add(id);
      }
    } else if (name === "profiles" || name === "clans") {
      const setKeys = Object.keys(table.set);
      // Combined shard replies include an empty replacement table even when
      // all changes are field edits. Do not copy a whole existing table for
      // that envelope; an absent table still has to be initialized normally.
      if (!setKeys.length && !table.remove.length && next[name] &&
          typeof next[name] === "object" && !Array.isArray(next[name])) continue;
      if (name === "profiles") profileTableChanged = true;
      const rows = next[name] = { ...next[name], ...table.set };
      for (const id of table.remove) delete rows[id];
      const keys=[...setKeys,...table.remove];
      if (name === "profiles") for (const id of keys) profileKeys.add(id);
      else tableDeltas.remember(rows,previous[name],keys);
    } else throw Error("Invalid profile transfer table");
  }
  // A replacement in the envelope is not a table delta and must take the full
  // comparison path, even if table edits are present in the same patch.
  if (!Object.hasOwn(patch.set,"profiles")) {
    // Edits of existing rows cannot change the table's key order. Retain the
    // cached list across those immutable versions, but never across a table
    // insertion/removal or an envelope change.
    const sameProfileKeys = !profileTableChanged && !patch.nested?.profiles &&
      !patch.remove.includes("profiles") &&
      [...profileKeys].every(key => Object.hasOwn(previous.profiles, key));
    tableDeltas.remember(next.profiles,previous.profiles,profileKeys,sameProfileKeys);
  }
  return next;
}
module.exports = { applyTransfer };
