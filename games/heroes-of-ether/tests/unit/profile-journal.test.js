"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  ProfileJournal,
  recover,
  segments,
  REVISION,
} = require("../../src/server/profiles/profile-journal");
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sferorumia-journal-test-")),
    file = path.join(dir, "profiles.json");
  const journal = new ProfileJournal(file, { intervalMs: 60000 });
  t.after(async () => {
    if (!journal.closed) await journal.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { file, journal };
}
const world = (coins = 100) => ({
  version: 13,
  profiles: { p: { coins, receipt: coins } },
  clans: {},
});

test("Idle checkpoint worker releases memory, then recovers new commits without losing receipts", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-idle-')),file=path.join(dir,'profiles.json');
  const journal=new ProfileJournal(file,{intervalMs:60000,checkpointIdleMs:150});
  t.after(async()=>{await journal.close();fs.rmSync(dir,{recursive:true,force:true});});
  const waitExit=worker=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('worker did not retire')),3000);worker.once('exit',code=>{clearTimeout(timeout);resolve(code);});});
  journal.commit(world(100));await journal.requestCheckpoint();const first=journal.worker;assert(first);await waitExit(first);assert.equal(journal.worker,null);
  journal.commit(world(75));journal.commit(world(50));await journal.requestCheckpoint();const second=journal.worker;assert(second&&second!==first);assert.equal(recover(file).data.profiles.p.receipt,50);
  // New work before the idle deadline cancels retirement; shutdown waits for
  // the last durable checkpoint, even if the idle timer is still scheduled.
  journal.commit(world(25));const pending=journal.requestCheckpoint();await journal.close();await pending;
  assert.equal(recover(file).data.profiles.p.coins,25);assert.equal(recover(file).revision,4);assert.equal(segments(file).length,0);assert.equal(journal.worker,null);
});
test("Durable journal recovers acknowledged commits without waiting for a checkpoint", async (t) => {
  const { file, journal } = setup(t);
  journal.commit(world());
  journal.commit(world(90));
  assert.equal(fs.existsSync(file), false);
  const saved = recover(file);
  assert.equal(saved.data.profiles.p.coins, 90);
  assert.equal(saved.revision, 2);
  await journal.close();
  assert.equal(JSON.parse(fs.readFileSync(file)).profiles.p.coins, 90);
  assert.equal(segments(file).length, 0);
});
test("Checkpoint and concurrent commits preserve updates, deletions, receipts and root fields", async (t) => {
  const { file, journal } = setup(t);
  let data = { ...world(), clans: { c: { coins: 20 } }, progressReceipt: "tick1" };
  journal.commit(data);
  const first = journal.requestCheckpoint();
  for (let i = 1; i <= 40; i++) {
    data = { ...world(i), clans: {}, progressReceipt: "tick" + i };
    journal.commit(data);
  }
  await first;
  assert.equal(recover(file).data.profiles.p.coins, 40);
  assert.deepEqual(recover(file).data.clans, {});
  await journal.close();
  assert.equal(JSON.parse(fs.readFileSync(file)).progressReceipt, "tick40");
  assert.equal(JSON.parse(fs.readFileSync(file))[REVISION], 41);
});
test("Partial append / fsync failure rolls back disk and permits an identical retry", async (t) => {
  const { file, journal } = setup(t);
  journal.commit(world());
  const before = fs.readFileSync(file + ".wal");
  const sync = fs.fsyncSync;
  let failed = false;
  const mock = t.mock.method(fs, "fsyncSync", (fd) => {
    if (fd === journal.fd && !failed) {
      failed = true;
      throw Error("synthetic disk failure");
    }
    return sync(fd);
  });
  assert.throws(() => journal.commit(world(50)), /synthetic disk failure/);
  assert.equal(journal.revision, 1);
  assert.deepEqual(fs.readFileSync(file + ".wal"), before);
  mock.mock.restore();
  journal.commit(world(50));
  assert.equal(recover(file).data.profiles.p.coins, 50);
  assert.equal(recover(file).revision, 2);
});
test("Torn final append is recoverable, complete corrupted commits are rejected", async (t) => {
  const { file, journal } = setup(t);
  journal.commit(world());
  fs.appendFileSync(file + ".wal", '{"body":"torn');
  assert.equal(recover(file).data.profiles.p.coins, 100);
  fs.truncateSync(file + ".wal", journal.activeBytes);
  const good = fs.readFileSync(file + ".wal", "utf8");
  fs.writeFileSync(file + ".wal", good.replace("coins", "coims"));
  assert.throws(() => recover(file), /checksum/);
  fs.writeFileSync(file + ".wal", good);
});
test("Failed checkpoint leaves journal durable and the next attempt succeeds", async (t) => {
  const { file, journal } = setup(t);
  journal.commit(world());
  fs.mkdirSync(file + ".tmp");
  await assert.rejects(journal.requestCheckpoint(), /checkpoint failed/);
  assert.equal(recover(file).data.profiles.p.coins, 100);
  journal.commit(world(60));
  fs.rmdirSync(file + ".tmp");
  await journal.close();
  assert.equal(JSON.parse(fs.readFileSync(file)).profiles.p.coins, 60);
});
test("Replayed journal is idempotent after snapshot publication but before segment cleanup", async (t) => {
  const { file, journal } = setup(t);
  journal.commit(world());
  const bytes = fs.readFileSync(file + ".wal");
  await journal.requestCheckpoint();
  fs.writeFileSync(file + ".wal-1", bytes);
  assert.equal(recover(file).revision, 1);
  journal.commit(world(75));
  await journal.close();
  assert.equal(recover(file).data.profiles.p.coins, 75);
});

