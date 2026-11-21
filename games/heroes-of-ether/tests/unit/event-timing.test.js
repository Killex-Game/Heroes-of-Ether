"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { EventManager, validate } = require("../../src/server/events/event-manager"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  lite = require("../../src/server/accounts/lite-account");
const command = (m, extra) => ({ revision: m.data.revision, requestId: randomUUID(), ...extra });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "event-timing-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let at = Date.UTC(2026, 9, 23, 12);
  const options = { filePath: path.join(dir, "events.json"), now: () => at };
  const manager = new EventManager(options);
  return { manager, options, advance: (n) => (at += n), now: () => at };
}
test("saved duration applies to repeats, not the active run; restart and retries preserve edits", (t) => {
  const f = fixture(t);
  let m = f.manager;
  const saved = command(m, { eventId: "lucky-week", durationMinutes: 120 });
  m.apply("owner", "duration", saved);
  assert.equal(m.active(), null);
  assert.equal(m.prepared()[0].manifest.durationMinutes, 120);
  m.apply("owner", "start", command(m, { eventId: "lucky-week" }));
  const first = structuredClone(m.active()),
    stamp = m.stamp();
  m.apply("owner", "duration", command(m, { eventId: "lucky-week", durationMinutes: 1440 }));
  assert.deepEqual(m.active(), first);
  const edit = command(m, { runId: first.id, endsAt: f.now() + 3 * 3600000 });
  m.apply("owner", "reschedule", edit);
  assert.notEqual(m.stamp(), stamp);
  assert.equal(m.active().id, first.id);
  assert.deepEqual(m.active().manifest, first.manifest);
  m = new EventManager(f.options);
  assert.equal(m.apply("owner", "reschedule", edit).duplicate, true);
  assert.equal(m.apply("owner", "duration", saved).duplicate, true);
  assert.equal(m.prepared()[0].manifest.durationMinutes, 1440);
  assert.throws(
    () => m.apply("owner", "reschedule", { ...edit, endsAt: edit.endsAt + 60000 }),
    /другой/,
  );
  f.advance(1000);
  m.apply("owner", "stop", command(m, { runId: first.id }));
  assert.throws(
    () => m.apply("owner", "reschedule", command(m, { runId: first.id, endsAt: f.now() + 60000 })),
    /завершено/,
  );
  m.apply("owner", "start", command(m, { eventId: "lucky-week" }));
  f.advance(59000);
  assert.notEqual(m.active().id, first.id);
  assert.equal(m.active().endsAt - m.active().startsAt, 86400000);
});
test("extended and shortened Lite uses event term without resetting limits, tickets or achievements", (t) => {
  const f = fixture(t),
    m = f.manager,
    store = new ProfileStore({ now: f.now });
  store.events = m;
  const opened = store.open(),
    p = store.find(opened.token),
    base = { testEnabled: false, events: [] };
  m.apply("owner", "duration", command(m, { eventId: "lucky-week", durationMinutes: 60 }));
  m.apply("owner", "start", command(m, { eventId: "lucky-week" }));
  const run = m.active().id,
    oldEnd = m.active().endsAt;
  lite.activate(p, m.rouletteConfig(base), f.now(), run);
  p.wallet.coins = 10000;
  lite.buyTickets(p, m.rouletteConfig(base), f.now(), {
    eventId: run,
    currency: "coins",
    quantity: 7,
  });
  p.eventAchievements = {
    [run]: { pack: "lucky-week-v1", values: { lucky_lite: 1 }, claimed: { lucky_lite: 1 } },
  };
  const before = structuredClone(store.data);
  m.apply("owner", "reschedule", command(m, { runId: run, endsAt: oldEnd + 3600000 }));
  f.advance(3600000);
  let status = lite.view(p, m.rouletteConfig(base), f.now());
  assert.equal(status.active, true);
  assert.equal(status.endsAt, oldEnd + 3600000);
  assert.equal(status.remaining.coins, 43);
  assert.equal(p.roulette.tickets, 57);
  assert.throws(() => lite.activate(p, m.rouletteConfig(base), f.now(), run), /уже куплен/);
  m.apply("owner", "reschedule", command(m, { runId: run, endsAt: f.now() + 60000 }));
  assert.deepEqual(store.data, before);
  f.advance(60000);
  assert.equal(lite.view(p, m.rouletteConfig(base), f.now()).active, false);
  assert.throws(
    () => m.apply("owner", "reschedule", command(m, { runId: run, endsAt: f.now() + 60000 })),
    /завершено/,
  );
  m.apply("owner", "start", command(m, { eventId: "lucky-week" }));
  assert.equal(lite.view(p, m.rouletteConfig(base), f.now()).active, false);
  assert.deepEqual(store.data, before);
  lite.activate(p, m.rouletteConfig(base), f.now(), m.active().id);
  assert.equal(p.roulette.tickets, 107);
  assert.equal(lite.view(p, m.rouletteConfig(base), f.now()).remaining.coins, 50);
});
test("timing validation, stale edits, corruption and disk failure leave committed state unchanged", (t) => {
  const f = fixture(t),
    m = f.manager;
  for (const value of [0, -1, 129601, 1.5, "60", null])
    assert.throws(
      () =>
        m.apply("owner", "duration", command(m, { eventId: "lucky-week", durationMinutes: value })),
      /Длительность/,
    );
  m.apply("owner", "start", command(m, { eventId: "lucky-week" }));
  const id = m.active().id;
  for (const value of [f.now(), 0, f.now() + 90 * 86400000 + 1, "1800000000000", null])
    assert.throws(
      () => m.apply("owner", "reschedule", command(m, { runId: id, endsAt: value })),
      /Окончание/,
    );
  const edit = command(m, { runId: id, endsAt: f.now() + 2 * 86400000 });
  assert.throws(() => m.apply("owner", "reschedule", { ...edit, revision: 0 }), /изменился/);
  const before = structuredClone(m.data),
    disk = fs.readFileSync(f.options.filePath, "utf8"),
    write = m.write;
  m.write = () => {
    throw Object.assign(Error("disk full"), { code: "ENOSPC" });
  };
  assert.throws(
    () => m.apply("owner", "reschedule", edit),
    (e) => e.status === 503,
  );
  assert.deepEqual(m.data, before);
  assert.equal(fs.readFileSync(f.options.filePath, "utf8"), disk);
  m.write = write;
  m.apply("owner", "reschedule", edit);
  assert.equal(new EventManager(f.options).apply("owner", "reschedule", edit).duplicate, true);
  const corrupt = structuredClone(m.data);
  corrupt.runs[0].endsAt++;
  assert.throws(() => validate(corrupt), /запуск/);
});

