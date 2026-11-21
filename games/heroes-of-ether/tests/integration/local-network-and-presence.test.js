/* Несколько клиентов, единое серверное хранилище и присутствие в лобби/арене. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  path = require("node:path");
const WebSocket = require("ws");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { localNetworkUrls } = require("../../src/server/runtime/local-network-addresses");
test("Список адресов LAN исключает loopback и недоступные link-local адреса", () => {
  const nic = (address, internal = false) => ({ address, internal, family: "IPv4" });
  assert.deepEqual(
    localNetworkUrls(3000, {
      loopback: [nic("127.0.0.1", true)],
      lan: [nic("192.168.0.2")],
      other: [nic("169.254.1.2"), nic("192.168.0.2")],
    }),
    ["http://192.168.0.2:3000/"],
  );
});
test("Два профиля и WebSocket-клиента играют вместе, данные на сервере, статус сети истекает", async (t) => {
  let clock = Date.now();
  const filePath = path.join(temporary(t, "lan-profiles"), "profiles.json"),
    profiles = new ProfileStore({ filePath, now: () => clock });
  const app = createGameServer({
    profiles,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    wallNow: () => clock,
  });
  app.httpServer.listen(0, "0.0.0.0");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const register = async () => {
    const response = await fetch(url + "/api/profile"),
      data = await response.json();
    assert.equal(response.status, 200);
    return { profile: data.profile, cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const [a, b] = await Promise.all([register(), register()]);
  assert.notEqual(a.profile.id, b.profile.id);
  assert.deepEqual(app.performanceStatus().online,{arena:0,lobby:2,total:2});
  assert.equal(profiles.publicPlayer(a.profile.id).online, true);
  clock += 60001;
  assert.equal(profiles.publicPlayer(a.profile.id).online, false);
  assert.deepEqual(app.performanceStatus().online,{arena:0,lobby:0,total:0});
  assert.equal((await fetch(url + "/api/presence", { headers: { Cookie: a.cookie } })).status, 200);
  assert.equal(profiles.publicPlayer(a.profile.id).online, true);
  assert.equal((await fetch(url + "/api/presence")).status, 401);
  const connect = async (user) => {
    const ws = new WebSocket(url.replace("http:", "ws:"), {
      headers: { Cookie: user.cookie, Origin: url },
    });
    const welcome = new Promise((resolve, reject) => {
      ws.once("error", reject);
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") resolve(m);
      });
    });
    const data = await welcome;
    return { ws, id: data.id };
  };
  const [ca, cb] = await Promise.all([connect(a), connect(b)]);
  assert.equal(app.arena.players.size, 2);
  assert.deepEqual(app.performanceStatus().online,{arena:2,lobby:0,total:2});
  assert.notEqual(ca.id, cb.id);
  clock += 60001;
  assert.equal(profiles.publicPlayer(a.profile.id).online, true);
  assert.equal(profiles.publicPlayer(b.profile.id).online, true);
  const closedOnServer = [...app.wss.clients].map((ws) => once(ws, "close"));
  const closedOnClients = [once(ca.ws, "close"), once(cb.ws, "close")];
  ca.ws.close();
  cb.ws.close();
  await Promise.all([...closedOnServer, ...closedOnClients]);
  assert.equal(profiles.publicPlayer(a.profile.id).online, false);
  await app.close();
  const reloaded = new ProfileStore({ filePath });
  assert.ok(reloaded.byId(a.profile.id));
  assert.ok(reloaded.byId(b.profile.id));
  assert.equal(reloaded.byId(a.profile.id).progress.session, null);
  assert.equal(reloaded.publicPlayer(a.profile.id).online, false);
});
