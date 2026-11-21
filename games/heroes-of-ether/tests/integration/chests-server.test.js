/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  http = require("node:http"),
  WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
async function setup(t) {
  const app = createGameServer({ arena: new Arena({ etherCount: 0 }), autoTick: false });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const response = await fetch(url + "/api/profile"),
    cookie = response.headers.get("set-cookie").split(";")[0],
    token = cookie.split("=")[1],
    data = await response.json();
  const post = (body, headers = {}) =>
    fetch(url + "/api/chests/open", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const grant = (greatness) => {
    app.profiles.find(token).greatness = greatness;
    app.profiles.applyArenaProgress(
      randomUUID(),
      [{ type: "massPeak", profileId: data.profile.id, mass: 10 }],
      Date.now(),
    );
    app.profiles.prepareChest(token, "novice", randomUUID());
  };
  const connect = (auth = cookie) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: auth } }),
        messages = [];
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        messages.push(m);
        if (m.type === "welcome") resolve({ ws, id: m.id, messages });
      });
    });
  return { app, url, cookie, token, data, post, grant, connect };
}
test("Сундуки HTTP: все десять в профиле, фиксированные награды и параллельный повтор", async (t) => {
  const { app, post, data, grant, token } = await setup(t);
  assert.equal(data.profile.honors.tiers.length, 10);
  assert.equal(data.profile.wallet.bucks, 0);
  assert.equal(app.arena.players.size, 0);
  assert.equal((await post({ chestId: "novice", requestId: randomUUID() })).status, 409);
  grant(100);
  const body = {
    chestId: "novice",
    requestId: randomUUID(),
    coins: 999999,
    items: { meat: 999 },
    profileId: "other",
  };
  const replies = await Promise.all([post(body), post(body)]),
    values = await Promise.all(replies.map((r) => r.json()));
  assert.ok(replies.every((r) => r.status === 200));
  assert.equal(values.filter((r) => r.replay).length, 1);
  assert.deepEqual(app.profiles.find(token).wallet, { coins: 600, crystals: 60, bucks: 5 });
  assert.equal(app.profiles.find(token).inventory.meat, undefined);
  assert.equal((await post({ ...body, requestId: randomUUID() })).status, 409);
  assert.equal(app.arena.players.size, 0);
});
test("Сундук нельзя открыть с другой вкладки арены, в ожидании продолжения или при задержке тела запроса", async (t) => {
  const { app, url, cookie, token, post, grant, connect } = await setup(t);
  grant(100);
  const body = JSON.stringify({ chestId: "novice", requestId: randomUUID() }),
    request = http.request(url + "/api/chests/open", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    });
  t.after(() => request.destroy());
  const received = once(app.httpServer, "request");
  request.write(body.slice(0, 5));
  await received;
  const client = await connect(),
    before = structuredClone(app.profiles.find(token));
  const response = once(request, "response");
  request.end(body.slice(5));
  const [res] = await response;
  res.resume();
  await once(res, "end");
  assert.equal(res.statusCode, 409);
  assert.deepEqual(app.profiles.find(token), before);
  assert.equal((await post({ chestId: "novice", requestId: randomUUID() })).status, 409);
  app.arena.players.get(client.id).dead = true;
  assert.equal((await post({ chestId: "novice", requestId: randomUUID() })).status, 409);
  app.arena.players.get(client.id).dead = false;
  const closed = once(
    [...app.wss.clients].find((ws) => ws.playerId === client.id),
    "close",
  );
  client.ws.close();
  await closed;
  assert.equal((await post({ chestId: "novice", requestId: randomUUID() })).status, 200);
});
test("Сундуки HTTP: авторизация, Origin, закрытые награды и ошибка сохранения", async (t) => {
  const { app, post, grant, token } = await setup(t);
  grant(100);
  const before = structuredClone(app.profiles.find(token)),
    operation = { chestId: "novice", requestId: randomUUID() };
  assert.equal((await post(operation, { Cookie: "" })).status, 401);
  assert.equal((await post(operation, { Origin: "https://elsewhere.invalid" })).status, 403);
  assert.equal((await post(operation, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post({ chestId: "experienced", requestId: randomUUID() })).status, 409);
  const save = app.profiles.save;
  app.profiles.save = () => {
    throw Error("TEST chest disk unavailable");
  };
  assert.equal((await post(operation)).status, 500);
  assert.deepEqual(app.profiles.find(token), before);
  app.profiles.save = save;
  assert.equal((await post(operation)).status, 200);
});
test("Звание от достижения бустеров сразу видит второй игрок, подмена титула игнорируется", async (t) => {
  const { app, token, connect } = await setup(t);
  app.profiles.buy(token, "candy", randomUUID());
  app.profiles.find(token).greatness = 99;
  app.profiles.find(token).progress.boosterUses = 99;
  const client = await connect(),
    other = await connect("");
  client.ws.send(
    JSON.stringify({
      type: "useBooster",
      boosterId: "candy",
      spawnSerial: 0,
      requestId: randomUUID(),
    }),
  );
  // Ждём фактическую доставку звания, а не фиксированную задержку планировщика.
  for (let i = 0; i < 200 && !client.messages.some((m) => m.type === "boosterResult"); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  app.tick(); // autoTick is disabled: room snapshots now follow simulation ticks.
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    const check = () => {
      if (
        other.messages.some(
          (message) =>
            message.type === "state" &&
            message.players.some(
              (player) => player.id === client.id && player.title?.id === "novice",
            ),
        )
      )
        return resolve();
      if (Date.now() >= deadline)
        return reject(new Error("Новое звание не доставлено второму игроку"));
      setTimeout(check, 10);
    };
    check();
  });
  const state = other.messages.filter((m) => m.type === "state").at(-1),
    p = state.players.find((p) => p.id === client.id);
  assert.equal(p.title.id, "novice");
  assert.equal(p.title.degree, 1);
  assert.equal(p.honors, undefined);
  assert.equal(p.wallet, undefined);
  assert.equal(app.profiles.find(token).greatness, 109);
  client.ws.send(
    JSON.stringify({
      type: "title",
      title: { id: "boss", degree: 10 },
      greatness: 1000000,
      chests: { boss: "opened" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(app.profiles.find(token).honors.claimed, 1);
});
