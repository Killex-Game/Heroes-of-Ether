"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { STATE_PROTOCOL, MAX_IN_FLIGHT } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
const { randomUUID } = require("node:crypto");

for (const stateWorkerCount of [0, 2])
for (const protocol of [wire.PROTOCOL, wire.PLAYER_SCHEMA_PROTOCOL])
test(`Arena profile patches preserve inventory receipts, live XP, replay safety and full exit profile (${stateWorkerCount} state workers, ${protocol})`, async (t) => {
  const { app, connect, advance } = await setup(t, stateWorkerCount);
  const c = await connect(protocol);
  const profile = app.profiles.find(c.auth.token);
  profile.inventory.meat = 3;
  profile.quickSlots = c.player.quickSlots = ["meat"];
  c.player.protectedUntil = 0;
  const baseline = app.profiles.view(profile);
  const savedView = app.profiles.view.bind(app.profiles);
  let lobbyViews = 0;
  app.profiles.view = (...args) => {
    lobbyViews++;
    return savedView(...args);
  };
  const request = {
    type: "useBooster",
    boosterId: "meat",
    requestId: randomUUID(),
    spawnSerial: c.player.spawnSerial,
  };
  c.ws.send(JSON.stringify(request));
  await until(() => c.messages.some((m) => m.requestId === request.requestId));
  let response = c.messages.find((m) => m.requestId === request.requestId);
  assert.equal(response.ok, true);
  assert.equal(response.profile, undefined);
  assert.equal(response.profilePatch.inventory.meat, 2);
  assert.equal(response.profilePatch.progress.achievements, undefined);
  assert.equal(lobbyViews, 0);
  const merged = wire.mergeProfile(baseline, response.profilePatch);
  assert.equal(merged.inventory.meat, 2);
  assert.deepEqual(merged.progress.achievements, baseline.progress.achievements);
  assert.equal(wire.mergeProfile(merged, { ...response.profilePatch, revision: 0 }), merged);
  assert.equal(wire.mergeProfile(merged, { ...response.profilePatch, id: "other" }), merged);
  c.messages.length = 0;
  const mass = c.player.mass;
  c.ws.send(JSON.stringify(request));
  await until(() => c.messages.some((m) => m.requestId === request.requestId));
  response = c.messages.find((m) => m.requestId === request.requestId);
  assert.equal(response.replay, true);
  assert.equal(response.profilePatch.inventory.meat, 2);
  assert.equal(c.player.mass, mass);
  if (stateWorkerCount) {
    const life = c.player.lifeId;
    app.stateWorkers.onError = () => {};
    await app.stateWorkers.lanes[0].worker.terminate();
    await until(() => app.stateWorkers.stats.failures === 1);
    assert.equal(c.player.lifeId, life);
    assert.equal(c.player.dead, false);
    assert.equal(c.ws.readyState, WebSocket.OPEN);
    assert.equal(app.profiles.find(c.auth.token).inventory.meat, 2);
  }
  // A failed durable write must not consume a booster or apply its effect.
  const commit = app.profiles.writeSnapshot;
  app.profiles.writeSnapshot = () => {
    throw Error("test write failure");
  };
  const retry = { ...request, requestId: randomUUID() };
  advance(1000);
  c.ws.send(JSON.stringify(retry));
  await until(() => c.messages.some((m) => m.requestId === retry.requestId));
  assert.equal(c.messages.find((m) => m.requestId === retry.requestId).ok, false);
  assert.equal(app.profiles.find(c.auth.token).inventory.meat, 2);
  assert.equal(c.player.mass, mass);
  app.profiles.writeSnapshot = commit;
  c.messages.length = 0;
  c.ws.send(JSON.stringify(retry));
  await until(() => c.messages.some((m) => m.requestId === retry.requestId));
  assert.equal(
    c.messages.find((m) => m.requestId === retry.requestId).profilePatch.inventory.meat,
    1,
  );
  advance(1000);
  app.tick();
  await until(() => c.messages.some((m) => m.type === "profile" && m.profilePatch));
  const live = c.messages.find((m) => m.type === "profile" && m.profilePatch).profilePatch;
  const full = savedView(app.profiles.find(c.auth.token));
  for (const key of Object.keys(live.progress))
    assert.deepEqual(live.progress[key], full.progress[key]);
  assert.equal(lobbyViews, 0);
  c.ws.send(JSON.stringify({ type: "leaveLife", spawnSerial: c.player.spawnSerial }));
  await until(() => c.messages.some((m) => m.type === "lifeEnded"));
  const ended = c.messages.find((m) => m.type === "lifeEnded");
  assert.ok(ended.profile.progress.achievements.length > 0);
  assert.ok(ended.profile.appearance.unlocked);
  assert.equal(ended.profile.inventory.meat, 1);
});

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Timed out waiting for socket");
}
async function setup(t, stateWorkerCount = 0) {
  let time = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sferorumia-state-journal-"));
  const app = createGameServer({
    stateWorkerCount,
    profiles: new ProfileStore({ filePath: path.join(dir, "profiles.json"), journal: true }),
    arena: new Arena({ etherCount: 200 }),
    autoTick: false,
    now: () => time,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = `ws://127.0.0.1:${app.httpServer.address().port}`;
  async function connect(protocol = STATE_PROTOCOL) {
    const auth = app.profiles.open(),
      messages = [];
    const ws = new WebSocket(url, protocol ? [protocol] : [], {
      headers: { Cookie: `sferorumiya_session=${auth.token}` },
    });
    ws.on("message", (raw) => messages.push(JSON.parse(raw)));
    await once(ws, "open");
    await until(() => messages.some((m) => m.type === "state"));
    const id = messages.find((m) => m.type === "welcome").id;
    const server = [...app.wss.clients].find((w) => w.playerId === id);
    return { ws, server, messages, auth, player: app.arena.players.get(id) };
  }
  return {
    app,
    connect,
    advance: (ms = 50) => {
      time += ms;
    },
  };
}

test("room snapshots include owners' HUDs and switch back to full rows for a legacy peer", async (t) => {
  const { app, connect } = await setup(t);
  const first = await connect(wire.PROTOCOL), second = await connect(wire.HUD_PROTOCOL);
  const snapshot = t.mock.method(app.arena, "snapshot");
  app.broadcast();
  assert.equal(snapshot.mock.calls.length, 1);
  assert.deepEqual(snapshot.mock.calls[0].arguments[3], new Set([first.player.id, second.player.id]));
  const legacy = await connect(wire.MOTION_PROTOCOL);
  app.broadcast();
  assert.equal(snapshot.mock.calls.at(-1).arguments[3], null);
  const disconnected = once(legacy.server, "close");
  legacy.ws.close();
  await disconnected;
  app.broadcast();
  assert.deepEqual(snapshot.mock.calls.at(-1).arguments[3], new Set([first.player.id, second.player.id]));
});

test("Slow client never blocks another player or reliable life result; retry cannot award twice", async (t) => {
  const { app, connect, advance } = await setup(t);
  const slow = await connect(),
    fast = await connect("");
  slow.messages.length = fast.messages.length = 0;
  for (let i = 0; i < 100; i++) {
    advance();
    app.broadcast();
    await until(() => fast.messages.filter((m) => m.type === "state").length === i + 1);
  }
  await until(() => fast.messages.filter((m) => m.type === "state").length === 100);
  assert.equal(slow.messages.filter((m) => m.type === "state").length, MAX_IN_FLIGHT - 1);
  assert.equal(slow.ws.readyState, WebSocket.OPEN);
  assert.ok(slow.server.bufferedAmount < 65536);
  assert.equal(slow.server.stateStream.pending.tick, app.arena.tick);

  // Failure to persist remains visible, retry saves the life, and the result is
  // delivered even though this renderer has not acknowledged its initial state.
  const original = app.profiles.applyArenaProgress;
  app.profiles.applyArenaProgress = () => {
    throw Error("simulated persistence outage");
  };
  const leave = { type: "leaveLife", spawnSerial: slow.player.spawnSerial };
  slow.ws.send(JSON.stringify(leave));
  await until(() => slow.messages.some((m) => m.type === "leaveResult"));
  assert.equal(
    slow.messages.some((m) => m.type === "lifeEnded"),
    false,
  );
  app.profiles.applyArenaProgress = original;
  app.tick();
  await until(() => slow.messages.some((m) => m.type === "lifeEnded"));
  const saved = structuredClone(app.profiles.find(slow.auth.token));
  const result = slow.messages.find((m) => m.type === "lifeEnded");
  assert.equal(result.result.reason, "left");
  assert.ok(result.result.durationSeconds >= 5);
  slow.messages.length = 0;
  slow.ws.send(JSON.stringify(leave));
  await until(() => slow.messages.some((m) => m.type === "lifeEnded"));
  assert.deepEqual(app.profiles.find(slow.auth.token), saved);

  slow.ws.send(JSON.stringify({ type: "stateAck", sequence: 1 }));
  await until(() => slow.messages.some((m) => m.type === "state"));
  const resumed = slow.messages.find((m) => m.type === "state");
  assert.equal(
    resumed.players.some((p) => p.id === slow.player.id),
    false,
  );
  assert.ok(resumed.etherDelta);
  assert.equal(slow.ws.readyState, WebSocket.OPEN);
});

test("Valid frame ACKs leave the input budget intact; forged/replayed ACK flood remains limited", async (t) => {
  const { app, connect, advance } = await setup(t),
    client = await connect();
  let sequence = 1;
  for (let i = 0; i < 100; i++) {
    advance();
    // Use the entire ordinary 40 commands/second budget, plus one valid ACK.
    client.ws.send(JSON.stringify({ type: "stop" }));
    client.ws.send(JSON.stringify({ type: "stop" }));
    client.ws.send(JSON.stringify({ type: "stateAck", sequence }));
    await until(() => client.server.stateStream.inFlight === null);
    app.broadcast();
    sequence++;
    await until(() => client.messages.some((m) => m.stateSequence === sequence));
  }
  assert.equal(client.ws.readyState, WebSocket.OPEN);
  const closed = once(client.ws, "close");
  for (let i = 0; i < 100; i++) client.ws.send(JSON.stringify({ type: "stateAck", sequence: -1 }));
  await closed;
  assert.notEqual(client.ws.readyState, WebSocket.OPEN);
});

test("A delayed arena turn preserves queued controls without granting forged ACKs a catch-up budget", async (t) => {
  const { app, connect, advance } = await setup(t),
    c = await connect();
  advance(6500);
  app.tick();
  for (let i = 0; i < 65; i++) {
    c.ws.send(
      JSON.stringify({ type: "move", x: 100 + i, y: 300, spawnSerial: c.player.spawnSerial }),
    );
    c.ws.send(JSON.stringify({ type: "viewport", x: 500, y: 400, width: 800, height: 600 }));
  }
  await until(() => c.player.targetX === 164);
  assert.equal(c.ws.readyState, WebSocket.OPEN);
  const closed = once(c.ws, "close");
  for (let i = 0; i < 100; i++) c.ws.send(JSON.stringify({ type: "stateAck", sequence: -1 }));
  await closed;
});

test("Repeated Space and W do not broadcast per input; compact state is a text frame on the next tick", async (t) => {
  const { app, connect, advance } = await setup(t),
    c = await connect(wire.PROTOCOL);
  let snapshots = 0;
  const original = app.arena.snapshot.bind(app.arena);
  app.arena.snapshot = (...args) => {
    snapshots++;
    return original(...args);
  };
  Object.assign(c.player, { mass: 1000, radius: 95, protectedUntil: 0 });
  let handled = 0;
  const handle = app.arena.handleInput.bind(app.arena);
  app.arena.handleInput = (...args) => {
    handled++;
    return handle(...args);
  };
  c.messages.length = 0;
  const types = [];
  c.ws.on("message", (_, binary) => types.push(binary));
  for (let i = 0; i < 12; i++)
    c.ws.send(
      JSON.stringify({ type: "split", spawnSerial: c.player.spawnSerial, sequence: i + 1 }),
    );
  c.ws.send(
    JSON.stringify({
      type: "feed",
      spawnSerial: c.player.spawnSerial,
      sequence: 13,
      x: 3000,
      y: 2000,
    }),
  );
  await until(() => handled === 13);
  assert.equal(snapshots, 0);
  assert.equal(c.messages.filter((m) => m.type === "state").length, 0);
  advance();
  app.tick();
  await until(() => c.messages.some((m) => m.type === "state"));
  assert.equal(snapshots, 1);
  assert.ok(c.messages.find((m) => m.type === "state").playersDelta);
  assert.ok(
    types.every((binary) => !binary),
    "browser JSON.parse receives text, not Blob",
  );
  assert.ok(app.arena.ether.some((orb) => orb.ejected));
});

test("Progress is saved each tick but heavy profile projections coalesce; the latest revision is sent", async (t) => {
  const { app, connect, advance } = await setup(t),
    c = await connect("");
  app.arena.ether = [];
  c.player.protectedUntil = Infinity;
  c.player.nextMassDecayAt = Infinity;
  c.messages.length = 0;
  for (let i = 1; i <= 12; i++) {
    c.player.mass = 1000 + i * 100;
    advance();
    app.tick();
    await until(() => app.profiles.find(c.auth.token).progress.maxMass === c.player.mass);
    await until(() => c.messages.filter((m) => m.type === "state").length >= i);
  }
  await until(() => c.messages.filter((m) => m.type === "state").length >= 12);
  assert.equal(c.messages.filter((m) => m.type === "profile").length, 1);
  advance(1000);
  app.tick();
  await until(() => c.messages.filter((m) => m.type === "profile").length === 2);
  const latest = c.messages.filter((m) => m.type === "profile").at(-1).profile;
  assert.equal(latest.revision, app.profiles.find(c.auth.token).revision);
});

test("Movement snapshots continue while an arena reward waits for durable storage", async (t) => {
  const { app, connect, advance } = await setup(t);
  const c = await connect("");
  c.messages.length = 0;
  app.arena.ether = [];
  // This case isolates a known mass peak while fsync is gated. Clearing the
  // field alone is not enough: the next tick refills it, and a random pickup
  // can advance the saved peak to 1101+ instead of the exact 1100 below.
  app.arena.etherCount = 0;
  c.player.protectedUntil = Infinity;
  c.player.nextMassDecayAt = Infinity;
  const before = app.profiles.find(c.auth.token).progress.maxMass;
  const flush = fs.fsync;
  const step = app.arena.step.bind(app.arena);
  let firstTick = true;
  app.arena.step = at => {
    const events = step(at);
    if (firstTick) events.push({ type: "testContact", playerId: c.player.id });
    firstTick = false;
    return events;
  };
  let release;
  const gate = t.mock.method(fs, "fsync", (fd, callback) => {
    gate.mock.restore();
    release = () => flush(fd, callback);
  });
  try {
    c.player.mass = 1100;
    for (let i = 0; i < 8; i++) {
      advance();
      app.tick();
    }
    await until(() => c.messages.filter(m => m.type === "state").length >= 8);
    // Socket delivery can finish before the async journal write reaches fsync.
    // Wait for the gate itself before releasing it; otherwise release is still
    // undefined and this fixture leaves the durable write blocked forever.
    await until(() => typeof release === "function");
    assert.equal(app.profiles.find(c.auth.token).progress.maxMass, before);
    assert.ok(!c.messages.some(m => m.type === "profile"));
    assert.equal(c.messages.filter(m => m.events?.some(e => e.type === "testContact")).length, 1);
  } finally {
    release?.();
  }
  await until(() => app.profiles.find(c.auth.token).progress.maxMass === 1100);
});

test("A confirmed life can rejoin after the in-flight flush without draining future arena ticks", async (t) => {
  const { app, connect, advance } = await setup(t);
  const c = await connect(""), other = await connect("");
  c.ws.send(JSON.stringify({ type: "leaveLife", spawnSerial: c.player.spawnSerial }));
  await until(() => c.messages.some(m => m.type === "lifeEnded"));
  const lifeId = c.player.lifeId;
  const flush = fs.fsync;
  let release;
  const gate = t.mock.method(fs, "fsync", (fd, callback) => {
    gate.mock.restore();
    release = () => flush(fd, callback);
  });
  try {
    other.player.mass = 1200;
    advance();
    app.tick();
    assert.equal(typeof release, "function");
    c.ws.send(JSON.stringify({ type: "continueLife", lifeId }));
    await new Promise(resolve => setImmediate(resolve));
    // Respawn no longer forces a synchronous fsync over this arena write.
    // Only the respawning player waits; simulation and networking stay live.
    const before = other.messages.filter(m => m.type === "state").length;
    advance();
    app.tick();
    await until(() => other.messages.filter(m => m.type === "state").length > before);
    assert.equal(c.player.dead, true);
    release();
    release = null;
    await until(() => c.messages.some(m => m.type === "continueResult" && m.ok));
    assert.notEqual(c.player.lifeId, lifeId);
  } finally {
    release?.();
  }
});