test("default launch rounds forward to a whole minute and survives restart without early access", (t) => {
  const f = fixture(t),
    m = f.manager;
  f.advance(12345);
  const request = command(m, { eventId: "lucky-week" }),
    at = f.now();
  m.apply("owner", "start", request);
  const run = m.scheduled();
  assert.equal(run.startsAt, Math.ceil(at / 60000) * 60000);
  assert.equal(run.startsAt % 60000, 0);
  assert.equal(run.endsAt % 60000, 0);
  assert.equal(run.endsAt - run.startsAt, 7 * 86400000);
  assert.equal(m.active(), null);
  assert.equal(m.publicView(), null);
  assert.equal(m.rouletteConfig({}).events.length, 0);
  const recovered = new EventManager(f.options);
  assert.equal(recovered.view().scheduled.id, run.id);
  assert.equal(recovered.apply("owner", "start", request).duplicate, true);
  f.advance(run.startsAt - f.now() - 1);
  assert.equal(recovered.active(), null);
  f.advance(1);
  assert.equal(recovered.active().id, run.id);
  assert.equal(recovered.view().scheduled, null);
  assert.equal(recovered.publicView().runId, run.id);
  f.advance(run.endsAt - f.now());
  assert.equal(recovered.publicView(), null);
});

test("explicit minute schedule can be retimed and cancelled, without overlap or reused payloads", (t) => {
  const f = fixture(t),
    m = f.manager,
    startsAt = f.now() + 3600000;
  for (const invalid of [
    startsAt + 1,
    startsAt + 1000,
    f.now() - 60000,
    "soon",
    null,
    f.now() + 91 * 86400000,
  ])
    assert.throws(
      () => m.apply("owner", "start", command(m, { eventId: "lucky-week", startsAt: invalid })),
      /Начало/,
    );
  const request = command(m, { eventId: "lucky-week", startsAt });
  m.apply("owner", "start", request);
  const run = m.scheduled();
  assert.throws(
    () => m.apply("owner", "start", command(m, { eventId: "lucky-week" })),
    /окончания/,
  );
  assert.throws(
    () => m.apply("owner", "start", { ...request, startsAt: startsAt + 60000 }),
    /другой/,
  );
  assert.throws(
    () => m.apply("owner", "reschedule", command(m, { runId: run.id, endsAt: startsAt + 60001 })),
    /секундами 00/,
  );
  m.apply("owner", "reschedule", command(m, { runId: run.id, endsAt: startsAt + 1800000 }));
  f.advance(1234);
  const cancel = command(m, { runId: run.id });
  m.apply("owner", "stop", cancel);
  const recovered = new EventManager(f.options);
  assert.equal(recovered.scheduled(), null);
  assert.equal(recovered.publicView(startsAt + 1), null);
  assert.equal(recovered.apply("owner", "stop", cancel).duplicate, true);
  recovered.apply("owner", "start", command(recovered, { eventId: "lucky-week" }));
  assert.ok(recovered.scheduled().startsAt < startsAt);
  validate(recovered.data);
});

