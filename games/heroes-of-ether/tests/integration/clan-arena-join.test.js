"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const policy = {
  ...require("../../config/arena-rooms.json"),
  levelGroups: false,
};

async function setup(t, overrides = {}) {
  let at = 5000;
  const start = Date.now();
  const profiles = new ProfileStore({ now: () => start + at });
  const app = createGameServer({
    profiles,
    arenaPolicy: { ...policy, ...overrides },
    autoTick: false,
    now: () => at,
    httpLimits: Object.fromEntries(
      Object.keys(
        require("../../src/server/http/request-rate-limits").HTTP_LIMITS,
      ).map((key) => [key, { capacity: 1000, perSecond: 1000 }]),
    ),
    wallNow: () => start + at,
    testBots: { enabled: false },
  });
  const sockets = [];
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await app.close();
  });
  const player = () => {
    const auth = profiles.open();
    return { ...auth, cookie: `sferorumiya_session=${auth.token}` };
  };
  const api = async (auth, path, input) => {
    const response = await fetch(url + path, {
      method: input ? "POST" : "GET",
      headers: {
        Cookie: auth?.cookie || "",
        ...(input ? { "Content-Type": "application/json" } : {}),
      },
      body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const reserve = (auth, preferredArenaId = null, requestId = randomUUID()) =>
    api(auth, "/api/arena-reservations", { preferredArenaId, requestId });
  const connect = (auth, reservation, overridePath) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(
        url.replace("http:", "ws:") + (overridePath || reservation.wsPath),
        [`ticket.${reservation.ticket}`],
        { headers: { Cookie: auth.cookie } },
      );
      sockets.push(ws);
      const messages = [];
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const value = JSON.parse(raw.toString());
        messages.push(value);
        if (value.type === "welcome") resolve({ ws, messages, welcome: value });
      });
      ws.on("close", (code) => {
        if (!messages.some((m) => m.type === "welcome"))
          reject(Error(`Closed ${code}`));
      });
    });
  const join = async (auth, room) => {
    const response = await reserve(auth, room);
    assert.equal(response.status, 200);
    return connect(auth, response.body);
  };
  return {
    app,
    profiles,
    api,
    player,
    reserve,
    connect,
    join,
    advance: (ms) => {
      at += ms;
    },
  };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Expected server message was not received");
}

