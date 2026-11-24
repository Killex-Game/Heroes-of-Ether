/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { HTTP_LIMITS } = require("../../src/server/http/request-rate-limits");
const { temporary } = require("../temp");

async function setup(t, options = {}) {
  const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    ...options,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  return { app, url: `http://127.0.0.1:${app.httpServer.address().port}` };
}

test("Доступность арены: проверка без записей, блокировка при ошибке сохранения и восстановление", async (t) => {
  const { app, url } = await setup(t);
  const read = () => fetch(url + "/api/arena/availability");
  const before = structuredClone(app.profiles.data);
  for (let i = 0; i < 3; i++) {
    const response = await read();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ready: true });
  }
  assert.deepEqual(app.profiles.data, before);
  assert.equal(app.arena.players.size, 0);
  assert.equal(app.wss.clients.size, 0);

  const commit = app.profiles.applyArenaProgress;
  let attempts = 0;
  app.profiles.applyArenaProgress = () => {
    attempts++;
    throw Error("simulated disk failure");
  };
  t.after(() => {
    app.profiles.applyArenaProgress = commit;
  });
  app.tick();
  for (let i = 0; i < 3; i++) {
    const response = await read();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "3");
    assert.deepEqual(await response.json(), { ready: false });
  }
  assert.equal(attempts, 1, "readiness polling must not retry disk writes");
  assert.deepEqual(app.profiles.data, before);
  app.profiles.applyArenaProgress = commit;
  app.tick();
  const recovered = await read();
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { ready: true });
  assert.equal(app.arena.players.size, 0);
});

test("API: ограничение создания профилей, Retry-After и невозможность обхода через X-Forwarded-For", async (t) => {
  let time = 0;
  const { app, url } = await setup(t, {
    rateNow: () => time,
    httpLimits: { ...HTTP_LIMITS, registration: { capacity: 1, perSecond: 1 } },
  });
  const first = await fetch(url + "/api/profile"),
    cookie = first.headers.get("set-cookie").split(";")[0];
  assert.equal(first.status, 200);
  await first.json();
  const rejected = await fetch(url + "/api/profile", {
    headers: { "X-Forwarded-For": "203.0.113.1" },
  });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get("retry-after"), "1");
  await rejected.json();
  assert.equal(Object.keys(app.profiles.data.profiles).length, 1);
  const existing = await fetch(url + "/api/profile", { headers: { Cookie: cookie } });
  assert.equal(existing.status, 200);
  await existing.json();
  time = 1000;
  const second = await fetch(url + "/api/profile");
  assert.equal(second.status, 200);
  await second.json();
  assert.equal(Object.keys(app.profiles.data.profiles).length, 2);
});

test("Лимит POST проверяется до выполнения мутаций, чтение профиля остаётся доступно", async (t) => {
  const { app, url } = await setup(t, {
    rateNow: () => 0,
    httpLimits: { ...HTTP_LIMITS, mutation: { capacity: 1, perSecond: 1 } },
  });
  const opened = app.profiles.open(),
    before = structuredClone(app.profiles.find(opened.token));
  const headers = {
    Cookie: `sferorumiya_session=${opened.token}`,
    "Content-Type": "application/json",
  };
  const post = () =>
    fetch(url + "/api/shop/buy", {
      method: "POST",
      headers,
      body: JSON.stringify({ boosterId: "missing", requestId: randomUUID() }),
    });
  const first = await post();
  assert.notEqual(first.status, 429);
  await first.json();
  const second = await post();
  assert.equal(second.status, 429);
  await second.json();
  assert.deepEqual(app.profiles.find(opened.token), before);
  const read = await fetch(url + "/api/profile", { headers });
  assert.equal(read.status, 200);
  await read.json();
});

test("WebSocket: частые переподключения ограничены до создания новой жизни", async (t) => {
  const { app, url } = await setup(t, {
    rateNow: () => 0,
    httpLimits: { ...HTTP_LIMITS, upgrade: { capacity: 1, perSecond: 1 } },
  });
  const first = new WebSocket(url);
  await once(first, "open");
  const second = new WebSocket(url);
  const [error] = await once(second, "error");
  assert.match(error.message, /429/);
  assert.equal(app.arena.players.size, 1);
});

test("Статические файлы: HEAD без тела, поток передаёт байты без изменения", async (t) => {
  const root = temporary(t, "static-audit"),
    data = Buffer.alloc(2 * 1024 * 1024, 113);
  fs.writeFileSync(path.join(root, "large.png"), data);
  const { url } = await setup(t, { publicDir: root });
  const head = await fetch(url + "/large.png", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(+head.headers.get("content-length"), data.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const get = await fetch(url + "/large.png");
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), data);
  const missing = await fetch(url + "/missing.png");
  assert.equal(missing.status, 404);
  await missing.text();
});