test("failed scheduled write and lost reply never create a second launch", (t) => {
  const f = fixture(t),
    m = f.manager;
  f.advance(59999);
  const request = command(m, { eventId: "lucky-week" }),
    before = structuredClone(m.data),
    write = m.write;
  m.write = () => {
    throw Object.assign(Error("disk full"), { code: "ENOSPC" });
  };
  assert.throws(
    () => m.apply("owner", "start", request),
    (e) => e.status === 503,
  );
  assert.deepEqual(m.data, before);
  f.advance(2);
  m.write = write;
  m.apply("owner", "start", request);
  const committed = structuredClone(m.scheduled());
  f.advance(60000);
  const recovered = new EventManager(f.options);
  assert.equal(recovered.apply("owner", "start", request).duplicate, true);
  assert.deepEqual(recovered.active(), committed);
  assert.equal(recovered.data.runs.length, 1);
});

test("legacy event seconds and receipts stay untouched until an explicit end edit", (t) => {
  const f = fixture(t),
    m = f.manager;
  m.apply("owner", "start", command(m, { eventId: "lucky-week" }));
  const legacy = structuredClone(m.data);
  delete legacy.runs[0].createdAt;
  legacy.runs[0].startsAt += 12345;
  legacy.runs[0].endsAt += 12345;
  legacy.audit[0].at += 12345;
  fs.writeFileSync(f.options.filePath, JSON.stringify(legacy));
  const recovered = new EventManager(f.options);
  assert.deepEqual(recovered.data, legacy);
  f.advance(20000);
  const end = Math.ceil(legacy.runs[0].endsAt / 60000) * 60000;
  recovered.apply(
    "owner",
    "reschedule",
    command(recovered, { runId: legacy.runs[0].id, endsAt: end }),
  );
  assert.equal(recovered.active().startsAt, legacy.runs[0].startsAt);
  assert.equal(recovered.active().endsAt, end);
});
