"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const receipts = require("../../src/server/progression/quest-receipts");
test("A scoped draft retains exact receipt/deduplication results without changing prior buckets", () => {
  const old = { seen: { legacy: true } };
  for (let i = 0; i < 1000; i++) receipts.record(old, "old:" + i);
  for (const bucket of Object.values(old.seenBuckets)) Object.freeze(bucket);
  Object.freeze(old.seenBuckets);
  const before = structuredClone(old), expected = structuredClone(old), draft = { ...old };
  const batch = new WeakMap();
  for (const key of ["legacy", "old:5", ...Array.from({ length: 2000 }, (_, i) => "part:" + (i % 1100)), "__proto__"]) {
    assert.equal(receipts.record(draft, key, batch), receipts.record(expected, key));
  }
  assert.deepEqual(draft, expected);
  assert.deepEqual(old, before);
  assert.equal(receipts.valid(draft.seenBuckets, old.seenBuckets), true);
  const committed = structuredClone(draft), next = { ...draft };
  receipts.record(next, "next-batch", new WeakMap());
  assert.deepEqual(draft, committed);
});
test("Replacing a session's receipt map inside a draft scope never reuses the old writable map", () => {
  const batch = new WeakMap(), session = { seen: {} };
  receipts.record(session, "first", batch);
  const retained = session.seenBuckets;
  const expected = structuredClone(retained);
  session.seenBuckets = undefined;
  receipts.record(session, "second", batch);
  assert.deepEqual(retained, expected);
  assert.equal(Object.values(session.seenBuckets).some(bucket => bucket.first), false);
});
