"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createProfileBatch, replaceBatchProfile, sealProfileBatch } = require("../../src/server/profiles/profile-batch");
test("unpublished cast group shares one table, never the committed table", () => {
  const base = Object.freeze({ profiles: Object.freeze({ a: Object.freeze({ id: "a", coins: 1 }), b: Object.freeze({ id: "b", coins: 2 }) }) });
  const batch = createProfileBatch(base);
  const first = replaceBatchProfile(batch, base, "a", { id: "a", coins: 3 });
  batch.next = first;
  const second = replaceBatchProfile(batch, first, "b", { id: "b", coins: 4 });
  assert.equal(second.profiles, first.profiles);
  assert.notEqual(second.profiles, base.profiles);
  assert.deepEqual(base.profiles, { a: { id: "a", coins: 1 }, b: { id: "b", coins: 2 } });
  sealProfileBatch(batch);
  assert.equal(replaceBatchProfile(batch, second, "a", { id: "a", coins: 999 }), null);
  assert.equal(second.profiles.a.coins, 3);
});
test("intervening world replacement fences draft table reuse", () => {
  const base = { profiles: { a: { id: "a", coins: 1 } } }, batch = createProfileBatch(base);
  const first = replaceBatchProfile(batch, base, "a", { id: "a", coins: 2 });
  const other = { ...first, profiles: { ...first.profiles, b: { id: "b", coins: 10 } } };
  const next = replaceBatchProfile(batch, other, "a", { id: "a", coins: 3 });
  assert.notEqual(next.profiles, first.profiles);
  assert.notEqual(next.profiles, other.profiles);
  assert.equal(first.profiles.a.coins, 2);
  assert.equal(other.profiles.a.coins, 2);
  assert.equal(next.profiles.b.coins, 10);
  assert.equal(replaceBatchProfile({ next: base }, base, "a", {}), null);
});
