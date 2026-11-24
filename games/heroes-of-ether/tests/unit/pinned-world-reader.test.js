"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto");
const { ProfileJournal, recover, segments } = require("../../src/server/profiles/profile-journal");
const { PinnedWorldReader, draftWriter } = require("../../src/server/persistence/pinned-world-reader");
const { readLocal, pack } = require("../../src/server/persistence/state-snapshot");
const { SnapshotBuilder } = require("../../src/server/persistence/snapshot-builder");
const freeze = value => { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
function setup(t, missing = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pinned-world-")), file = path.join(dir, "profiles.json");
  let world = { version: 14, profiles: { a: { wallet: { coins: 100 }, history: [1, 2, 3], progress: { values: { xp: 5 } } },
    b: { wallet: { coins: 20 }, history: [4, 5] } }, clans: { c: { members: ["a", "b"] } }, _journalRevision: 0 };
  if (!missing) fs.writeFileSync(file, JSON.stringify(world));
  const journal = new ProfileJournal(file, { intervalMs: 300000 }), pins = [], reader = new PinnedWorldReader();
  if (!missing) world = journal.previous;
  t.after(async () => { pins.forEach(p => p.release()); await journal.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, file, journal, reader, get world() { return world; },
    commit(change) { let next = structuredClone(world); change(next);
      next = require("../../src/server/profiles/arena-profile-copy").shareArenaData(world, next);
      journal.commit(next); world = next; },
    async pin() { const pin = await journal.pinSnapshot(); pins.push(pin); return pin; } };
}
test("incremental sealed replay equals complete recovery and every database document without copying histories", async t => {
  const f = setup(t), builder = new SnapshotBuilder({immutableSource:f.reader}); let previous, before;
  for (let i = 0; i < 12; i++) {
    if (i) f.commit(w => {
      w.profiles.a.wallet.coins--; w.profiles.a.progress.values.xp += i;
      if (i === 3) w.profiles.a.history.push(4);
      if (i === 4) w.clans.c.name = "Клан";
      if (i === 5) w.profiles.new = { future: { nested: [1, 2, 3] } };
      if (i === 6) delete w.profiles.new;
      if (i === 7) w.future = { nested: [true, "текст"] };
      if (i === 8) delete w.future;
    });
    const pin = await f.pin(), actual = f.reader.read(pin), reference = recover(pin.file, false);
    assert.deepEqual(actual.data, reference.data);
    const a = builder.pack(actual.data), b = pack(reference.data);
    assert.equal(a.digest, b.digest); assert.equal(a.worldHash, b.worldHash);
    assert.deepEqual([...a.docs].map(([id, d]) => [id, d.value]), [...b.docs].map(([id, d]) => [id, d.value]));
    if (previous) {
      assert.equal(f.reader.stats.incremental, true);
      assert.deepEqual(previous, before, "previous cached world remains unchanged");
      assert.strictEqual(actual.data.profiles.b, previous.profiles.b, "untouched profile is shared");
      if (i !== 3) assert.strictEqual(actual.data.profiles.a.history, previous.profiles.a.history);
      assert.equal(f.reader.stats.readFiles, 1);
      assert(builder.stats.identityReused >= 1, "unchanged owned records reuse canonical bytes");
    }
    previous = freeze(actual.data); before = structuredClone(previous); pin.release();
  }
});
test("a new checkpoint, an older pin and a world without an initial checkpoint recover exactly", async t => {
  const f = setup(t, true);
  f.commit(() => {}); const old = await f.pin(), first = f.reader.read(old);
  f.commit(w => { w.profiles.a.wallet.coins = 7; });
  const second = await f.pin(); assert.equal(f.reader.read(second).data.profiles.a.wallet.coins, 7);
  assert.equal(f.reader.stats.incremental, true);
  await f.journal.requestCheckpoint(); const latest = await f.pin();
  assert.deepEqual(f.reader.read(latest).data, recover(latest.file, false).data);
  assert.equal(f.reader.stats.incremental, false);
  assert.deepEqual(f.reader.read(old).data, first.data); assert.equal(f.reader.stats.incremental, false);
  assert.deepEqual(f.reader.read(latest).data, recover(latest.file, false).data);
});
test("corruption, missing revisions and torn sealed writes cannot poison the last verified cache", async t => {
  const f = setup(t); f.reader.read(await f.pin()); const good = f.reader.previous;
  f.commit(w => { w.profiles.a.wallet.coins = 9; }); const pin = await f.pin();
  const segment = segments(pin.file)[0], valid = fs.readFileSync(segment);
  fs.unlinkSync(segment); // Replace this test pin only; never write through a hard link.
  for (const bytes of [Buffer.from(valid.toString().replace('coins":9', 'coins":8')), valid.subarray(0, valid.length - 1)]) {
    fs.writeFileSync(segment, bytes); assert.throws(() => f.reader.read(pin), /CHECKSUM|TRUNCATED/);
    assert.strictEqual(f.reader.previous, good);
  }
  fs.writeFileSync(segment, valid);
  assert.throws(() => f.reader.read({ ...pin, revision: pin.revision + 1 }), /INVALID_REVISION/);
  assert.strictEqual(f.reader.previous, good);
  assert.deepEqual(f.reader.read(pin).data, recover(pin.file, false).data);
  const stable = f.reader.previous;
  const body = JSON.stringify({ revision: pin.revision + 2, change: { set: {}, remove: [], tables: {} } });
  fs.writeFileSync(pin.file + ".wal-999", createHash("sha256").update(body).digest("hex") + " " + body + "\n");
  assert.throws(() => f.reader.read({ ...pin, revision: pin.revision + 2 }), /SEQUENCE/);
  assert.strictEqual(f.reader.previous, stable);
});
test("copy-on-write replay preserves nested arrays, numeric indexes, removals and failed drafts", () => {
  const source = freeze({ profiles: { p: { transactions: { entries: [{ id: "old" }] }, data: { removed: 1, keep: 2 } } }, clans: {} });
  const writer = draftWriter(source);
  writer.apply({ set: {}, remove: [], tables: { profileEdits: { p: { set: {}, remove: [], nested: {
    transactions: { set: {}, remove: [], nested: { entries: { set: { 1: { id: "new" } }, remove: [] } } },
    data: { set: {}, remove: ["removed"] },
  } } } } });
  const output = writer.finish(1);
  assert.deepEqual(output.profiles.p.transactions.entries, [{ id: "old" }, { id: "new" }]);
  assert.deepEqual(source.profiles.p.transactions.entries, [{ id: "old" }]);
  assert.deepEqual(output.profiles.p.data, { keep: 2 });
  assert.throws(() => writer.apply({ set: {}, remove: [], tables: { profileEdits: { absent: { set: {}, remove: [] } } } }));
  assert.equal(source.profiles.p.data.removed, 1);
});
test("readLocal integration preserves auxiliary files and pinned revision validation", async t => {
  const f = setup(t), reader = pin => f.reader.read(pin);
  fs.writeFileSync(path.join(f.dir, "game-events.json"), JSON.stringify({ future: [1] }));
  const pin = await f.pin();
  assert.deepEqual(readLocal(f.dir, false, pin, pack, reader), readLocal(f.dir, false, pin));
});

test("immutable record reuse keeps auxiliary edits, generic callers, failed packs and checkpoint rebases exact", async t => {
  const f = setup(t), builder = new SnapshotBuilder({ immutableSource: f.reader });
  const auxiliary = { "game-events.json": { events: [{ id: "first" }] } };
  const check = source => {
    const actual = builder.pack(source, auxiliary), expected = pack(source, auxiliary);
    assert.equal(actual.digest, expected.digest); assert.equal(actual.worldHash, expected.worldHash);
    assert.deepEqual([...actual.docs].map(([id, d]) => [id, d.value]), [...expected.docs].map(([id, d]) => [id, d.value]));
  };
  const first = freeze(f.reader.read(await f.pin()).data); check(first); check(first);
  assert.equal(builder.stats.identityReused, 3);
  auxiliary["game-events.json"].events.push({ id: "second" }); check(first);
  assert.equal(builder.stats.identityReused, 3);
  const records = builder.records, identities = builder.identities;
  assert.throws(() => builder.pack(first, { "clan-chat.json": { _journalRevision: -1 } }), /INVALID_CHAT_REVISION/);
  assert.strictEqual(builder.records, records); assert.strictEqual(builder.identities, identities);
  check(first); assert.equal(builder.stats.identityReused, 3);
  const generic = structuredClone(first); check(generic);
  assert.equal(builder.stats.identityReused, 0);
  generic.profiles.a.wallet.coins = 999; check(generic);
  assert.equal(builder.stats.identityReused, 0);
  check(first); check(first); assert.equal(builder.stats.identityReused, 3);
  f.commit(w => { w.profiles.a.wallet.coins = 77; });
  check(freeze(f.reader.read(await f.pin()).data)); assert.equal(builder.stats.identityReused, 2);
  await f.journal.requestCheckpoint();
  check(freeze(f.reader.read(await f.pin()).data));
  assert.equal(f.reader.stats.incremental, false); assert.equal(builder.stats.identityReused, 0);
});

test("changed earlier segment forces a full verified replay, and active appends are excluded", async t => {
  const f = setup(t); f.commit(w => { w.profiles.a.wallet.coins = 11; });
  const first = await f.pin(); f.reader.read(first);
  f.commit(w => { w.profiles.b.wallet.coins = 22; }); const second = await f.pin();
  const oldSegment = segments(second.file)[0], raw = fs.readFileSync(oldSegment, "utf8");
  const entry = JSON.parse(raw.trim().slice(65));
  entry.change.tables.profileEdits.a.set.wallet.coins = 12;
  const body = JSON.stringify(entry);
  fs.unlinkSync(oldSegment); fs.writeFileSync(oldSegment, createHash("sha256").update(body).digest("hex") + " " + body + "\n");
  assert.deepEqual(f.reader.read(second).data, recover(second.file, false).data);
  assert.equal(f.reader.stats.incremental, false);
  // A live append is never part of a pin; even malformed bytes are ignored.
  fs.writeFileSync(second.file + ".wal", "active incomplete bytes");
  try { assert.deepEqual(f.reader.read(second).data, recover(second.file, false).data); }
  finally { fs.unlinkSync(second.file + ".wal"); }
});
