"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws"),
  http = require("node:http");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { OwnerAccess } = require("../../src/server/admin/owner-access"),
  { Arena } = require("../../src/server/arena/arena-simulation");
async function setup(t) {
  const profiles = new ProfileStore(),
    a = profiles.open(),
    b = profiles.open(),
    access = new OwnerAccess({ ownerId: a.profile.id });
  const app = createGameServer({
    profiles,
    ownerAccess: access,
    autoTick: false,
    arena: new Arena({ etherCount: 0 }),
    testBots: { enabled: false },
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`,
    ownerCookie = `sferorumiya_session=${a.token}`,
    targetCookie = `sferorumiya_session=${b.token}`;
  let adminCookie = "",
    csrf = "";
  async function request(route, body, opts = {}) {
    const res = await fetch(url + route, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: opts.cookie ?? ownerCookie + "; " + adminCookie,
        Origin: url,
        ...(body ? { "Content-Type": "application/json", "X-Owner-CSRF": csrf } : {}),
        ...opts.headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, headers: res.headers, data: await res.json() };
  }
  async function login() {
    const res = await request("/api/admin/setup", {
      password: "Long password test 2026",
      setupCode: access.bootstrapCode,
    });
    assert.equal(res.status, 200);
    adminCookie = res.headers.get("set-cookie").split(";")[0];
    csrf = res.data.csrf;
  }
  const command = (extra) => ({
    action: "wallet",
    targetId: b.profile.id,
    revision: profiles.byId(b.profile.id).revision,
    moderationRevision: profiles.byId(b.profile.id).moderation?.version || 0,
    reason: "Проверка модерации",
    currency: "coins",
    amount: 25,
    requestId: randomUUID(),
    ...extra,
  });
  return { app, profiles, a, b, access, url, request, login, command, ownerCookie, targetCookie };
}
test("HTTP owner boundary, setup, CSRF, immutable ID and reserved nickname", async (t) => {
  const f = await setup(t);
  assert.equal(
    (await f.request("/api/admin/status", null, { cookie: f.targetCookie })).status,
    403,
  );
  assert.equal((await f.request("/api/admin/players")).status, 401);
  await f.login();
  assert.equal(
    (await f.request("/api/admin/players", null, { cookie: f.targetCookie })).status,
    403,
  );
  const players = await f.request("/api/admin/players");
  assert.equal(players.status, 200);
  assert.equal(players.data.total, 2);
  assert.ok(!JSON.stringify(players.data).includes(f.a.token));
  assert.ok(!JSON.stringify(players.data).includes("receipts"));
  const cmd = f.command({});
  assert.equal(
    (await f.request("/api/admin/action", cmd, { headers: { "X-Owner-CSRF": "invalid" } })).status,
    403,
  );
  assert.equal(
    (await f.request("/api/admin/action", cmd, { headers: { Origin: "http://evil.example" } }))
      .status,
    403,
  );
  assert.equal(
    (await f.request("/api/admin/action", cmd, { headers: { Origin: "" } })).status,
    403,
  );
  assert.equal((await f.request("/api/admin/action", cmd)).status, 200);
  assert.equal((await f.request("/api/admin/action", cmd)).data.duplicate, true);
  assert.equal(
    (
      await f.request(
        "/api/profile/personal",
        { name: "SuperKILLEX", gender: "male", expectedName: "Путник", requestId: randomUUID() },
        { cookie: f.targetCookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.request("/api/admin/action", f.command({ action: "rename", name: "Killex" }))).status,
    403,
  );
  f.profiles.byId(f.a.profile.id).name = "Переименованный";
  assert.equal((await f.request("/api/admin/players")).status, 200);
});

test('player tabs and mass gifts use authenticated owner routes, durable delivery and private acknowledgements', async t => {
  const f = await setup(t);
  assert.equal((await f.request('/api/admin/game-grants')).status,401);
  await f.login();
  await f.request('/api/presence',null,{cookie:f.targetCookie});
  const online=await f.request('/api/admin/players?view=online&sort=level&order=desc');
  assert.equal(online.status,200);assert.ok(online.data.players.some(p=>p.id===f.b.profile.id));
  const input={title:'Спасибо!',message:'Подарок от игры.',rewards:[{kind:'currency',id:'crystals',amount:10}]};
  assert.equal((await f.request('/api/admin/game-grants/preview',input,{headers:{'X-Owner-CSRF':'wrong'}})).status,403);
  const preview=await f.request('/api/admin/game-grants/preview',input);assert.equal(preview.status,200);assert.equal(preview.data.recipients,2);
  const body={previewId:preview.data.previewId,requestId:randomUUID(),confirmed:true};
  const sent=await f.request('/api/admin/game-grants/send',body);assert.equal(sent.status,200);
  assert.equal((await f.request('/api/admin/game-grants/send',body)).data.duplicate,true);
  const until=Date.now()+8000;
  while(!f.profiles.byId(f.b.profile.id).gameGiftNotices?.length && Date.now()<until) await new Promise(r=>setTimeout(r,100));
  assert.equal(f.profiles.byId(f.b.profile.id).gameGiftNotices.length,1);
  const ack={id:sent.data.campaign.id,requestId:randomUUID()};
  const result=await f.request('/api/profile/game-gifts/read',ack,{cookie:f.targetCookie});assert.equal(result.status,200);assert.equal(result.data.profile.gameGiftNotices.length,0);
  assert.equal(f.profiles.byId(f.a.profile.id).gameGiftNotices.length,1);
});

test("Transaction journal is owner-only, isolated per player and safe after a repeated request", async (t) => {
  const f = await setup(t),
    route = "/api/admin/transactions?targetId=" + f.b.profile.id;
  assert.equal((await f.request(route)).status, 401);
  assert.equal((await f.request(route, null, { cookie: f.targetCookie })).status, 403);
  await f.login();
  const cmd = f.command({ currency: "bucks", amount: 20 });
  await f.request("/api/admin/action", cmd);
  // Клиент повторяет тот же запрос после потери ответа.
  await f.request("/api/admin/action", cmd);
  const value = await f.request(route + "&filter=bucks");
  assert.equal(value.status, 200);
  assert.equal(value.data.total, 1);
  assert.equal(value.data.entries[0].after.bucks - value.data.entries[0].before.bucks, 20);
  assert.equal(value.data.playerId, f.b.profile.id);
  assert.ok(!JSON.stringify(value.data).includes(f.b.token));
  assert.equal((await f.request(route, null, { cookie: f.targetCookie })).status, 403);
  assert.equal(
    (await f.request(route, null, { headers: { Origin: "http://evil.example" } })).status,
    403,
  );
  assert.equal((await f.request("/api/admin/transactions?targetId=unknown")).status, 404);
});
test("Live ban disconnects once, preserves life, blocks HTTP/WS, unban restores access", async (t) => {
  const f = await setup(t);
  await f.login();
  const ws = new WebSocket(f.url.replace("http:", "ws:"), { headers: { Cookie: f.targetCookie } }),
    messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw)));
  await once(ws, "open");
  const closed = once(ws, "close"),
    cmd = f.command({ action: "ban", minutes: 60 });
  const res = await f.request("/api/admin/action", cmd);
  assert.equal(res.status, 200);
  assert.equal((await closed)[0], 4003);
  assert.equal(messages.filter((m) => m.type === "accountBanned").length, 1);
  assert.equal(
    [...f.app.arena.players.values()].some((p) => p.profileId === f.b.profile.id),
    false,
  );
  assert.equal(f.profiles.byId(f.b.profile.id).progress.session, null);
  assert.equal((await f.request("/api/admin/action", cmd)).data.duplicate, true);
  for (const route of [
    "/api/profile",
    "/api/arena/availability",
    "/api/presence",
    "/api/clans/chat",
  ]) {
    const r = await f.request(route, null, { cookie: f.targetCookie });
    assert.equal(r.status, 403);
    assert.equal(r.data.code, "ACCOUNT_BANNED");
  }
  assert.equal(
    (await f.request("/api/access", null, { cookie: f.targetCookie })).data.blocked,
    true,
  );
  const details = (await f.request("/api/access", null, { cookie: f.targetCookie })).data;
  assert.equal(details.moderatorName, "Killex");
  assert.equal(details.banId, res.data.player.ban.id);
  assert.match(details.banId, /^[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(
    (
      await f.request(
        "/api/shop/buy",
        { boosterId: "candy", requestId: randomUUID() },
        { cookie: f.targetCookie },
      )
    ).status,
    403,
  );
  await new Promise((resolve, reject) => {
    const denied = new WebSocket(f.url.replace("http:", "ws:"), {
      headers: { Cookie: f.targetCookie },
    });
    denied.on("unexpected-response", (_, r) => {
      assert.equal(r.statusCode, 403);
      r.resume();
      denied.terminate();
      resolve();
    });
    denied.on("error", () => {});
    denied.on("open", () => {
      denied.terminate();
      reject(Error("Ban bypassed"));
    });
  });
  assert.equal((await f.request("/api/admin/action", f.command({ action: "unban" }))).status, 200);
  assert.equal((await f.request("/api/profile", null, { cookie: f.targetCookie })).status, 200);
});
test("An in-flight game mutation is rejected if a ban arrives before its body", async (t) => {
  const f = await setup(t);
  await f.login();
  const body = JSON.stringify({ boosterId: "candy", requestId: randomUUID() });
  let finish;
  const response = new Promise((resolve, reject) => {
    const req = http.request(
      f.url + "/api/shop/buy",
      {
        method: "POST",
        headers: {
          Cookie: f.targetCookie,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.flushHeaders();
    req.write(body.slice(0, 1));
    finish = () => req.end(body.slice(1));
  });
  assert.equal(
    (await f.request("/api/admin/action", f.command({ action: "ban", minutes: null }))).status,
    200,
  );
  const coins = f.profiles.byId(f.b.profile.id).wallet.coins;
  finish();
  assert.equal(await response, 403);
  assert.equal(f.profiles.byId(f.b.profile.id).wallet.coins, coins);
});

test("performance diagnostics require the separate owner session and never mutate profiles", async t => {
  const f = await setup(t), route = "/api/admin/performance";
  assert.equal((await f.request(route)).status, 401);
  assert.equal((await f.request(route, null, { cookie: f.targetCookie })).status, 403);
  await f.login();
  const before = JSON.stringify(f.profiles.data);
  const response = await f.request(route);
  assert.equal(response.status, 200);
  assert.equal(response.data.arena.activePlayers, 0);
  assert.equal(response.data.persistence.queuedActions, 0);
  assert.equal(response.data.tickWorkMs.count, 0);
  assert.ok(response.data.memoryMiB.resident > 0);
  assert.equal(JSON.stringify(f.profiles.data), before);
  assert.ok(!JSON.stringify(response.data).includes(f.a.token));
  assert.ok(!JSON.stringify(response.data).includes(f.a.profile.id));
});

test("payment reports require owner authorization, exclude simulations from revenue and do not expose session tokens",async t=>{
 const f=await setup(t),route="/api/admin/payments";
 assert.equal((await f.request(route)).status,401);assert.equal((await f.request(route,null,{cookie:f.targetCookie})).status,403);
 await f.login();
 f.profiles.confirmMockPurchase(f.b.token,{productId:"coins:handful",confirmed:true,requestId:randomUUID()});
 const before=JSON.stringify(f.profiles.data),real=await f.request(route),simulation=await f.request(route+"?mode=test");
 assert.equal(real.status,200);assert.equal(real.data.summary.votes,0);assert.equal(real.data.summary.netProfit,null);
 assert.equal(simulation.status,200);assert.equal(simulation.data.summary.votes,1);assert.equal(simulation.data.entries[0].playerId,f.b.profile.id);
 assert.equal(JSON.stringify(f.profiles.data),before);assert.ok(!JSON.stringify(simulation.data).includes(f.b.token));
 assert.equal((await f.request(route+"?mode=all")).status,400);
 await f.request("/api/admin/logout",{});assert.equal((await f.request(route)).status,401);
});
