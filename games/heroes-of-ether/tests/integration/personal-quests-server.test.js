"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { Arena } = require("../../src/server/arena/arena-simulation");
test("quest HTTP authority, actual arena food, disconnect, reward replay and protected rerolls", async (t) => {
  let time = 0;
  const at = Date.UTC(2026, 9, 24, 10),
    profiles = new ProfileStore({ now: () => at + time }),
    auth = profiles.open(),
    get = () => profiles.find(auth.token);
  get().quests.items.at(-1).questId = "snack";
  const questId = get().quests.items.at(-1).id;
  const app = createGameServer({
    profiles,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => time,
    wallNow: () => at + time,
    testBots: { enabled: false },
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`,
    cookie = `sferorumiya_session=${auth.token}`;
  const post = (input, headers = {}) =>
    fetch(url + "/api/quests/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, ...headers },
      body: JSON.stringify({ requestId: randomUUID(), ...input }),
    });
  assert.equal((await post({ action: "claim", questId })).status, 409);
  assert.equal(
    (await post({ action: "claim", questId }, { Origin: "https://outside.invalid" })).status,
    403,
  );
  assert.equal((await post({ action: "claim", questId }, { Cookie: "" })).status, 401);
  const socket = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  t.after(() => socket.terminate());
  const welcome = await new Promise((resolve) =>
    socket.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "welcome") resolve(m);
    }),
  );
  const p = app.arena.players.get(welcome.id);
  assert.equal((await post({ action: "reroll", questId, expectedCost: 0 })).status, 409);
  assert.equal(get().quests.rerolls, 0);
  // Собирается серверной физикой; питомцы и выброшенная по W еда не входят в счётчик.
  p.x = p.targetX = 500;
  p.y = p.targetY = 500;
  app.arena.ether = Array.from({ length: 500 }, (_, i) => ({
    id: `food-${i}`,
    x: 500,
    y: 500,
    value: 1,
    radius: 1,
  }));
  time = 1000;
  app.tick();
  assert.equal(p.questFoodCount, 500);
  assert.equal(get().quests.items.at(-1).progress, 500);
  app.tick();
  assert.equal(get().quests.pending.filter((r) => r.id === questId).length, 1);
  const closed = once([...app.wss.clients][0], "close");
  socket.close();
  await closed;
  assert.equal(get().quests.pending.find((r) => r.id === questId).stored, false);
  assert.equal((await post({ action: "claim", questId, requestId: randomUUID() })).status, 409);
  const receive = { action: "receive", questId, requestId: randomUUID() };
  assert.equal((await post(receive)).status, 200);
  assert.equal((await (await post(receive)).json()).replay, true);
  assert.equal(get().quests.pending.find((r) => r.id === questId).stored, true);
  const reward = structuredClone(get().quests.pending.find((r) => r.id === questId)),
    coins = get().wallet.coins;
  const claim = { action: "claim", questId, requestId: randomUUID(), reward: { coins: 999999 } };
  const notice = { action: "notice", ids: [questId], requestId: randomUUID() };
  assert.equal((await post(notice, { Cookie: "" })).status, 401);
  assert.equal((await post(notice, { Origin: "https://outside.invalid" })).status, 403);
  assert.equal((await post(notice)).status, 200);
  assert.equal((await (await post(notice)).json()).replay, true);
  assert.equal(get().quests.pending.find((r) => r.id === questId).notifiedAt, at + time);
  assert.equal(get().wallet.coins, coins);
  assert.equal((await post(claim)).status, 200);
  assert.equal((await (await post(claim)).json()).replay, true);
  assert.equal(get().wallet.coins, coins + reward.coins);
  assert.equal(
    get().quests.pending.some((r) => r.id === questId),
    false,
  );
  assert.equal((await post({ action: "claim", questId })).status, 409);
  const nextId = get().quests.items[0].id;
  assert.equal((await post({ action: "reroll", questId: nextId, expectedCost: 0 })).status, 200);
  const paid = {
    action: "reroll",
    questId: get().quests.items[0].id,
    expectedCost: 100,
    requestId: randomUUID(),
  };
  assert.equal((await post(paid)).status, 200);
  assert.equal((await post(paid)).status, 200);
  assert.equal(get().wallet.coins, coins + reward.coins - 100);
});