function sameClan(env, ...players) {
  for (const a of players) env.profiles.find(a.token).clanId = "test-clan";
}
function follow(env, actor, member, requestId = randomUUID()) {
  return env.api(actor, "/api/arena-reservations", {
    requestId,
    clanMemberId: member.profile.id,
  });
}
test("clan follow joins exact room, keeps reservation idempotency and validates claim", async (t) => {
  const e = await setup(t),
    a = e.player(),
    b = e.player();
  sameClan(e, a, b);
  await e.join(b, "arena-2");
  const id = randomUUID(),
    r = await follow(e, a, b, id);
  assert.equal(r.status, 200);
  assert.equal(r.body.arenaId, "arena-2");
  assert.equal(r.body.redirected, false);
  const again = await follow(e, a, b, id);
  assert.deepEqual(again.body, r.body);
  const c = await e.connect(a, r.body);
  assert.equal(
    e.app.arenaRooms.directory.players.get(a.profile.id).arenaId,
    "arena-2",
  );
  assert(c.welcome);
});
test("clan follow rejects outsiders, self, other level zones, dead players and remnants", async (t) => {
  const e = await setup(t),
    a = e.player(),
    b = e.player();
  await e.join(b, "arena-2");
  assert.equal((await follow(e, a, b)).body.code, "CLAN_ARENA_UNAVAILABLE");
  sameClan(e, a, b);
  assert.equal((await follow(e, a, a)).body.code, "CLAN_ARENA_UNAVAILABLE");
  const pb = e.profiles.find(b.token);
  pb.level = 121;
  assert.equal((await follow(e, a, b)).body.code, "CLAN_ARENA_UNAVAILABLE");
  pb.level = 1;
  const target = [...e.app.rooms.get("arena-2").arena.players.values()].find(
    (p) => p.profileId === pb.id,
  );
  target.dead = true;
  assert.equal((await follow(e, a, b)).body.code, "CLAN_ARENA_UNAVAILABLE");
  target.dead = false;
  target.isRemnant = true;
  assert.equal((await follow(e, a, b)).body.code, "CLAN_ARENA_UNAVAILABLE");
});
test("full clan room does not silently redirect to another room", async (t) => {
  const e = await setup(t),
    a = e.player(),
    b = e.player();
  sameClan(e, a, b);
  await e.join(b, "arena-2");
  for (let i = 0; i < 29; i++)
    assert.equal((await e.reserve(e.player(), "arena-2")).body.arenaId, "arena-2");
  const r = await follow(e, a, b);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "CLAN_ARENA_FULL");
  assert.equal(
    e.app.arenaRooms.directory.players.get(a.profile.id).state,
    "lobby",
  );
});
test("leaving clan or arena between reservation and WebSocket claim revokes entry", async (t) => {
  const e = await setup(t),
    a = e.player(),
    b = e.player();
  sameClan(e, a, b);
  await e.join(b, "arena-2");
  const r = await follow(e, a, b);
  assert.equal(r.status, 200);
  e.profiles.find(a.token).clanId = null;
  assert.equal(
    e.app.arenaRooms.claim(a.profile.id, r.body.arenaId, "wrong-ticket"),
    false,
  );
  assert.equal(
    e.app.arenaRooms.directory.players.get(a.profile.id).state,
    "reserved",
  );
  assert.equal(
    e.app.arenaRooms.claim(a.profile.id, r.body.arenaId, r.body.ticket),
    false,
  );
  assert.equal(
    e.app.arenaRooms.directory.players.get(a.profile.id).state,
    "lobby",
  );
  sameClan(e, a, b);
  const next = await follow(e, a, b);
  assert.equal(next.status, 200);
  const target = [...e.app.rooms.get("arena-2").arena.players.values()].find(
    (p) => p.profileId === b.profile.id,
  );
  target.dead = true;
  assert.equal(
    e.app.arenaRooms.claim(a.profile.id, next.body.arenaId, next.body.ticket),
    false,
  );
});
test("request id cannot be reused with another clan member", async (t) => {
  const e = await setup(t),
    a = e.player(),
    b = e.player(),
    c = e.player();
  sameClan(e, a, b, c);
  await e.join(b, "arena-2");
  await e.join(c, "arena-1");
  const id = randomUUID();
  assert.equal((await follow(e, a, b, id)).status, 200);
  assert.equal((await follow(e, a, c, id)).body.code, "REQUEST_CONFLICT");
});

test("roster projection follows arena presence without a separate poll", async (t) => {
  const e = await setup(t),
    a = e.player(),
    b = e.player();
  const { ClanService } = require("../../src/server/clans/clan-service"),
    {
      xpForLevel,
    } = require("../../src/server/progression/experience-progression");
  for (const auth of [a, b]) {
    const p = e.profiles.find(auth.token);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 5000;
  }
  const clans = new ClanService(e.profiles);
  clans.mutate(a.token, {
    action: "create",
    requestId: randomUUID(),
    name: "Test Clan",
    prefix: "QA",
    emblem: "astral",
    privacy: "open",
    crest: require("../../public/shared/clan-crest-rules").DEFAULT,
  });
  const clanId = e.profiles.find(a.token).clanId;
  clans.mutate(b.token, { action: "apply", clanId, requestId: randomUUID() });
  let r = await e.api(a, "/api/clans?scope=clan");
  assert.equal(r.status, 200);
  assert.equal(
    r.body.mine.members.find((p) => p.id === b.profile.id).canJoinArena,
    false,
  );
  const first = await e.api(a, "/api/clans/updates?parts=members");
  await e.join(b, "arena-2");
  r = await e.api(
    a,
    "/api/clans/updates?parts=members&known=" +
      encodeURIComponent(JSON.stringify(first.body.versions)),
  );
  assert.equal(
    r.body.changes.members.mine.members.find((p) => p.id === b.profile.id)
      .canJoinArena,
    true,
  );
  const target = [...e.app.rooms.get("arena-2").arena.players.values()].find(
    (p) => p.profileId === b.profile.id,
  );
  target.dead = true;
  const last = await e.api(
    a,
    "/api/clans/updates?parts=members&known=" +
      encodeURIComponent(JSON.stringify(r.body.versions)),
  );
  assert.equal(
    last.body.changes.members.mine.members.find((p) => p.id === b.profile.id)
      .canJoinArena,
    false,
  );
});
