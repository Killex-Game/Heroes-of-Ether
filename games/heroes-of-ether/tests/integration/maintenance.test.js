"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events");
const WebSocket = require("ws"),
  { temporary } = require("../temp");
const { Maintenance } = require("../../src/server/runtime/maintenance");
const { createGameServer } = require("../../src/server/game-server");
test("Обновление: вход HTTP и WS закрыт, статус и ассеты доступны, профиль не создаётся, флаг переживает рестарт", async (t) => {
  const flag = path.join(temporary(t, "maintenance"), "maintenance.enabled"),
    maintenance = new Maintenance({ filePath: flag });
  maintenance.close();
  const app = createGameServer({ maintenance, autoTick: false, testBots: { enabled: false } });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  fs.writeFileSync(flag, "on");
  await maintenance.refresh();
  assert.equal(maintenance.active, true);
  const before = Object.keys(app.profiles.data.profiles).length;
  for (const route of ["/api/profile", "/api/arenas", "/api/arenas/reserve"]) {
    const r = await fetch(url + route, { method: route.endsWith("reserve") ? "POST" : "GET" });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, "MAINTENANCE");
  }
  assert.equal(Object.keys(app.profiles.data.profiles).length, before);
  assert.match(await (await fetch(url)).text(), /Техническое обновление/);
  assert.equal((await fetch(url + "/ui/layout/maintenance.js")).status, 200);
  assert.equal((await (await fetch(url + "/api/service-status")).json()).maintenance, true);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url.replace("http:", "ws:"));
    ws.on("open", () => reject(Error("joined maintenance")));
    ws.on("unexpected-response", (_, res) => {
      assert.equal(res.statusCode, 503);
      res.resume();
      ws.terminate();
      resolve();
    });
    ws.on("error", () => {});
  });
  const restarted = new Maintenance({ filePath: flag });
  assert.equal(restarted.active, true);
  restarted.close();
  fs.unlinkSync(flag);
  await maintenance.refresh();
  assert.equal((await (await fetch(url + "/api/service-status")).json()).maintenance, false);
  assert.equal((await fetch(url + "/api/profile")).status, 200);
});
