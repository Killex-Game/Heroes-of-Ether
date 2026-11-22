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

test("emote socket path stays transient and isolated to the sender's arena", async t => {
  const env = await setup(t);
  const a = await env.join(env.player(), "arena-1"), b = await env.join(env.player(), "arena-1"), c = await env.join(env.player(), "arena-2");
  const player = env.app.rooms.get("arena-1").arena.players.get(a.welcome.id);
  const before = structuredClone(env.profiles.data);
  const save = t.mock.method(env.profiles, "save");
  const emit = index => a.ws.send(JSON.stringify({ type: "emote", index, spawnSerial: player.spawnSerial, playerId: c.welcome.id }));
  emit(8); await until(() => b.messages.some(m => m.type === "emote"));
  assert.equal(b.messages.find(m => m.type === "emote").playerId, a.welcome.id);
  emit(1);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(b.messages.filter(m => m.type === "emote").length, 1);
  env.advance(5000); emit(9);
  await until(() => b.messages.filter(m => m.type === "emote").length === 2);
  assert.equal(b.messages.filter(m => m.type === "emote")[1].index, 9);
  assert.equal(c.messages.filter(m => m.type === "emote").length, 0);
  assert.equal(save.mock.callCount(), 0); assert.deepEqual(env.profiles.data, before);
  save.mock.restore();
});
test("only current authoritative Premium selects pet emotions; VIP and spoofed variants stay basic", async t => {
  const env=await setup(t),auth=env.player(),joined=await env.join(auth,'arena-1');
  const p=env.app.rooms.get('arena-1').arena.players.get(joined.welcome.id);
  const profile=env.profiles.find(auth.token);
  const emit=async()=>{
    const count=joined.messages.filter(m=>m.type==='emote').length;
    joined.ws.send(JSON.stringify({type:'emote',index:6,spawnSerial:p.spawnSerial,variant:'pets',premium:true}));
    await until(()=>joined.messages.filter(m=>m.type==='emote').length>count);
    return joined.messages.filter(m=>m.type==='emote').at(-1).variant;
  };
  assert.equal(await emit(),'basic');
  profile.account ||= {};
  profile.account.vipUntil=Date.now()+86400000;env.advance(5000);
  assert.equal(await emit(),'basic');
  profile.account.premiumUntil=Date.now()+86400000;env.advance(5000);
  assert.equal(await emit(),'pets');
  profile.account.premiumUntil=1;env.advance(5000);
  assert.equal(await emit(),'basic');
});
