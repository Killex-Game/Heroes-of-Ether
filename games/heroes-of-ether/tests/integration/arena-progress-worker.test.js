"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { EventManager } = require("../../src/server/events/event-manager");
const { recover, difference } = require("../../src/server/profiles/profile-journal");
const { applyTransfer } = require("../../src/server/profiles/profile-transfer");
const { ArenaBoosterQueue } = require("../../src/server/profiles/arena-booster-queue");
const at = Date.parse("2026-11-10T12:00:00Z");
function comparableRewards(data) {
  const copy = structuredClone(data);
  // Canonical economic receipts intentionally use fresh UUIDs in each run.
  // Compare their full contents and order, excluding only that random identity.
  for (const profile of Object.values(copy.profiles))
    for (const [index, entry] of profile.transactions.entries.entries()) entry.id = `receipt-${index}`;
  return copy;
}
async function fixture(t, initialAt = at) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sferorumia-progress-worker-"));
  const store = new ProfileStore({ filePath: path.join(dir, "profiles.json"), journal: true,
    arenaProgressWorker: true, now: () => initialAt });
  const serial = new ProfileStore({ now: () => initialAt });
  t.after(async () => { await store.close(); await serial.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const opened = store.open();
  store.startLife(opened.profile.id, "life");
  store.events = new EventManager({ now: () => initialAt });
  serial.events = new EventManager({ now: () => initialAt });
  serial.data = structuredClone(store.data);
  const batches = Array.from({ length: 4 }, (_, i) => ({ id: "progress-" + i, at: at + i * 50,
    progress: [{ type: "absorbed", profileId: opened.profile.id, victimProfileId: "other-" + i,
      gain: 30 + i, lifeId: "life" }] }));
  return { store, serial, batches, ...opened };
}
test("worker calculation matches serial progress and preserves immutable receipt history and replay", async t => {
  const { store, serial, batches, profile } = await fixture(t);
  const baseline = store.data, baselineText = JSON.stringify(baseline);
  for (const batch of batches) {
    assert.deepEqual(await store.applyArenaProgress(batch.id, batch.progress, batch.at, true), [profile.id]);
    serial.applyArenaProgress(batch.id, batch.progress, batch.at);
    assert.deepEqual(store.data, serial.data);
  }
  assert.equal(JSON.stringify(baseline), baselineText);
  assert.equal(store.byId(profile.id).progress.absorbedMass, 126);
  assert.deepEqual(await store.applyArenaGroup(batches.slice(-1)), [[]]);
  assert.equal(store.arenaPreparer.stats.conflicts, 0);
  assert.equal(store.arenaPreparer.stats.failures, 0);
  assert.deepEqual(recover(store.filePath).data.profiles, store.data.profiles);
});

test("worker batches stop at midnight and preserve daily rewards and the next day's progress", async t => {
  const start = Date.parse("2026-11-10T20:59:59Z");
  const { store, serial, batches, profile } = await fixture(t, start);
  batches.length = 3;
  batches.forEach((batch, i) => { batch.at = start + [50, 900, 1050][i]; });
  assert.deepEqual(await store.applyArenaGroup(batches, Infinity), [[profile.id], [profile.id]]);
  assert.deepEqual(await store.applyArenaGroup(batches.slice(2)), [[profile.id]]);
  for (const batch of batches) serial.applyArenaProgress(batch.id, batch.progress, batch.at);
  const actual = store.byId(profile.id), expected = serial.byId(profile.id);
  for (const field of ["progress", "daily", "wallet", "revision", "greatness"])
    assert.deepEqual(actual[field], expected[field], field);
  assert.equal(store.arenaPreparer.stats.failures, 0);
  assert.deepEqual(recover(store.filePath).data.profiles, store.data.profiles);
});

test("active Black Friday orders and level rewards match the serial calculation and survive replay", async t => {
  const { store, serial, profile } = await fixture(t);
  store.events.apply("test", "start", { eventId: "black-friday", requestId: "worker-event-start-0001",
    revision: store.events.data.revision });
  // Keep daily chest RNG out of this deterministic event/level comparison.
  const next = structuredClone(store.data);
  const selected = Object.values(next.profiles).find(p => p.id === profile.id);
  selected.quests.items.forEach((row, i) => { row.questId = ["harvest", "great_feast", "hunter", "feast"][i]; });
  store.save(next);
  serial.data = structuredClone(store.data);
  serial.events.data = structuredClone(store.events.data);
  const batches = [
    { id: "event-progress", at: at + 500, progress: [
      { type: "questSample", lifeId: "life", food: 150, rank: 20 },
      ...Array.from({ length: 5 }, (_, i) => ({ type: "arenaAction", lifeId: "life", metric: "rocketHits",
        sequence: i + 1, targetProfileId: "opponent-" + i })),
      { type: "arenaAction", lifeId: "life", metric: "rocketHits", sequence: 6, targetProfileId: "opponent-0" },
      { type: "survivalMinute", lifeId: "life", mass: 75000, minutes: 20 },
    ] },
    { id: "event-exit", at: at + 61000, progress: [{ type: "lifeEnded", lifeId: "life", durationSeconds: 61, reason: "exit" }] },
  ];
  for (const batch of batches) {
    batch.progress = batch.progress.map(event => ({ ...event, profileId: profile.id }));
    await store.applyArenaGroup([batch]);
    serial.applyArenaProgress(batch.id, batch.progress, batch.at);
    assert.deepEqual(comparableRewards(store.data), comparableRewards(serial.data));
  }
  assert.ok(store.byId(profile.id).progress.lastLife.levelReward.levels > 0);
  assert.ok(store.byId(profile.id).progress.lastLife.levelReward.fridayTokens > 0);
  const before = store.data;
  assert.deepEqual(await store.applyArenaGroup(batches.slice(-1)), [[]]);
  assert.strictEqual(store.data, before);
  assert.equal(store.arenaPreparer.stats.failures, 0);
});
test("concurrent wallet commit invalidates worker draft, retry preserves purchase and awards once", async t => {
  const { store, serial, batches, token, profile } = await fixture(t);
  const pending = store.applyArenaGroup(batches, 0);
  store.transact(token, "concurrent-purchase-0001", "test-purchase", p => { p.wallet.coins -= 10; });
  assert.equal(await pending, null);
  assert.equal(store.byId(profile.id).progress.absorbedMass, 0);
  serial.data = structuredClone(store.data);
  for (const batch of batches) {
    assert.deepEqual(await store.applyArenaGroup([batch], 0), [[profile.id]]);
    serial.applyArenaProgress(batch.id, batch.progress, batch.at);
    assert.deepEqual(store.data, serial.data);
  }
  assert.equal(store.arenaPreparer.stats.conflicts, 1);
});
test("event configuration change rejects an unpublished worker result", async t => {
  const { store, batches, profile } = await fixture(t);
  const pending = store.applyArenaGroup(batches, 0);
  store.events.data = structuredClone(store.events.data);
  assert.equal(await pending, null);
  assert.equal(store.byId(profile.id).progress.absorbedMass, 0);
  assert.deepEqual(await store.applyArenaGroup(batches, 0), [[profile.id]]);
});

test("lobby waiters and socket callbacks remain in the owner while a queued batch is calculated", async t => {
  const { store, batches, profile } = await fixture(t);
  let notifications = 0;
  batches[0].waiters = [() => { notifications++; }];
  batches[0].events = [{ notify() { notifications++; } }];
  assert.deepEqual(await store.applyArenaGroup(batches, 0), [[profile.id]]);
  assert.equal(notifications, 0);
  assert.equal(store.arenaPreparer.stats.failures, 0);
  assert.equal(store.byId(profile.id).progress.absorbedMass, 30);
});
test("fsync failure never publishes computed progress; retry and recovery remain exact", async t => {
  const { store, batches, profile } = await fixture(t);
  const baseline = store.data;
  const mock = t.mock.method(fs, "fsync", (fd, callback) => setImmediate(() => callback(Error("synthetic fsync failure"))));
  await assert.rejects(store.applyArenaGroup(batches, 0), /synthetic fsync failure/);
  mock.mock.restore();
  assert.strictEqual(store.data, baseline);
  assert.deepEqual(recover(store.filePath).data.profiles, baseline.profiles);
  assert.deepEqual(await store.applyArenaGroup(batches, 0), [[profile.id]]);
  assert.equal(store.byId(profile.id).progress.absorbedMass, 30);
});
test("worker exit falls back to canonical calculation without losing or repeating the batch", async t => {
  const { store, serial, batches, profile } = await fixture(t);
  const pending = store.applyArenaGroup(batches, 0);
  await store.arenaPreparer.worker.terminate();
  assert.deepEqual(await pending, [[profile.id]]);
  serial.applyArenaProgress(batches[0].id, batches[0].progress, batches[0].at);
  assert.deepEqual(store.data, serial.data);
  assert.equal(store.arenaPreparer.stats.failures, 1);
  assert.deepEqual(await store.applyArenaGroup(batches.slice(0, 1)), [[]]);
});

test("booster staging waits for an in-flight calculation and its durable commit", async t => {
  const { store, batches, profile, token } = await fixture(t);
  store.transact(token, "seed-booster-worker-0001", "seed", p => { p.inventory.meat = 4; });
  const queue = new ArenaBoosterQueue(store);
  const prepare = store.arenaPreparer.prepare.bind(store.arenaPreparer);
  let release, prepared;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { prepared = resolve; });
  store.arenaPreparer.prepare = async (...args) => {
    const result = await prepare(...args);
    prepared();
    await gate;
    return result;
  };
  const pending = store.applyArenaGroup(batches, 0);
  queue.onProgressIdle = () => pending;
  await ready;
  let preparations = 0, effects = 0;
  const cast = new Promise((resolve, reject) => queue.use({
    owner: profile.id,
    prepare(batch) {
      preparations++;
      const result = store.consume(token, "meat", "worker-booster-cast-0001", "life",
        () => ({ mass: 750 }), true, batch);
      return { finish() { if (!result.replay) effects++; resolve(); } };
    },
    fail: reject,
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.staging, true);
  assert.equal(preparations, 0);
  assert.equal(effects, 0);
  release();
  await Promise.all([pending, cast]);
  await queue.running;
  assert.equal(preparations, 1);
  assert.equal(effects, 1);
  assert.equal(store.byId(profile.id).progress.absorbedMass, 30);
  assert.equal(store.byId(profile.id).inventory.meat, 3);
  assert.deepEqual(queue.restages, { profile: 0, date: 0, validity: 0, journal: 0 });
  assert.deepEqual(recover(store.filePath).data.profiles, store.data.profiles);
});
test("transfer patches support removals, nested receipt buckets, new profiles and clans without mutation", () => {
  const archive = [{ id: "spin" }], buckets = { 0: { old: 1 }, 1: { keep: 2 } };
  const p = { id: "one", roulette: { results: archive }, quests: { session: { seenBuckets: buckets } }, removeMe: 1 };
  const old = { profiles: { a: p, deleted: {} }, clans: { old: {} }, removeRoot: true };
  const row = { ...p, quests: { session: { seenBuckets: { ...buckets, 0: { old: 1, next: 3 } } } } };
  delete row.removeMe;
  const next = { profiles: { a: row, added: { id: "two" } }, clans: { fresh: { id: "fresh" } } };
  const serialized = JSON.stringify(old), clonedPatch = structuredClone(difference(next, old));
  const result = applyTransfer(old, clonedPatch);
  assert.deepEqual(result, next);
  assert.equal(JSON.stringify(old), serialized);
  assert.strictEqual(result.profiles.a.roulette, p.roulette);
  assert.strictEqual(result.profiles.a.quests.session.seenBuckets[1], buckets[1]);
});
