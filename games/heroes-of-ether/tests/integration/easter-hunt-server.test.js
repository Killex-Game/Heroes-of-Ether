"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  E = require("../../src/server/events/easter-hunt");
test("обмен всех повторов HTTP: серверный остаток, параллельный повтор, отказ записи и чужой запуск", async (t) => {
  const now = Date.UTC(2026, 9, 27, 12),
    profiles = new ProfileStore({ now: () => now }),
    events = new EventManager({ now: () => now }),
    rules = require("../../public/shared/easter-rules");
  profiles.events = events;
  events.apply("test", "start", { eventId: E.manifest.id, revision: 0, requestId: randomUUID() });
  const auth = profiles.open(),
    runId = events.active().id;
  profiles.applyArenaProgress(
    randomUUID(),
    [{ type: "easterPickup", eggType: 0, runId, profileId: auth.profile.id }],
    now,
  );
  const get = () => profiles.find(auth.token),
    state = () => get().easter.runs[runId];
  state().fragmentCounts = Array.from({ length: 48 }, (_, i) => (i === 0 ? 3 : i < 12 ? 1 : 0));
  state().fragments = 12;
  profiles.refreshCompetition(now);
  const app = createGameServer({
    profiles,
    events,
    autoTick: false,
    testBots: { enabled: false },
    wallNow: () => now,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  const post = (body, cookie = auth.token) =>
    fetch(url + "/api/easter/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "sferorumiya_session=" + cookie },
      body: JSON.stringify({
        action: "fragments-all",
        collectionId: rules.collections[0].id,
        runId,
        requestId: randomUUID(),
        ...body,
      }),
    });
  assert.equal((await post({}, "")).status, 401);
  assert.equal((await post({ collectionId: "forged" })).status, 400);
  assert.equal((await post({ runId: "another-run" })).status, 409);
  assert.equal(
    (await post({ collectionId: rules.collections[1].id, fragmentCounts: Array(48).fill(100) }))
      .status,
    409,
  );
  const original = structuredClone(get().easter),
    requestId = randomUUID(),
    save = profiles.save;
  profiles.save = () => {
    throw Error("exchange disk failure");
  };
  assert.equal((await post({ requestId })).status, 500);
  assert.deepEqual(get().easter, original);
  profiles.save = save;
  const replies = await Promise.all([post({ requestId }), post({ requestId })]);
  assert.deepEqual(
    replies.map((r) => r.status),
    [200, 200],
  );
  const bodies = await Promise.all(replies.map((r) => r.json()));
  assert.equal(bodies.filter((b) => b.replay).length, 1);
  assert.equal(state().fragmentCounts[0], 1);
  assert.equal(
    state().eggs.reduce((a, b) => a + b),
    21,
  );
  assert.deepEqual(state().found, [1, 0, 0, 0]);
  assert.equal(state().claimed.easter_collection, 1);
  assert.equal((await post({ requestId, collectionId: rules.collections[1].id })).status, 409);
  assert.equal((await post({})).status, 409);
  assert.equal(state().fragmentCounts[0], 1);
  assert.equal((await post({ fragmentCounts: Array(48).fill(100) })).status, 409);
  assert.equal(
    state().eggs.reduce((a, b) => a + b),
    21,
  );
  E.validate(get());
});
test("Easter HTTP/WS: authority, durable pickup, recovery, disconnect, replay and expired event", async (t) => {
  let time = 0;
  const at = Date.UTC(2026, 9, 26, 12),
    profiles = new ProfileStore({ now: () => at + time }),
    events = new EventManager({ now: () => at + time });
  events.apply("test", "start", {
    eventId: E.manifest.id,
    revision: 0,
    requestId: randomUUID(),
  });
  const auth = profiles.open(),
    get = () => profiles.find(auth.token);
  const app = createGameServer({
    profiles,
    events,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => time,
    wallNow: () => at + time,
    testBots: { enabled: false },
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    cookie = "sferorumiya_session=" + auth.token;
  const post = (body, headers = {}) =>
    fetch(url + "/api/easter/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...headers,
      },
      body: JSON.stringify({ requestId: randomUUID(), ...body }),
    });
  assert.equal((await post({ action: "exchange" }, { Cookie: "" })).status, 401);
  assert.equal(
    (await post({ action: "exchange" }, { Origin: "https://outside.invalid" })).status,
    403,
  );
  assert.equal(
    (
      await post({
        action: "exchange",
        runId: events.active().id,
        eggs: [99, 99, 99, 99],
      })
    ).status,
    409,
  );
  const socket = new WebSocket(url.replace("http:", "ws:"), {
    headers: { Cookie: cookie },
  });
  t.after(() => socket.terminate());
  const welcome = await new Promise((resolve) =>
    socket.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "welcome") resolve(m);
    }),
  );
  const p = app.arena.players.get(welcome.id);
  time = 1000;
  app.tick();
  assert.ok(app.arena.snapshot(time).hazards.length);
  p.protectedUntil = 0;
  app.arena.gainMass(p, 4800 - p.mass);
  app.arena.boosterEffects.split(p, p, 16, time);
  const first = p.parts[0];
  p.parts.forEach((b, i) =>
    Object.assign(b, {
      x: i ? 100 + (i % 5) * 200 : 2000,
      y: i ? 100 + Math.floor(i / 5) * 200 : 1500,
      vx: 0,
      vy: 0,
    }),
  );
  app.arena.syncParts(p);
  app.arena.hazards.items = Array.from({ length: 40 }, (_, i) => ({
    ...app.arena.hazards.create(first.x, first.y, time),
    eggType: i % 4,
  }));
  const save = profiles.save,
    beforePickup = structuredClone(get().easter);
  profiles.save = () => {
    throw Error("disk failure");
  };
  time = 2000;
  app.tick();
  assert.deepEqual(get().easter, beforePickup);
  profiles.save = save;
  app.tick();
  assert.deepEqual(get().easter.runs[events.active().id].eggs, [10, 10, 10, 10]);
  assert.deepEqual(profiles.view(get()).easter.lifeEggs, [10, 10, 10, 10]);
  app.tick();
  assert.deepEqual(get().easter.runs[events.active().id].eggs, [10, 10, 10, 10]);
  assert.equal((await post({ action: "exchange", runId: events.active().id })).status, 409);
  time = 61000;
  const closed = once([...app.wss.clients][0], "close");
  socket.close();
  await closed;
  assert.equal(get().easter.runs[events.active().id].games, 1);
  const request = {
    action: "exchange",
    runId: events.active().id,
    requestId: randomUUID(),
  };
  assert.equal((await post(request)).status, 200);
  assert.deepEqual(get().easter.runs[request.runId].eggs, [0, 0, 0, 0]);
  assert.equal((await (await post(request)).json()).replay, true);
  assert.deepEqual(get().easter.runs[request.runId].eggs, [0, 0, 0, 0]);
  assert.equal(get().easter.chests.length, 1);
  const chest = get().easter.chests[0];
  assert.equal((await post({ action: "prepare", chestId: chest.id })).status, 200);
  time = events.active().endsAt - at;
  const open = { action: "open", chestId: chest.id, requestId: randomUUID() };
  assert.equal((await post(open)).status, 200);
  assert.equal((await (await post(open)).json()).replay, true);
  assert.equal(get().inventory.easter_egg, 3);
  assert.equal((await post({ action: "exchange", runId: request.runId })).status, 409);
});
test("единый пасхальный фон трёх арен: welcome, снимки, истечение и восстановление обычного", async (t) => {
  let at = Date.UTC(2026, 9, 26, 12);
  const profiles = new ProfileStore({ now: () => at }),
    events = new EventManager({ now: () => at });
  events.apply("test", "start", {
    eventId: E.manifest.id,
    revision: 0,
    requestId: randomUUID(),
  });
  const app = createGameServer({
      profiles,
      events,
      arenaPolicy: require("../../config/arena-rooms.json"),
      autoTick: false,
      wallNow: () => at,
      testBots: { enabled: false },
    }),
    clients = [];
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(async () => {
    for (const c of clients) c.ws.terminate();
    await app.close();
  });
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  for (let i = 1; i <= 3; i++) {
    const auth = profiles.open();
    const profile = profiles.find(auth.token), level = [1, 12, 121][i - 1];
    profile.level = level;
    profile.progress = require("../../src/server/progression/experience-progression").freshProgress(level);
    const cookie = "sferorumiya_session=" + auth.token,
      res = await fetch(url + "/api/arena-reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          preferredArenaId: "arena-" + i,
          requestId: randomUUID(),
        }),
      });
    assert.equal(res.status, 200);
    const r = await res.json(),
      ws = new WebSocket(url.replace("http:", "ws:") + r.wsPath, ["ticket." + r.ticket], {
        headers: { Cookie: cookie },
      }),
      messages = [];
    clients.push({ ws, messages });
    await new Promise((resolve) =>
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        messages.push(m);
        if (m.type === "state") resolve();
      }),
    );
    assert.equal(messages.find((m) => m.type === "welcome").backgroundId, "easter-meadow");
    assert.equal(messages.find((m) => m.type === "state").backgroundId, "easter-meadow");
  }
  const original = [...app.rooms.values()].map((r) => r.arena.backgroundId);
  at = events.active().endsAt;
  for (const c of clients) c.messages.length = 0;
  app.broadcast();
  for (
    let tries = 0;
    tries < 100 && !clients.every((c) => c.messages.some((m) => m.type === "state"));
    tries++
  )
    await new Promise((r) => setTimeout(r, 10));
  clients.forEach((c, i) =>
    assert.equal(c.messages.find((m) => m.type === "state").backgroundId, original[i]),
  );
  const backgrounds = require("../../public/shared/arena-backgrounds");
  assert.ok(!backgrounds.THEMES.some((t) => t.id === "easter-meadow"));
  assert.equal(backgrounds.themeFor("easter-meadow").tileSize, 640);
});