test("Only changed profiles enter the WAL, including deletion and metadata removal", async (t) => {
  const { file, journal } = setup(t);
  const old = world();
  old.profiles.archived = { payload: "archived".repeat(30000) };
  old.optional = "remove me";
  journal.commit(old);
  const before = journal.activeBytes;
  const next = { ...old, optional: undefined, profiles: { ...old.profiles, p: { coins: 25 } } };
  journal.commit(next);
  assert.ok(journal.activeBytes - before < 500);
  assert.deepEqual(recover(file).data.profiles, next.profiles);
  assert.equal(recover(file).data.optional, undefined);
});

test("Arena journal edits recover receipts and inventory without copying the archive of wheel results", async (t) => {
  const { file, journal } = setup(t);
  const original = {
    id: "player",
    inventory: { meat: 2 },
    receipts: { old: "old-signature", obsolete: "removed" },
    roulette: { earned: 3, spent: 1, tickets: 2, results: { past: "past spins ".repeat(120000) } },
  };
  const initial = { version: 13, profiles: { p: original }, clans: {} };
  journal.commit(initial);
  const size = journal.activeBytes;
  const changed = {
    ...original,
    inventory: { meat: 1 },
    receipts: { old: "old-signature", next: "used-once" },
    roulette: { ...original.roulette, earned: 4, tickets: 3 },
  };
  journal.commit({ ...initial, profiles: { p: changed } });
  assert.ok(journal.activeBytes - size < 1024);
  assert.deepEqual(recover(file).data.profiles.p, changed);
  await journal.requestCheckpoint();
  assert.deepEqual(recover(file).data.profiles.p, changed);
});

test("Missing committed sequence fails closed instead of loading partial progress", async (t) => {
  const { file, journal } = setup(t);
  journal.commit(world());
  journal.commit(world(50));
  const good = fs.readFileSync(file + ".wal", "utf8");
  fs.writeFileSync(file + ".wal", good.slice(good.indexOf("\n") + 1));
  assert.throws(() => recover(file), /Missing profile journal commit/);
  fs.writeFileSync(file + ".wal", good);
});

test("Checkpoint worker failure retains commits and a replacement worker recovers", async (t) => {
  const { file, journal } = setup(t);
  journal.commit(world());
  const pending = journal.requestCheckpoint();
  const rejected = assert.rejects(pending, /worker exited/);
  await journal.worker.terminate();
  await rejected;
  journal.commit(world(20));
  await journal.requestCheckpoint();
  assert.equal(recover(file).data.profiles.p.coins, 20);
  assert.equal(journal.pendingBytes, 0);
});

test("Bounded backlog rejects new changes without losing the last commit; checkpoint permits retry", async (t) => {
  const { file, journal } = setup(t);
  journal.commit(world());
  journal.maxPendingBytes = journal.pendingBytes;
  assert.throws(() => journal.commit(world(10)), /backlog/);
  assert.equal(recover(file).data.profiles.p.coins, 100);
  await journal.requestCheckpoint();
  journal.commit(world(10));
  assert.equal(recover(file).data.profiles.p.coins, 10);
});
