"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const ledger = require("../../src/server/profiles/operation-receipts");
const { recover, difference } = require("../../src/server/profiles/profile-journal");
const { applyTransfer } = require("../../src/server/profiles/profile-transfer");
const id = n => "arena-operation-" + n;
const at = Date.UTC(2026, 10, 11, 12);

test("arena ledger preserves old receipts, failed casts, all transaction replay paths and WAL recovery", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-operations-")), filePath = path.join(dir, "profiles.json");
  let store = new ProfileStore({filePath, journal: true, now: () => at});
  t.after(async () => { await store.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  const auth = store.open();
  store.transact(auth.token, id("stock"), "stock", p => {p.inventory.candy = 500;});
  store.transact(auth.token, id("legacy"), "legacy-cast", p => {p.inventory.candy--;});
  const old = store.find(auth.token), legacy = old.receipts;
  Object.freeze(legacy);
  assert.equal(store.consume(auth.token, "candy", id("legacy"), "legacy-cast", () => assert.fail()).replay, true);
  const before = structuredClone(store.data), save = store.save;
  assert.throws(() => store.consume(auth.token, "candy", id("invalid"), "cast", () => {throw Error("invalid target");}), /invalid target/);
  assert.deepEqual(store.data, before);
  store.save = () => {throw Error("disk failure");};
  assert.throws(() => store.consume(auth.token, "candy", id(0), "cast", () => ({})), /disk failure/);
  assert.deepEqual(store.data, before);
  store.save = save;
  store.consume(auth.token, "candy", id(0), "cast", () => ({}));
  const first = store.find(auth.token), buckets = first.arenaReceipts;
  assert.equal(store.data.version, 14);
  assert.equal(first.receipts, legacy);
  assert.equal(first.inventory.candy, 498);
  for (const bucket of Object.values(buckets)) Object.freeze(bucket);
  Object.freeze(buckets);
  store.consume(auth.token, "candy", id(1), "cast-1", () => ({}));
  assert.equal(ledger.read(first, id(1)), ledger.MISSING);
  const current = structuredClone(store.data);
  for (const replay of [
    () => store.consume(auth.token, "candy", id(0), "cast", () => assert.fail()),
    () => store.transact(auth.token, id(0), "cast", () => assert.fail()),
    () => store.transactWorld(auth.token, id(0), "cast", () => assert.fail()),
  ]) assert.equal(replay().replay, true);
  assert.throws(() => store.transact(auth.token, id(0), "another", () => assert.fail()), /номер уже использован/);
  assert.deepEqual(store.data, current);
  assert.deepEqual(recover(filePath).data.profiles, current.profiles);
  await store.journal.requestCheckpoint();
  store.consume(auth.token, "candy", id(2), "cast-2", () => ({}));
  const saved = structuredClone(store.data);
  assert.deepEqual(recover(filePath).data.profiles, saved.profiles);
  await store.close();
  store = new ProfileStore({filePath, journal: true, now: () => at});
  assert.equal(store.find(auth.token).inventory.candy, 496);
  assert.equal(store.consume(auth.token, "candy", id(2), "cast-2", () => assert.fail()).replay, true);
  assert.equal(store.transactWorld(auth.token, id("legacy"), "legacy-cast", () => assert.fail()).replay, true);
});

test("large operation history changes one bucket and sends only the new receipt across IPC", () => {
  let p = {receipts: {}};
  for (let n = 0; n < 4096; n++) ledger.recordArena(p, id(n), "cast-" + n);
  const before = {version: 14, profiles: {p}, clans: {}}, original = structuredClone(before);
  for (const bucket of Object.values(p.arenaReceipts)) Object.freeze(bucket);
  Object.freeze(p.arenaReceipts);
  const next = { ...before, profiles: {p: {...p}} };
  ledger.recordArena(next.profiles.p, id(4096), "new");
  assert.equal(Object.keys(p.arenaReceipts).filter(k => p.arenaReceipts[k] !== next.profiles.p.arenaReceipts[k]).length, 1);
  const patch = difference(next, before);
  assert.ok(JSON.stringify(patch).length < 1000);
  assert.deepEqual(applyTransfer(before, structuredClone(patch)), next);
  assert.deepEqual(before, original);
  const branch = { ...before, profiles: {p: {...p}} };
  ledger.recordArena(branch.profiles.p, id("branch"), "other");
  assert.deepEqual(applyTransfer(branch, difference(next, branch)), next);
  assert.deepEqual(applyTransfer(structuredClone(before), difference(structuredClone(next), structuredClone(before))), next);
});

test("new receipt schema fails closed for old versions, wrong hashes and corrupt entries", () => {
  const p = {receipts: {}};
  ledger.recordArena(p, id(0), "cast");
  ledger.validate(p, 14);
  assert.throws(() => ledger.validate(p, 13));
  for (const arenaReceipts of [[], {64: {}}, {"00": {}}, {[ledger.bucketFor(id(0))]: {[id(0)]: false}},
    {[(Number(ledger.bucketFor(id(0))) + 1) % 64]: {[id(0)]: "cast"}}])
    assert.throws(() => ledger.validate({receipts: {}, arenaReceipts}, 14));
  assert.throws(() => ledger.validate({...p, receipts: {[id(0)]: "conflict"}}, 14));
});
