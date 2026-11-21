"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { recover } = require("../../src/server/profiles/profile-journal");

test("bounded progress preparation preserves FIFO rewards, durable retry and serial results", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sferorumia-budget-"));
  const at = Date.parse("2026-11-10T12:00:00Z");
  const store = new ProfileStore({ filePath: path.join(dir, "bounded.json"), journal: true, now: () => at });
  const serial = new ProfileStore({ filePath: path.join(dir, "serial.json"), journal: true, now: () => at });
  t.after(async () => { await store.close(); await serial.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { profile } = store.open();
  store.startLife(profile.id, "life");
  serial.save(structuredClone(store.data), at);
  const queue = Array.from({ length: 4 }, (_, i) => ({ id: "budget-" + i, at: at + i * 50,
    progress: [{ type: "absorbed", profileId: profile.id, victimProfileId: "other-" + i, gain: 30 + i, lifeId: "life" }] }));
  const original = store.data;
  const sync = fs.fsync;
  let finish;
  const mock = t.mock.method(fs, "fsync", (fd, callback) => { finish = error => error ? callback(error) : sync(fd, callback); });
  const failed = store.applyArenaGroup(queue, 0);
  assert.strictEqual(store.data, original, "unflushed progress must not be visible");
  finish(Error("synthetic disk fault"));
  await assert.rejects(failed, /synthetic disk fault/);
  assert.strictEqual(store.data, original);
  mock.mock.restore();
  for (let i = 0; i < queue.length; i++) {
    const done = await store.applyArenaGroup(queue.slice(i), 0);
    assert.deepEqual(done, [[profile.id]], "exhausted budget commits exactly one complete tick");
    serial.applyArenaProgress(queue[i].id, queue[i].progress, queue[i].at);
    assert.equal(store.data.progressReceipt, queue[i].id);
    assert.deepEqual(store.byId(profile.id), serial.byId(profile.id));
    assert.deepEqual(recover(store.filePath).data.profiles, store.data.profiles);
  }
  assert.equal(store.byId(profile.id).progress.absorbedMass, 126);
  assert.deepEqual(await store.applyArenaGroup(queue.slice(-1), 0), [[]], "receipt replay never awards twice");
});
