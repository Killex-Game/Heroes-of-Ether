"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { EventManager, manifest } = require("../../src/server/events/event-manager");
const lite = require("../../src/server/accounts/lite-account");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const draft = (more = {}) => ({
  schemaVersion: 1,
  id: "fixture",
  title: "Тестовый набор",
  description: "Только изолированный тест",
  durationMinutes: 60,
  contentPack: "core-v1",
  features: { roulette: true, lite: true },
  ...more,
});
const command = (manager, more = {}) => ({
  requestId: randomUUID(),
  revision: manager.data.revision,
  ...more,
});
test("upload is inert, start/stop receipts survive restart, expired events never restore test access", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "game-events-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const filePath = path.join(folder, "events.json");
  let now = 1800000000000;
  let m = new EventManager({ filePath, now: () => now });
  const base = { testEnabled: true, events: [] };
  const upload = command(m, { manifest: draft() });
  m.apply("owner", "upload", upload);
  assert.deepEqual(m.rouletteConfig(base), { testEnabled: false, events: [] });
  assert.equal(m.publicView(), null);
  assert.equal(m.apply("owner", "upload", upload).duplicate, true);
  const start = command(m, { eventId: "fixture", password: "should never be saved" });
  const result = m.apply("owner", "start", start),
    id = result.receipt.runId;
  assert.equal(m.publicView().title, "Тестовый набор");
  assert.equal(m.rouletteConfig(base).testEnabled, false);
  assert.equal(lite.event(m.rouletteConfig(base), now).id, id);
  const saved = fs.readFileSync(filePath, "utf8");
  assert.ok(!saved.includes("password"));
  assert.ok(!saved.includes("should never"));
  m = new EventManager({ filePath, now: () => now });
  now += 1000;
  assert.equal(m.apply("owner", "start", start).duplicate, true);
  assert.equal(m.data.runs.length, 1);
  assert.equal(m.publicView().runId, id);
  assert.throws(() => m.apply("owner", "start", command(m, { eventId: "fixture" })), /окончания/);
  assert.throws(() => m.apply("owner", "upload", command(m, { manifest: draft() })), /заменять/);
  const stop = command(m, { runId: id });
  m.apply("owner", "stop", stop);
  assert.equal(m.publicView(), null);
  assert.equal(m.apply("owner", "stop", stop).duplicate, true);
  assert.deepEqual(m.rouletteConfig(base), { testEnabled: false, events: [] });
  const restart = command(m, { eventId: "fixture" });
  m.apply("owner", "start", restart);
  now = m.scheduled().startsAt;
  assert.notEqual(m.publicView().runId, id);
  now = m.publicView().endsAt;
  m = new EventManager({ filePath, now: () => now });
  assert.equal(m.publicView(), null);
  assert.equal(lite.event(m.rouletteConfig(base), now), null);
  assert.equal(m.view().runs[0].status, "ended");
  assert.equal(m.apply("owner", "start", restart).duplicate, true);
  assert.equal(m.publicView(), null);
});
test("failed writes do not activate events or consume request IDs, retry commits once", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "event-failure-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const filePath = path.join(folder, "events.json"),
    m = new EventManager({ filePath });
  m.apply("owner", "upload", command(m, { manifest: draft() }));
  const before = structuredClone(m.data),
    disk = fs.readFileSync(filePath, "utf8"),
    write = m.write;
  const start = command(m, { eventId: "fixture" });
  m.write = () => {
    throw Object.assign(Error("disk full"), { code: "ENOSPC" });
  };
  assert.throws(
    () => m.apply("owner", "start", start),
    (e) => e.status === 503,
  );
  assert.deepEqual(m.data, before);
  assert.equal(fs.readFileSync(filePath, "utf8"), disk);
  m.write = write;
  assert.equal(m.apply("owner", "start", start).duplicate, false);
  assert.equal(m.apply("owner", "start", start).duplicate, true);
  assert.equal(new EventManager({ filePath }).data.runs.length, 1);
});
test("manifest validation rejects unknown content/code, stale uploads and changed replay payloads", () => {
  for (const more of [
    { schemaVersion: 2 },
    { id: "__proto__" },
    { contentPack: "missing" },
    { durationMinutes: 0 },
    { durationMinutes: 129601 },
    { features: { roulette: false, lite: true } },
    { title: "\u0000hidden" },
    { achievements: ["invented"] },
    { script: "anything.js" },
    { features: { roulette: true, lite: "yes" } },
  ])
    assert.throws(() => manifest(draft(more)));
  const m = new EventManager(),
    c = command(m, { manifest: draft() });
  m.apply("owner", "upload", c);
  assert.throws(
    () => m.apply("owner", "upload", { ...c, manifest: draft({ title: "Changed" }) }),
    /другой/,
  );
  assert.throws(
    () => m.apply("owner", "start", { revision: 0, requestId: randomUUID(), eventId: "fixture" }),
    /изменился/,
  );
  const start = command(m, { eventId: "fixture" });
  m.apply("owner", "upload", command(m, { manifest: draft({ title: "New draft" }) }));
  assert.throws(() => m.apply("owner", "start", start), /изменился/);
});
test("event integration changes only availability, Lite is scoped to a run and optionally disabled", () => {
  let now = Math.floor(Date.now() / 60000) * 60000;
  const m = new EventManager({ now: () => now }),
    p = new ProfileStore({ now: () => now, rouletteConfig: { testEnabled: true } });
  p.events = m;
  const opened = p.open(),
    before = structuredClone(p.data);
  m.apply(
    "owner",
    "upload",
    command(m, { manifest: draft({ features: { roulette: true, lite: false } }) }),
  );
  m.apply("owner", "start", command(m, { eventId: "fixture" }));
  let view = p.view(p.find(opened.token));
  assert.equal(view.roulette.available, true);
  assert.equal(view.roulette.lite.available, false);
  const version = view.eventVersion;
  now += 3600000;
  view = p.view(p.find(opened.token));
  assert.equal(view.roulette.available, false);
  assert.notEqual(view.eventVersion, version);
  assert.deepEqual(p.data, before);
});
test("corrupt lifecycle files fail closed without overwriting evidence", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "event-corrupt-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const filePath = path.join(folder, "events.json");
  fs.writeFileSync(filePath, '{"version":1}');
  assert.throws(() => new EventManager({ filePath }));
  assert.equal(fs.readFileSync(filePath, "utf8"), '{"version":1}');
});

