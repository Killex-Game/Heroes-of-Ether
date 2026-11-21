"use strict";
// Immutable arena-operation ledger. Keep every receipt, including previous
// lives, but copy only one of 64 buckets for each successful cast. Legacy
// receipts remain authoritative and are never silently discarded/migrated.
const deltas = require("./immutable-receipt-delta");
const MISSING = Symbol("missing receipt");
const requestPattern = /^[a-zA-Z0-9_-]{16,80}$/;
function bucketFor(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return String(hash & 63);
}
function read(profile, id) {
  if (Object.hasOwn(profile.receipts, id)) return profile.receipts[id];
  const bucket = profile.arenaReceipts?.[bucketFor(id)];
  return bucket && Object.hasOwn(bucket, id) ? bucket[id] : MISSING;
}
function recordArena(profile, id, signature) {
  const before = profile.arenaReceipts || {}, key = bucketFor(id), old = before[key] || {};
  const bucket = {...old, [id]: signature};
  const next = {...before, [key]: bucket};
  deltas.remember(bucket, old, {[id]: signature});
  deltas.remember(next, before, {[key]: bucket});
  profile.arenaReceipts = next;
}
function validate(profile, version) {
  const buckets = profile.arenaReceipts;
  if (buckets === undefined) return;
  const record = value => value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (version < 14 || !record(buckets)) throw Error("Invalid arena receipt version");
  for (const [key, entries] of Object.entries(buckets)) {
    if (!/^(?:[0-9]|[1-5][0-9]|6[0-3])$/.test(key) || !record(entries))
      throw Error("Invalid arena receipt bucket");
    for (const [id, signature] of Object.entries(entries))
      if (!requestPattern.test(id) || bucketFor(id) !== key || typeof signature !== "string" ||
          (Object.hasOwn(profile.receipts, id) && profile.receipts[id] !== signature))
        throw Error("Invalid arena receipt");
  }
}
module.exports = {MISSING, read, recordArena, validate, bucketFor};
