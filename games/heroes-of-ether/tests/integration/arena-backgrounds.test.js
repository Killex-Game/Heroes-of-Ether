/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { Arena } = require("../../src/server/arena/arena-simulation"),
  { createGameServer } = require("../../src/server/game-server");
const { THEMES, DEFAULT_ID, choose, themeFor } = require("../../public/shared/arena-backgrounds");
test("Фон: случайный первый выбор, без повторения предыдущего, только известные изображения", () => {
  assert.equal(
    choose(null, () => 0),
    THEMES[0].id,
  );
  assert.equal(
    choose(null, () => 0.99),
    THEMES.at(-1).id,
  );
  for (const theme of THEMES)
    for (const value of [0, 0.5, 0.999, 1])
      assert.notEqual(
        choose(theme.id, () => value),
        theme.id,
      );
  assert.equal(themeFor("https://example.com/arbitrary.png").id, DEFAULT_ID);
});
test("Фон фиксирован при входах, выходах и возрождении, пока есть живой игрок", () => {
  let calls = 0;
  const arena = new Arena({
    etherCount: 0,
    backgroundRandom: () => {
      calls++;
      return 0.99;
    },
  });
  const a = arena.addPlayer(0, "a"),
    first = arena.backgroundId;
  arena.addPlayer(0, "b");
  a.dead = true;
  arena.resetPlayer(a, 1000);
  arena.removePlayer("b");
  arena.step(2000);
  assert.equal(arena.snapshot(2000).backgroundId, first);
  assert.equal(calls, 1);
  arena.removePlayer(a.id);
  arena.snapshot(3000);
  arena.snapshot(4000);
  assert.equal(calls, 1);
  arena.addPlayer(5000, "c");
  assert.notEqual(arena.backgroundId, first);
  assert.equal(calls, 2);
});
test("Последний погибший не удерживает фон: новая жизнь начинает новый период арены", () => {
  const arena = new Arena({ etherCount: 0, backgroundRandom: () => 0 }),
    a = arena.addPlayer(0, "a"),
    first = arena.backgroundId;
  a.dead = true;
  assert.equal(arena.snapshot(100).players.length, 0);
  assert.equal(
    arena.snapshot(100).backgroundId,
    first,
    "пустая арена не перебирает фоны на каждом тике",
  );
  arena.resetPlayer(a, 200);
  assert.notEqual(arena.backgroundId, first);
  const second = arena.backgroundId;
  arena.addPlayer(300, "b");
  assert.equal(arena.backgroundId, second);
});
async function connect(url) {
  const ws = new WebSocket(url),
    messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await once(ws, "open");
  for (let i = 0; i < 100; i++) {
    if (messages.some((m) => m.type === "state")) return { ws, messages };
    await new Promise((r) => setTimeout(r, 10));
  }
  ws.terminate();
  throw Error("No initial snapshot");
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timed out");
}
test("Сеть: общий фон в welcome/state, повторный вход не меняет его, пустая арена выбирает другой", async (t) => {
  const arena = new Arena({ etherCount: 0, backgroundRandom: () => 0.99 }),
    app = createGameServer({ arena, autoTick: false });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "ws://127.0.0.1:" + app.httpServer.address().port,
    clients = [];
  t.after(() => clients.forEach((client) => client.ws.terminate()));
  const a = await connect(url),
    b = await connect(url);
  clients.push(a, b);
  const first = arena.backgroundId;
  for (const client of clients)
    for (const message of client.messages.filter((m) => ["welcome", "state"].includes(m.type)))
      assert.equal(message.backgroundId, first);
  a.ws.send(
    JSON.stringify({ type: "join", name: "Игрок", skinId: "moon-dragon", backgroundId: "astral" }),
  );
  app.broadcast();
  await until(() => b.messages.filter((m) => m.type === "state").length >= 2);
  assert.equal(arena.backgroundId, first);
  a.ws.close();
  await once(a.ws, "close");
  await until(() => [...arena.players.values()].filter((p) => !p.isRemnant).length === 1);
  const c = await connect(url);
  clients.push(c);
  assert.equal(c.messages.find((m) => m.type === "state").backgroundId, first);
  b.ws.close();
  c.ws.close();
  await until(() => [...arena.players.values()].every((p) => p.isRemnant));
  arena.step(Math.max(...[...arena.players.values()].map((p) => p.removeAt)));
  const d = await connect(url);
  clients.push(d);
  assert.notEqual(arena.backgroundId, first);
  assert.equal(d.messages.find((m) => m.type === "state").backgroundId, arena.backgroundId);
});