test("MP3: MIME, полная загрузка и диапазоны для перемотки/повтора, неверные границы", async (t) => {
  const root = temporary(t, "music-range"),
    data = Buffer.from("0123456789");
  fs.writeFileSync(path.join(root, "track.mp3"), data);
  const { url } = await setup(t, { publicDir: root });
  const full = await fetch(url + "/track.mp3");
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), data);
  for (const [range, first, last] of [
    ["bytes=0-1", 0, 1],
    ["bytes=5-", 5, 9],
    ["bytes=-3", 7, 9],
    ["bytes=8-99", 8, 9],
  ]) {
    const result = await fetch(url + "/track.mp3", { headers: { Range: range } });
    assert.equal(result.status, 206);
    assert.equal(result.headers.get("content-range"), `bytes ${first}-${last}/10`);
    assert.equal(Number(result.headers.get("content-length")), last - first + 1);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), data.subarray(first, last + 1));
  }
  for (const range of [
    "bytes=10-",
    "bytes=5-1",
    "bytes=-0",
    "bytes=-",
    "bytes=999999999999999999999-",
  ]) {
    const result = await fetch(url + "/track.mp3", { headers: { Range: range } });
    assert.equal(result.status, 416);
    assert.equal(result.headers.get("content-range"), "bytes */10");
    assert.equal((await result.arrayBuffer()).byteLength, 0);
  }
  const head = await fetch(url + "/track.mp3", { method: "HEAD", headers: { Range: "bytes=0-1" } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("Остановка: повтор безопасен, итог активной жизни сохранён на диск до завершения close", async (t) => {
  let time = 0;
  const filePath = path.join(temporary(t, "shutdown-audit"), "profiles.json"),
    profiles = new ProfileStore({ filePath });
  const { app, url } = await setup(t, { profiles, now: () => time });
  const opened = profiles.open(),
    ws = new WebSocket(url, { headers: { Cookie: `sferorumiya_session=${opened.token}` } });
  await once(ws, "open");
  const player = [...app.arena.players.values()][0];
  player.mass = 1000;
  player.radius = radiusForMass(1000);
  app.tick();
  for (time = 50; time <= 30000; time += 50) app.tick();
  time = 30000;
  app.tick();
  time = 65000;
  const first = app.close();
  assert.equal(first, app.close());
  await first;
  assert.equal(app.arena.players.size, 0);
  assert.deepEqual(app.tick(), []);
  const saved = new ProfileStore({ filePath }).find(opened.token);
  assert.equal(saved.progress.session, null);
  assert.equal(saved.progress.lastLife.durationSeconds, 65);
  assert.equal(saved.progress.lastLife.earnedXp, 1);
});

test("Тело POST, завершённое после начала остановки, не меняет профиль", async (t) => {
  const { app, url } = await setup(t);
  const opened = app.profiles.open(),
    before = structuredClone(app.profiles.find(opened.token));
  const body = JSON.stringify({ boosterId: "donut", requestId: randomUUID() });
  const request = http.request(url + "/api/shop/buy", {
    method: "POST",
    headers: {
      Cookie: `sferorumiya_session=${opened.token}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  });
  t.after(() => request.destroy());
  const received = once(app.httpServer, "request");
  request.write(body.slice(0, 5));
  await received;
  const response = once(request, "response"),
    closing = app.close();
  request.end(body.slice(5));
  const [res] = await response;
  res.resume();
  await once(res, "end");
  assert.equal(res.statusCode, 503);
  await closing;
  assert.deepEqual(app.profiles.find(opened.token), before);
});

test("Незавершённый HTTP-запрос не удерживает остановку бесконечно", async (t) => {
  const { app, url } = await setup(t, { shutdownGraceMs: 30 });
  const request = http.request(url + "/api/shop/buy", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": 100 },
  });
  request.on("error", () => {});
  t.after(() => request.destroy());
  const received = once(app.httpServer, "request");
  request.write("{");
  await received;
  // ECONNRESET ожидаем: сервер завершает зависшее тело по крайнему сроку.
  const closed = new Promise((resolve) => request.once("close", resolve)),
    start = performance.now();
  await app.close();
  await closed;
  assert.ok(performance.now() - start < 1500);
});

test("Остановка до listen безопасна; ошибка последнего сохранения не выдаётся за успех", async () => {
  const neverStarted = createGameServer({ autoTick: false });
  await neverStarted.close();
  const profiles = new ProfileStore(),
    opened = profiles.open();
  const app = createGameServer({ profiles, arena: new Arena({ etherCount: 0 }), autoTick: false });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const ws = new WebSocket(`ws://127.0.0.1:${app.httpServer.address().port}`, {
    headers: { Cookie: `sferorumiya_session=${opened.token}` },
  });
  await once(ws, "open");
  profiles.applyArenaProgress = () => {
    throw Error("simulated disk failure");
  };
  await assert.rejects(app.close(), /не удалось сохранить/);
  assert.equal(app.httpServer.listening, false);
  assert.equal(app.wss.clients.size, 0);
});

test("Индекс профилей возвращает свежий объект после транзакции и видит новые аккаунты", () => {
  const store = new ProfileStore(),
    a = store.open(),
    original = store.byId(a.profile.id);
  const b = store.open();
  assert.equal(store.byId(b.profile.id), store.find(b.token));
  store.save({
    ...store.data,
    profiles: Object.fromEntries(
      Object.entries(store.data.profiles).map(([key, p]) => [
        key,
        p.id === a.profile.id ? { ...p, revision: p.revision + 1 } : p,
      ]),
    ),
  });
  assert.notEqual(store.byId(a.profile.id), original);
  assert.equal(store.byId(a.profile.id), store.find(a.token));
  assert.equal(store.byId("absent"), undefined);
});
