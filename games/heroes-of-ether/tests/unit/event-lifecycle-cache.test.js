"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { EventManager } = require("../../src/server/events/event-manager");
const { packs } = require("../../src/server/events/event-packs");
const activities = require("../../src/server/events/event-activities");
const { findRunAt } = require("../../src/server/events/event-run-lookup");
const start = Date.UTC(2026, 10, 12);
const draft = (pack) => ({ schemaVersion: 1, id: pack, contentPack: pack,
  title: "Проверка ивента", description: "", durationMinutes: 60,
  features: { roulette: true, lite: true } });
function fixture(pack) {
  let now = start;
  const m = new EventManager({ now: () => now });
  const apply = (action, fields) => m.apply("test", action, {
    requestId: randomUUID(), revision: m.data.revision, ...fields,
  });
  apply("upload", { manifest: draft(pack) });
  return { m, apply, time: n => now = n };
}
function compare(m, at) {
  assert.equal(m.active(at), m.data.runs.findLast(r => m.status(r, at) === "active") || null);
  assert.equal(m.scheduled(at), m.data.runs.findLast(r => m.status(r, at) === "scheduled") || null);
  for (const pack of Object.keys(packs)) assert.equal(findRunAt(m, at, pack),
    m.data.runs.findLast(r => activities.includes(r.manifest, pack) &&
      r.startsAt <= at && at < (r.stoppedAt ?? r.endsAt)) || null);
  const run = m.active(at), described = run && activities.describe(run.manifest);
  assert.deepEqual(m.rouletteConfig({ testEnabled: true }, at), {
    testEnabled: false, events: described?.features.roulette ? [{
      id: run.id, startsAt: run.startsAt, endsAt: run.endsAt, lite: described.features.lite,
    }] : [],
  });
  const linked = described?.linkedEvents.map(e => e.id).join(",");
  assert.equal(m.stamp(at), `${m.data.revision}:${run?.id || "closed"}${linked ? ":" + linked : ""}`);
}

for (const pack of Object.keys(packs)) test(`${pack}: lifecycle caches agree at boundaries, edits, cancellation and clock rollback`, () => {
  const f = fixture(pack), { m, apply } = f;
  compare(m, start);
  apply("start", { eventId: pack, startsAt: start + 60000 });
  const first = m.scheduled();
  for (const at of [start, first.startsAt - 1, first.startsAt, first.endsAt - 1, first.endsAt,
    start, first.startsAt, first.endsAt + 100000]) compare(m, at);
  f.time(first.startsAt + 1000);
  apply("reschedule", { runId: first.id, endsAt: first.endsAt + 60000 });
  for (const at of [first.endsAt, first.endsAt + 59999, first.endsAt + 60000]) compare(m, at);
  apply("stop", { runId: first.id });
  compare(m, first.startsAt); // stopped launch is hidden publicly, but valid for delayed progress
  assert.equal(m.active(first.startsAt), null);
  assert.equal(findRunAt(m, first.startsAt, pack).id, first.id);
  assert.equal(findRunAt(m, first.startsAt + 1000, pack), null);
  apply("start", { eventId: pack, startsAt: first.endsAt + 120000 });
  const cancelled = m.scheduled();
  apply("stop", { runId: cancelled.id });
  apply("start", { eventId: pack, startsAt: first.startsAt + 60000 });
  // Cancelled future launches make the stored list non-monotonic by startsAt.
  assert.ok(m.data.runs.at(-1).startsAt < cancelled.startsAt);
  for (let at = start - 1; at < cancelled.endsAt + 60000; at += 29999) compare(m, at);
  assert.equal(findRunAt(m, first.startsAt, pack).id, first.id);
  assert.notEqual(findRunAt(m, first.startsAt + 60000, pack).id, first.id);
});

test("failed administrative writes keep warmed caches on committed state; retries replace them", () => {
  const { m, apply } = fixture("black-friday-v1");
  apply("start", { eventId: "black-friday-v1" });
  const id = m.active().id;
  compare(m, start);
  const cmd = { requestId: randomUUID(), revision: m.data.revision, runId: id };
  m.filePath = "not-written";
  m.write = () => { throw Object.assign(Error("test"), { code: "ENOSPC" }); };
  assert.throws(() => m.apply("test", "stop", cmd), /не удалось сохранить/);
  compare(m, start);
  assert.equal(m.active().id, id);
  m.write = () => {};
  m.apply("test", "stop", cmd);
  compare(m, start);
  assert.equal(m.active(), null);
  assert.equal(m.apply("test", "stop", cmd).duplicate, true);
});

test("public views/configs remain isolated from callers and flags match companion descriptions", () => {
  for (const pack of Object.keys(packs)) {
    const { m, apply } = fixture(pack);
    apply("start", { eventId: pack });
    const before = structuredClone(m.data);
    const view = m.publicView(), config = m.rouletteConfig({});
    view.features.roulette = false;
    view.linkedEvents.length = 0;
    view.title = "changed";
    if (config.events.length) config.events[0].endsAt = 0;
    else config.events.push({ id: "untrusted", startsAt: 0, endsAt: 1 });
    assert.deepEqual(m.data, before);
    compare(m, start);
    for (const features of [{}, { roulette: true }, { roulette: true, lite: false },
      { roulette: false, lite: false }, { roulette: true, lite: true }]) {
      const manifest = { ...draft(pack), features };
      assert.deepEqual(activities.features(manifest), activities.describe(manifest).features);
    }
  }
});

test("idle event reads do not repeatedly walk launch history or perform storage writes", () => {
  const m = new EventManager();
  let reads = 0, writes = 0;
  m.write = () => writes++;
  const manifest = draft("black-friday-v1");
  m.data.runs = Array.from({ length: 2000 }, (_, i) => ({
    id: String(i), manifest, startsAt: i * 120000, endsAt: i * 120000 + 60000,
    get stoppedAt() { reads++; return null; },
  }));
  const at = 300000000;
  assert.equal(m.active(at), null);
  assert.equal(findRunAt(m, at, manifest.contentPack), null);
  const initialReads = reads;
  for (let i = 0; i < 10000; i++) {
    assert.equal(m.active(at + i), null);
    assert.equal(m.scheduled(at + i), null);
    assert.equal(findRunAt(m, at + i, manifest.contentPack), null);
  }
  assert.equal(reads, initialReads);
  assert.equal(writes, 0);
  m.data.runs.push({ id: "future", manifest, startsAt: at, endsAt: at + 60000, stoppedAt: null });
  assert.equal(m.active(at).id, "future");
  assert.equal(findRunAt(m, at, manifest.contentPack).id, "future");
});
