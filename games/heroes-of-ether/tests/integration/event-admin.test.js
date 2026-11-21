"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { OwnerAccess } = require("../../src/server/admin/owner-access"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { EventManager } = require("../../src/server/events/event-manager");
const PASSWORD = "Isolated admin password 2026";
const draft = {
  schemaVersion: 1,
  id: "http-fixture",
  title: "Проверка запуска",
  description: "Изолированный тест",
  durationMinutes: 60,
  contentPack: "core-v1",
  features: { roulette: true, lite: true },
};
async function setup(t) {
  let now = Math.floor(Date.now() / 60000) * 60000;
  const profiles = new ProfileStore({ now: () => now }),
    a = profiles.open(),
    b = profiles.open(),
    access = new OwnerAccess({ ownerId: a.profile.id, now: () => now }),
    events = new EventManager({ now: () => now });
  const app = createGameServer({
    profiles,
    ownerAccess: access,
    events,
    wallNow: () => now,
    autoTick: false,
    arena: new Arena({ etherCount: 0 }),
    testBots: { enabled: false },
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  let cookie = "",
    csrf = "";
  async function request(route, body, headers = {}) {
    const response = await fetch(url + route, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: `sferorumiya_session=${a.token}; ${cookie}`,
        Origin: url,
        ...(body ? { "Content-Type": "application/json", "X-Owner-CSRF": csrf } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  async function login() {
    const r = await request("/api/admin/setup", {
      password: PASSWORD,
      setupCode: access.bootstrapCode,
    });
    assert.equal(r.status, 200);
    cookie = r.headers.get("set-cookie").split(";")[0];
    csrf = r.data.csrf;
  }
  const command = (extra = {}) => ({
    requestId: randomUUID(),
    revision: events.data.revision,
    ...extra,
  });
  return {
    app,
    profiles,
    a,
    b,
    access,
    events,
    request,
    login,
    command,
    advance: (ms) => {
      now += ms;
    },
  };
}
test("owner session, CSRF and fresh password protect lifecycle; clients observe start and expiry", async (t) => {
  const f = await setup(t);
  assert.equal((await f.request("/api/admin/events")).status, 401);
  await f.login();
  assert.equal(
    (await f.request("/api/admin/events", null, { Cookie: `sferorumiya_session=${f.b.token}` }))
      .status,
    403,
  );
  const upload = f.command({ manifest: draft });
  assert.equal(
    (await f.request("/api/admin/events/upload", upload, { "X-Owner-CSRF": "wrong" })).status,
    403,
  );
  assert.equal(
    (await f.request("/api/admin/events/upload", upload, { Origin: "https://foreign.invalid" }))
      .status,
    403,
  );
  assert.equal((await f.request("/api/admin/events/upload", upload)).status, 200);
  let publicView = (await f.request("/api/profile")).data.profile;
  assert.equal(publicView.event, null);
  assert.equal(publicView.roulette.available, false);
  const start = f.command({ eventId: draft.id });
  assert.equal((await f.request("/api/admin/events/start", start)).status, 400);
  assert.equal(
    (
      await f.request("/api/admin/events/start", {
        ...start,
        password: "Wrong password long enough",
      })
    ).status,
    403,
  );
  assert.equal(f.events.active(), null);
  const confirmed = { ...start, password: PASSWORD };
  assert.equal(
    (await f.request("/api/admin/events/start", confirmed, { "X-Owner-CSRF": "wrong" })).status,
    403,
  );
  const r = await f.request("/api/admin/events/start", confirmed);
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.data).includes(PASSWORD));
  assert.equal((await f.request("/api/admin/events/start", confirmed)).data.duplicate, true);
  assert.equal(f.events.data.runs.length, 1);
  publicView = (await f.request("/api/profile")).data.profile;
  assert.equal(publicView.event.runId, r.data.receipt.runId);
  assert.equal(publicView.roulette.available, true);
  assert.equal(publicView.roulette.lite.available, true);
  const stamp = (await f.request("/api/presence")).data.eventVersion;
  const stop = f.command({ runId: r.data.receipt.runId });
  assert.equal((await f.request("/api/admin/events/stop", stop)).status, 400);
  f.advance(3600000);
  assert.notEqual((await f.request("/api/presence")).data.eventVersion, stamp);
  publicView = (await f.request("/api/profile")).data.profile;
  assert.equal(publicView.event, null);
  assert.equal(publicView.roulette.available, false);
  assert.equal(publicView.roulette.lite.available, false);
});
test("password confirmation rejects logout while hashing and rate limits wrong confirmations", async (t) => {
  const f = await setup(t);
  await f.login();
  await f.request("/api/admin/events/upload", f.command({ manifest: draft }));
  const c = f.command({ eventId: draft.id, password: PASSWORD });
  const confirmation = f.request("/api/admin/events/start", c);
  while (!f.access.busy) await new Promise((r) => setTimeout(r, 1));
  await f.request("/api/admin/logout", {});
  assert.equal((await confirmation).status, 401);
  assert.equal(f.events.active(), null);
});
test("five failed confirmations block another attempt and do not change the prepared event", async (t) => {
  const f = await setup(t);
  await f.login();
  await f.request("/api/admin/events/upload", f.command({ manifest: draft }));
  const c = f.command({ eventId: draft.id, password: "Incorrect password 2026" });
  for (let i = 0; i < 5; i++)
    assert.equal((await f.request("/api/admin/events/start", c)).status, 403);
  assert.equal(
    (await f.request("/api/admin/events/start", { ...c, password: PASSWORD })).status,
    429,
  );
  assert.equal(f.events.data.revision, 1);
  assert.equal(f.events.active(), null);
});
test("a lost successful response can be retried without extending or starting twice", async (t) => {
  const f = await setup(t);
  await f.login();
  await f.request("/api/admin/events/upload", f.command({ manifest: draft }));
  const apply = f.events.apply.bind(f.events);
  f.events.apply = (...args) => {
    const result = apply(...args);
    if (args[1] === "start") {
      f.events.apply = apply;
      throw Error("Synthetic lost response after commit");
    }
    return result;
  };
  const start = f.command({ eventId: draft.id, password: PASSWORD });
  assert.equal((await f.request("/api/admin/events/start", start)).status, 500);
  const endsAt = f.events.active().endsAt;
  f.advance(3000);
  const retried = await f.request("/api/admin/events/start", start);
  assert.equal(retried.status, 200);
  assert.equal(retried.data.duplicate, true);
  assert.equal(f.events.data.runs.length, 1);
  assert.equal(f.events.active().endsAt, endsAt);
  const stop = f.command({ runId: f.events.active().id, password: PASSWORD });
  assert.equal((await f.request("/api/admin/events/stop", stop)).status, 200);
  assert.equal((await f.request("/api/admin/events/stop", stop)).data.duplicate, true);
  assert.equal(f.events.active(), null);
});

test("timing edits require owner session and CSRF; live end changes require fresh password and are replayable", async (t) => {
  const f = await setup(t);
  const duration = () => f.command({ eventId: "lucky-week", durationMinutes: 120 });
  assert.equal((await f.request("/api/admin/events/duration", duration())).status, 401);
  await f.login();
  assert.equal(
    (await f.request("/api/admin/events/duration", duration(), { "X-Owner-CSRF": "wrong" })).status,
    403,
  );
  assert.equal((await f.request("/api/admin/events/duration", duration())).status, 200);
  assert.equal(f.events.active(), null);
  await f.request(
    "/api/admin/events/start",
    f.command({ eventId: "lucky-week", password: PASSWORD }),
  );
  const original = f.events.active().endsAt,
    run = f.events.active().id;
  const body = f.command({ runId: run, endsAt: original + 3600000 });
  assert.equal((await f.request("/api/admin/events/reschedule", body)).status, 400);
  assert.equal(
    (
      await f.request("/api/admin/events/reschedule", {
        ...body,
        password: "Incorrect long password",
      })
    ).status,
    403,
  );
  assert.equal(f.events.active().endsAt, original);
  const confirmed = { ...body, password: PASSWORD };
  assert.equal(
    (await f.request("/api/admin/events/reschedule", confirmed, { "X-Owner-CSRF": "wrong" }))
      .status,
    403,
  );
  const stamp = (await f.request("/api/presence")).data.eventVersion;
  const apply = f.events.apply.bind(f.events);
  f.events.apply = (...args) => {
    const result = apply(...args);
    if (args[1] === "reschedule") {
      f.events.apply = apply;
      throw Error("Synthetic lost timing response");
    }
    return result;
  };
  assert.equal((await f.request("/api/admin/events/reschedule", confirmed)).status, 500);
  const retry = await f.request("/api/admin/events/reschedule", confirmed);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.duplicate, true);
  assert.equal(f.events.active().endsAt, original + 3600000);
  assert.notEqual((await f.request("/api/presence")).data.eventVersion, stamp);
  assert.equal((await f.request("/api/profile")).data.profile.event.endsAt, original + 3600000);
  assert.equal(JSON.stringify(f.events.data).includes(PASSWORD), false);
  const next = f.request(
    "/api/admin/events/reschedule",
    f.command({ runId: run, endsAt: original + 7200000, password: PASSWORD }),
  );
  while (!f.access.busy) await new Promise((resolve) => setTimeout(resolve, 1));
  await f.request("/api/admin/logout", {});
  assert.equal((await next).status, 401);
  assert.equal(f.events.active().endsAt, original + 3600000);
});