for (const ending of ["expiry", "stop"])
  test(`earned rewards and unused tickets survive ${ending}, restore and repeat of the same event`, (t) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "event-retention-"));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const profilePath = path.join(folder, "profiles.json"),
      eventPath = path.join(folder, "events.json");
    const roulette = require("../../src/server/roulette/roulette-service"),
      rules = require("../../public/shared/roulette-rules");
    let now = Date.UTC(2026, 9, 23, 10),
      events = new EventManager({ filePath: eventPath, now: () => now }),
      store = new ProfileStore({ filePath: profilePath, now: () => now });
    store.events = events;
    const opened = store.open(),
      p = store.find(opened.token);
    // Synthetic permanent possessions, never a live player's profile.
    p.greatness = 531;
    p.outfit = { hat: "novice_hat", bow: "novice_bow" };
    const day = Math.floor(now / 86400000) - 1;
    p.regalia = { "kills-1": { count: 1, firstDay: day, lastDay: day } };
    lite.grantTickets(p, 10);
    events.apply("owner", "upload", command(events, { manifest: draft() }));
    events.apply("owner", "start", command(events, { eventId: "fixture" }));
    const firstRun = events.active().id;
    const action = (body, randomInt = () => 0) =>
      roulette.mutate(
        store,
        opened.token,
        { requestId: randomUUID(), rulesVersion: rules.version, ...body },
        randomInt,
      );
    const spin = (roll) => {
      action({ action: "prepare" });
      const body = {
        action: "spin",
        offerId: store.find(opened.token).roulette.offer.id,
        requestId: randomUUID(),
      };
      action(body, (n) => (n === rules.totalWeight ? roll : 0));
      return body;
    };
    const coinsBefore = p.wallet.coins;
    spin(500); // Coins, the first 100-coin slot.
    const previousSpin = spin(2000); // Advanced boosters.
    const earned = store.find(opened.token);
    assert.equal(earned.wallet.coins, coinsBefore + 100);
    assert.ok(Object.values(earned.inventory).some((count) => count >= 10));
    assert.equal(earned.roulette.tickets, 8);
    const before = structuredClone(store.data),
      bytes = fs.readFileSync(profilePath);
    if (ending === "expiry") now = events.active().endsAt;
    else {
      now += 1000;
      events.apply("owner", "stop", command(events, { runId: firstRun }));
    }
    let view = store.view(store.find(opened.token));
    assert.equal(view.event, null);
    assert.equal(view.roulette.available, false);
    assert.equal(view.roulette.tickets, 8);
    assert.equal(view.greatness, earned.greatness);
    assert.deepEqual(store.data, before);
    assert.ok(fs.readFileSync(profilePath).equals(bytes));
    events = new EventManager({ filePath: eventPath, now: () => now });
    store = new ProfileStore({ filePath: profilePath, now: () => now });
    store.events = events;
    assert.deepEqual(store.data, before);
    events.apply("owner", "start", command(events, { eventId: "fixture" }));
    now = events.scheduled()?.startsAt ?? now;
    assert.notEqual(events.active().id, firstRun);
    view = store.view(store.find(opened.token));
    assert.equal(view.roulette.available, true);
    assert.equal(view.roulette.tickets, 8);
    assert.deepEqual(store.data, before);
    assert.equal(action(previousSpin).replay, true);
    assert.deepEqual(store.data, before);
    spin(2000);
    assert.equal(store.find(opened.token).roulette.tickets, 7);
    assert.equal(store.find(opened.token).greatness, earned.greatness);
  });
