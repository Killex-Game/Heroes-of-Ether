"use strict";

// Immutable, sharded per-life receipts. Legacy `seen` remains readable and is
// never rewritten for a new absorption. Only the touched bucket is copied and
// journalled, so a long life does not make every new contact O(all receipts).
const BUCKETS = 128;
const deltas = require("../profiles/immutable-receipt-delta");
function bucketFor(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return String(hash & (BUCKETS - 1));
}
function record(session, key, draftBatch) {
  const bucket = bucketFor(key), previous = session.seenBuckets?.[bucket];
  if (Object.hasOwn(session.seen, key) || (previous && Object.hasOwn(previous, key))) return false;
  if (draftBatch) {
    // Only ProfileStore's synchronous, unpublished arena draft supplies this
    // scope. Copy the map and each touched bucket once per batch, not for each
    // of hundreds of absorbed parts. Published/previous snapshots stay intact.
    let owned = draftBatch.get(session);
    if (!owned || owned.buckets !== session.seenBuckets) {
      const buckets = { ...session.seenBuckets };
      owned = { buckets, touched: new Map() };
      draftBatch.set(session, owned);
      session.seenBuckets = buckets;
    }
    if (!owned.touched.has(bucket)) {
      // Receipt keys are unpredictable and numerous. A dictionary avoids a
      // new hidden-class transition for every copied contact in a long life.
      // JSON and the persisted receipt format remain exactly the same.
      owned.buckets[bucket] = Object.setPrototypeOf(
        Object.assign(Object.create(null), previous), Object.prototype);
      const additions = Object.create(null);
      owned.touched.set(bucket, additions);
      deltas.remember(owned.buckets[bucket], previous, additions);
    }
    if (key === "__proto__") Object.defineProperty(owned.buckets[bucket], key, {
      value: true, enumerable: true, writable: true, configurable: true,
    });
    else owned.buckets[bucket][key] = true;
    owned.touched.get(bucket)[key] = true;
    return true;
  }
  session.seenBuckets = {
    ...session.seenBuckets,
    [bucket]: { ...previous, [key]: true },
  };
  return true;
}
function valid(buckets, previous) {
  if (buckets === undefined) return true;
  if (!buckets || typeof buckets !== "object" || Array.isArray(buckets)) return false;
  if (buckets === previous) return true;
  for (const [key, entries] of Object.entries(buckets)) {
    const number = Number(key);
    if (!Number.isInteger(number) || number < 0 || number >= BUCKETS || String(number) !== key ||
        !entries || typeof entries !== "object" || Array.isArray(entries)) return false;
    if (entries === previous?.[key]) continue;
    const previousEntries = previous?.[key];
    for (const [receipt, value] of Object.entries(entries))
      // The previous published bucket was already validated. Check every
      // value, but re-hash only newly introduced keys (including moved keys).
      if (value !== true ||
          !(previousEntries && Object.hasOwn(previousEntries, receipt) && previousEntries[receipt] === true) &&
          bucketFor(receipt) !== key) return false;
  }
  return true;
}
module.exports = { record, valid };
