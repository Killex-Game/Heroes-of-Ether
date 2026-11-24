'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { retain } = require('../../src/server/profiles/calculation-residency');
const { difference } = require('../../src/server/profiles/profile-journal');
const { applyTransfer } = require('../../src/server/profiles/profile-transfer');
test('calculation residency evicts only the oldest idle rows and produces exact removal deltas', () => {
  const recent = new Map(); let table = {};
  const update = incoming => {
    const before = table, result = retain(before, incoming, recent, 2); table = result.table;
    assert.deepEqual(applyTransfer({ profiles: before }, difference({ profiles: table }, { profiles: before })), { profiles: table });
    assert.equal(recent.size, Object.keys(table).length); return result;
  };
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  update({ a }); update({ b }); update({ a });
  assert.equal(update({ c }).evicted, 1); assert.deepEqual(Object.keys(table), ['a', 'c']);
  const old = table; assert.equal(update({ a, b, c }).evicted, 0);
  assert.equal(Object.keys(table).length, 3, 'never evict a participating row');
  assert.deepEqual(Object.keys(old), ['a', 'c']);
  update({ c }); assert.equal(Object.keys(table).length, 2);
});
test('repeated profile churn leaves bounded calculation state and restores evicted values from authoritative inputs', () => {
  const recent = new Map(), authoritative = {}, limit = 7; let table = {};
  for (let i = 0; i < 1000; i++) {
    const key = 'p' + (i % 113), value = authoritative[key] = { id: key, revision: i, wallet: { coins: i } };
    table = retain(table, { [key]: value }, recent, limit).table;
    assert.equal(table[key], value); assert(Object.keys(table).length <= limit); assert(recent.size <= limit);
  }
  assert.equal(Object.keys(authoritative).length, 113);
});
