/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
async function setup(t) {
  const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => 5000,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const port = app.httpServer.address().port;
  return { app, url: `http://127.0.0.1:${port}`, wsurl: `ws://127.0.0.1:${port}` };
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "welcome") resolve({ ws, id: m.id });
    });
  });
}
function waitState(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(Error("Timed out waiting for state"));
    }, 2000);
    function onMessage(raw) {
      const m = JSON.parse(raw.toString());
      if (m.type === "state" && predicate(m)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(m);
      }
    }
    ws.on("message", onMessage);
  });
}
test("HTTP лобби не создаёт игрока", async (t) => {
  const { app, url } = await setup(t);
  const r = await fetch(url);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Герои Эфира/);
  assert.equal(app.arena.players.size, 0);
});
test("Два настоящих WebSocket-клиента получают один результат поглощения", async (t) => {
  const { app, wsurl } = await setup(t);
  const a = await connect(wsurl),
    b = await connect(wsurl);
  const pa = app.arena.players.get(a.id),
    pb = app.arena.players.get(b.id);
  Object.assign(pa, {
    x: 500,
    y: 500,
    targetX: 500,
    targetY: 500,
    mass: 400,
    radius: radiusForMass(400),
    protectedUntil: 0,
  });
  Object.assign(pb, {
    x: 500,
    y: 500,
    targetX: 500,
    targetY: 500,
    mass: 57,
    radius: radiusForMass(57),
    protectedUntil: 0,
  });
  const waits = [
    waitState(a.ws, (s) => s.events.length === 1),
    waitState(b.ws, (s) => s.events.length === 1),
  ];
  app.tick();
  const [sa, sb] = await Promise.all(waits);
  assert.equal(sa.players.find((p) => p.id === a.id).mass, 445);
  assert.deepEqual(sa, sb);
  assert.equal(
    sa.players.some((p) => p.id === b.id),
    false,
  );
  assert.equal(sa.events[0].gain, 45);
});
test("Отключение оставляет модель, повторное подключение создаёт новую управляемую сферу", async (t) => {
  const { app, wsurl } = await setup(t);
  const a = await connect(wsurl);
  const closed = once(a.ws, "close");
  a.ws.close();
  await closed;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(app.arena.players.has(a.id), false);
  assert.equal(app.arena.players.size, 1);
  assert.equal([...app.arena.players.values()][0].isRemnant, true);
  const b = await connect(wsurl);
  assert.notEqual(a.id, b.id);
  assert.equal(app.arena.players.get(b.id).mass, 20);
});
test("Повреждённый JSON и попытка подменить массу не ломают соединение", async (t) => {
  const { app, wsurl } = await setup(t);
  const a = await connect(wsurl);
  a.ws.send("{bad");
  a.ws.send("null");
  a.ws.send(JSON.stringify({ type: "move", x: 100, y: 100, mass: 999999 }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(app.arena.players.get(a.id).mass, 20);
  assert.equal(a.ws.readyState, WebSocket.OPEN);
});
test("Слишком большое сообщение закрывает соединение", async (t) => {
  const { wsurl } = await setup(t);
  const a = await connect(wsurl);
  const closed = once(a.ws, "close");
  a.ws.send("x".repeat(3000));
  const [code] = await closed;
  assert.equal(code, 1009);
});
test("Статический сервер не отдаёт server.js и выход за public", async (t) => {
  const { url } = await setup(t);
  assert.equal((await fetch(url + "/server.js")).status, 404);
  const r = await fetch(url + "/%2e%2e%2fserver.js");
  assert.equal(r.status, 403);
  assert.equal((await fetch(url + "/%zz")).status, 400);
});
test("Не разрешается WebSocket с посторонним Origin", async (t) => {
  const { app, wsurl } = await setup(t);
  const ws = new WebSocket(wsurl, { origin: "https://other.invalid" });
  const [error] = await once(ws, "error");
  assert.match(error.message, /403/);
  assert.equal(app.arena.players.size, 0);
});
