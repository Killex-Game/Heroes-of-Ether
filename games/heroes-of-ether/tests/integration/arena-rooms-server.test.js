"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const policy = { ...require("../../config/arena-rooms.json"), levelGroups: false };

async function setup(t, filePath = null) {
  let at = 5000;
  const start = Date.now();
  const profiles = new ProfileStore({ filePath, now: () => start + at });
  const app = createGameServer({
    profiles,
    arenaPolicy: policy,
    autoTick: false,
    now: () => at,
    httpLimits: Object.fromEntries(
      Object.keys(require("../../src/server/http/request-rate-limits").HTTP_LIMITS).map((key) => [
        key,
        { capacity: 1000, perSecond: 1000 },
      ]),
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
        if (!messages.some((m) => m.type === "welcome")) reject(Error(`Closed ${code}`));
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

test("Продолжение жизни не строит внеочередной снимок соседней комнаты", async (t) => {
  const env = await setup(t);
  const actor = await env.join(env.player(), "arena-1");
  const observer = await env.join(env.player(), "arena-1");
  await env.join(env.player(), "arena-2");
  const player = env.app.rooms.get("arena-1").arena.players.get(actor.welcome.id);
  actor.ws.send(JSON.stringify({ type: "leaveLife", spawnSerial: player.spawnSerial }));
  await until(() => actor.messages.some((m) => m.type === "lifeEnded"));
  const other = env.app.rooms.get("arena-2").arena;
  const snapshot = t.mock.method(other, "snapshot");
  const peer = [...env.app.wss.clients].find(ws => ws.playerId === observer.welcome.id);
  const publish = t.mock.method(peer.stateStream, "publish");
  actor.messages.length = 0;
  actor.ws.send(JSON.stringify({ type: "continueLife", lifeId: player.lifeId }));
  await until(() => actor.messages.some((m) => m.type === "continueResult" && m.ok) &&
    actor.messages.some((m) => m.type === "state" && m.players?.some((p) => p.id === player.id)));
  assert.equal(snapshot.mock.callCount(), 0);
  assert.equal(publish.mock.callCount(), 0);
  env.app.tick();
  assert.equal(snapshot.mock.callCount(), 1);
  assert.equal(publish.mock.callCount(), 1);
});

test("Комнаты изолируют снимки, поглощение и чат, сохраняя единый профиль", async (t) => {
  const env = await setup(t),
    a = env.player(),
    b = env.player(),
    c = env.player();
  const ca = await env.join(a, "arena-1"),
    cb = await env.join(b, "arena-2"),
    cc = await env.join(c, "arena-1");
  assert.equal(cb.welcome.arenaId, "arena-2");
  const pa = env.app.rooms.get("arena-1").arena.players.get(ca.welcome.id);
  const pb = env.app.rooms.get("arena-2").arena.players.get(cb.welcome.id);
  Object.assign(pa, { x: 500, y: 500, mass: 1000, targetX: 500, targetY: 500 });
  Object.assign(pb, { x: 500, y: 500, mass: 20, targetX: 500, targetY: 500 });
  env.advance(100);
  env.app.tick();
  await until(() =>
    ca.messages.some((m) => m.type === "state" && m.players?.some((p) => p.id === cc.welcome.id)),
  );
  for (const m of ca.messages.filter((m) => m.type === "state"))
    assert.equal(
      m.players.some((p) => p.id === cb.welcome.id),
      false,
    );
  assert.equal(pb.dead, false);
  ca.ws.send(
    JSON.stringify({ type: "chatSend", text: "Сообщение первой арены", requestId: randomUUID() }),
  );
  await until(() => cc.messages.some((m) => m.type === "chatMessage"));
  assert.equal(
    cb.messages.some((m) => m.type === "chatMessage"),
    false,
  );
  assert.equal(cb.messages.find((m) => m.type === "chatHistory").messages.length, 0);
  const profile = await env.api(a, "/api/profile");
  assert.equal(profile.body.profile.id, a.profile.id);
});

test("Бронь повторяется без второго места, чужой билет и другая комната отклоняются", async (t) => {
  const env = await setup(t),
    a = env.player(),
    b = env.player(),
    id = randomUUID();
  const [one, two] = await Promise.all([
    env.reserve(a, "arena-2", id),
    env.reserve(a, "arena-2", id),
  ]);
  assert.deepEqual(one, two);
  assert.equal(env.app.arenaRooms.directory.roomOccupancy("arena-2"), 1);
  await assert.rejects(env.connect(b, one.body), /409/);
  await assert.rejects(env.connect(a, one.body, "/ws/arena-3"), /409/);
  const joined = await env.connect(a, one.body);
  assert.equal((await env.reserve(a, "arena-3")).status, 409);
  await assert.rejects(env.connect(a, one.body), /409/);
  joined.ws.close();
  await once(joined.ws, "close");
  await until(() => env.app.wss.clients.size === 0);
  const again = await env.reserve(a, "arena-3");
  assert.equal(again.status, 200);
  assert.equal((await env.connect(a, again.body)).welcome.arenaId, "arena-3");
  const rooms = (await env.api(a, "/api/arenas")).body.arenas;
  assert.equal(rooms.find((r) => r.id === "arena-2").playing, 1);
  assert.equal(rooms.find((r) => r.id === "arena-3").playing, 1);
});

test("Повторный вход в ту же комнату создаёт отдельные жизни, модели уходят каждая в свой срок", async (t) => {
  const env = await setup(t),
    a = env.player();
  const room = env.app.rooms.get("arena-1").arena;
  let lastResult;
  for (let i = 0; i < 2; i++) {
    const joined = await env.join(a, "arena-1");
    const original = room.players.get(joined.welcome.id);
    const firstResult = env.profiles.find(a.token).progress.lastLife;
    if (i) assert.deepEqual(firstResult, lastResult);
    joined.ws.send(JSON.stringify({ type: "leaveLife", spawnSerial: original.spawnSerial }));
    await until(() => joined.messages.some((m) => m.type === "lifeEnded"));
    lastResult = structuredClone(env.profiles.find(a.token).progress.lastLife);
    joined.ws.close();
    await once(joined.ws, "close");
    await until(() => env.app.wss.clients.size === 0);
    env.advance(1000);
    env.app.tick();
  }
  const current = await env.join(a, "arena-1");
  const active = room.players.get(current.welcome.id);
  const remnants = [...room.players.values()].filter((p) => p.isRemnant);
  assert.equal(remnants.length, 2);
  const listed = (await env.api(a, "/api/arenas")).body.arenas[0];
  assert.equal(listed.name, "Альфа");
  assert.equal(listed.playing, 3);
  assert.equal(new Set([active.id, ...remnants.map((p) => p.id)]).size, 3);
  assert.ok(remnants.every((p) => !p.profileId && p.departedProfileId === a.profile.id));
  env.advance(14001);
  env.app.tick();
  assert.equal((await env.api(a, "/api/arenas")).body.arenas[0].playing, 2);
  assert.equal(active.dead, false);
  assert.deepEqual(env.profiles.find(a.token).progress.lastLife, lastResult);
  env.advance(1000);
  env.app.tick();
  assert.equal((await env.api(a, "/api/arenas")).body.arenas[0].playing, 1);
  assert.equal(env.profiles.find(a.token).progress.session.id, active.lifeId);
});

test("Оставшаяся модель учитывается в 35 местах, но не занимает дополнительное место профиля в лобби", async (t) => {
  const env = await setup(t),
    a = env.player();
  const joined = await env.join(a, "arena-1");
  joined.ws.terminate();
  await once(joined.ws, "close");
  await until(() => env.app.wss.clients.size === 0);
  for (let i = 0; i < 34; i++)
    assert.equal((await env.reserve(env.player(), "arena-1")).body.arenaId, "arena-1");
  const next = await env.reserve(a, "arena-1");
  assert.equal(next.status, 200);
  assert.equal(next.body.arenaId, "arena-2");
  assert.equal(next.body.name, "Бета");
  assert.equal(next.body.redirected, true);
  assert.equal(env.app.arenaRooms.directory.players.size, 35);
  assert.equal(env.app.arenaRooms.directory.occupancy(), 36);
});

test("Заявки обновляются через присутствие без открытия клана, только для разрешённых ролей", async (t) => {
  const env = await setup(t),
    head = env.player(),
    applicant = env.player();
  const { ClanService } = require("../../src/server/clans/clan-service");
  const clans = new ClanService(env.profiles);
  for (const who of [head, applicant]) {
    const profile = env.profiles.find(who.token);
    profile.level = 12;
    profile.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(
      12,
    );
    profile.wallet.coins = 2000;
  }
  clans.mutate(head.token, {
    action: "create",
    requestId: randomUUID(),
    name: "Проверка",
    prefix: "ТЕСТ",
    description: "",
    emblem: "grove",
    privacy: "closed",
  });
  const clanId = env.profiles.find(head.token).clanId;
  assert.equal((await env.api(head, "/api/presence")).body.menuNotifications.clanApplications, 0);
  clans.mutate(applicant.token, { action: "apply", clanId, requestId: randomUUID() });
  assert.equal((await env.api(head, "/api/presence")).body.menuNotifications.clanApplications, 1);
  assert.equal(
    (await env.api(applicant, "/api/presence")).body.menuNotifications.clanApplications,
    0,
  );
  const member = env.player(),
    profile = env.profiles.find(member.token);
  const clan = env.profiles.data.clans[clanId];
  profile.clanId = clanId;
  clan.members.push(profile.id);
  for (const [role, count] of [
    ["member", 0],
    ["officer", 1],
    ["manager", 1],
  ]) {
    clan.roles[profile.id] = role;
    assert.equal(
      (await env.api(member, "/api/presence")).body.menuNotifications.clanApplications,
      count,
    );
    assert.equal(env.profiles.view(profile).menuNotifications.clanApplications, count);
  }
  clan.competition.recruits[profile.id] = env.profiles.now() + 100000;
  assert.equal((await env.api(member, "/api/presence")).body.menuNotifications.clanApplications, 0);
  clans.mutate(head.token, {
    action: "accept",
    clanId,
    memberId: applicant.profile.id,
    requestId: randomUUID(),
  });
  assert.equal((await env.api(head, "/api/presence")).body.menuNotifications.clanApplications, 0);
});

test("35 мест, перенаправление, расширение до пяти арен и истечение брони", async (t) => {
  const env = await setup(t),
    players = Array.from({ length: 80 }, () => env.player());
  for (const p of players.slice(0, 35))
    assert.equal((await env.reserve(p, "arena-1")).body.arenaId, "arena-1");
  const next = await env.reserve(players[35], "arena-1");
  assert.equal(next.body.arenaId, "arena-2");
  assert.equal(next.body.redirected, true);
  for (const p of players.slice(36)) assert.equal((await env.reserve(p)).status, 200);
  assert.equal(env.app.rooms.size, 5);
  const list = await env.api(players[0], "/api/arenas");
  assert.equal(list.body.arenas.length, 5);
  assert.ok(list.body.arenas.every((room) => room.playing + room.reserved <= 35));
  env.advance(15001);
  const expired = await env.api(players[0], "/api/arenas");
  assert.equal(
    expired.body.arenas.reduce((n, room) => n + room.reserved, 0),
    0,
  );
  assert.equal(env.app.rooms.size, 5);
});

test("Отмена брони не отменяет новую попытку, повтор использованного запроса не создаёт место", async (t) => {
  const env = await setup(t),
    a = env.player(),
    id = randomUUID();
  await env.reserve(a, "arena-1", id);
  await env.api(a, "/api/arena-reservations/cancel", { requestId: id });
  assert.equal((await env.reserve(a, "arena-1", id)).body.code, "RESERVATION_EXPIRED");
  const next = await env.reserve(a, "arena-3");
  await env.api(a, "/api/arena-reservations/cancel", { requestId: id });
  assert.equal((await env.connect(a, next.body)).welcome.arenaId, "arena-3");
});

test("Сохранённый выбор ещё не открытой арены переводит игрока в доступную комнату", async (t) => {
  const env = await setup(t),
    a = env.player();
  const result = await env.reserve(a, "arena-13");
  assert.equal(result.status, 200);
  assert.equal(result.body.redirected, true);
  assert.equal(result.body.arenaId, "arena-1");
});

test("Прогресс двух комнат сохраняется при остановке и восстанавливается из файла", async (t) => {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "sferorumiya-rooms-test-"));
  const filePath = path.join(folder, "profiles.json");
  const env = await setup(t, filePath);
  t.after(async () => {
    await env.app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const a = env.player(),
    b = env.player();
  await env.join(a, "arena-1");
  await env.join(b, "arena-2");
  env.advance(61000);
  env.app.tick();
  await env.app.close();
  const before = structuredClone(env.profiles.data.profiles);
  const restored = new ProfileStore({ filePath, now: env.profiles.now });
  assert.deepEqual(restored.data.profiles, before);
  for (const auth of [a, b])
    assert.ok(restored.find(auth.token).progress.lastLife.durationSeconds >= 61);
});

test("Отказ записи старта освобождает бронь и не создаёт игровую жизнь", async (t) => {
  const env = await setup(t),
    a = env.player();
  const booking = await env.reserve(a, "arena-2");
  const save = env.profiles.save;
  env.profiles.save = () => {
    throw Error("simulated write failure");
  };
  await assert.rejects(env.connect(a, booking.body), /1011/);
  env.profiles.save = save;
  assert.equal(env.app.rooms.get("arena-2").arena.players.size, 0);
  assert.equal(env.app.arenaRooms.directory.roomOccupancy("arena-2"), 0);
  assert.equal((await env.join(a, "arena-2")).welcome.arenaId, "arena-2");
});

test("Отказ сохранения замораживает обе арены, повтор пакета начисляет прогресс один раз", async (t) => {
  const env = await setup(t),
    a = env.player(),
    b = env.player();
  await env.join(a, "arena-1");
  await env.join(b, "arena-2");
  const before = structuredClone(env.profiles.data);
  const save = env.profiles.save;
  env.profiles.save = () => {
    throw Error("simulated write failure");
  };
  env.advance(61000);
  env.app.tick();
  assert.deepEqual(env.profiles.data, before);
  const ticks = [...env.app.rooms.values()].map((room) => room.arena.tick);
  env.app.tick();
  assert.deepEqual(
    [...env.app.rooms.values()].map((room) => room.arena.tick),
    ticks,
  );
  env.profiles.save = save;
  env.app.tick();
  const progress = [a, b].map((auth) => structuredClone(env.profiles.find(auth.token).progress));
  env.app.tick();
  for (const [i, auth] of [a, b].entries())
    assert.deepEqual(env.profiles.find(auth.token).progress, progress[i]);
});
