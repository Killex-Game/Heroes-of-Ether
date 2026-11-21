"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  E = require("../../src/server/events/easter-hunt"),
  { Arena } = require("../../src/server/arena/arena-simulation");
test("E по WebSocket: бабочка перед шапкой, повторы, новая жизнь, обрыв и снятие аксессуаров", async (t) => {
  let time = 0;
  const at = Date.UTC(2026, 9, 28, 12),
    profiles = new ProfileStore({ now: () => at + time }),
    events = new EventManager({ now: () => at + time }),
    auth = profiles.open();
  profiles.events = events;
  events.apply("test", "start", { eventId: E.manifest.id, revision: 0, requestId: randomUUID() });
  profiles.applyArenaProgress(
    randomUUID(),
    [{ type: "easterPickup", eggType: 0, runId: events.active().id, profileId: auth.profile.id }],
    at,
  );
  const profile = profiles.find(auth.token),
    run = profile.easter.runs[events.active().id];
  profile.level = 40;
  profile.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(40);
  run.fragmentCounts = Array(48).fill(1);
  run.fragments = 48;
  profile.easter.trophies = [{ runId: events.active().id, at, collectionVersion: 2 }];
  profiles.setAccessory(auth.token, {
    slot: "bow",
    accessoryId: "carrot_bow",
    requestId: randomUUID(),
  });
  const preview = require("../../config/accessory-preview.json");
  preview.profileIds.push(profile.id);
  t.after(() => preview.profileIds.splice(preview.profileIds.indexOf(profile.id), 1));
  profiles.setAccessory(auth.token, {
    slot: "hat",
    accessoryId: "baker_hat",
    requestId: randomUUID(),
  });
  profiles.find(auth.token).accessoryAbility = "baker_hat";
  const inventory = structuredClone(profiles.find(auth.token).inventory);
  const app = createGameServer({
    profiles,
    events,
    arena: new Arena({ etherCount: 0 }),
    testBots: { enabled: false },
    autoTick: false,
    now: () => time,
    wallNow: () => at + time,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "ws://127.0.0.1:" + app.httpServer.address().port;
  async function connect() {
    const ws = new WebSocket(url, { headers: { Cookie: "sferorumiya_session=" + auth.token } });
    t.after(() => ws.terminate());
    const welcome = await new Promise((resolve) =>
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") resolve(m);
      }),
    );
    return { ws, p: app.arena.players.get(welcome.id) };
  }
  function send(client, message, type = "accessoryBoosterResult") {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Missing " + type)), 2500);
      function receive(raw) {
        const m = JSON.parse(raw);
        if (m.type === type && (!message.requestId || m.requestId === message.requestId)) {
          clearTimeout(timer);
          client.ws.off("message", receive);
          resolve(m);
        }
      }
      client.ws.on("message", receive);
      client.ws.send(JSON.stringify(message));
    });
  }
  const client = await connect(),
    p = client.p;
  assert.equal(p.accessoryAbilities.stock[0].count, 3);
  const use = {
    type: "useAccessoryBooster",
    accessoryId: "carrot_bow",
    spawnSerial: p.spawnSerial,
    requestId: randomUUID(),
    boosterId: "rocket",
    count: 999,
  };
  assert.deepEqual(
    p.accessoryAbilities.stock.map((x) => x.accessoryId),
    ["carrot_bow", "baker_hat"],
  );
  const hat = { ...use, accessoryId: "baker_hat", requestId: randomUUID(), aimX: p.x + 500, aimY: p.y };
  assert.equal((await send(client, hat)).ok, false);
  assert.equal(p.accessoryAbilities.stock[1].count, 3);
  assert.equal((await send(client, use)).ok, true);
  assert.equal(p.effects.easter_egg, 10000);
  time = 500;
  assert.equal((await send(client, use)).replay, true);
  assert.equal(p.effects.easter_egg, 10000);
  assert.equal((await send(client, { ...use, spawnSerial: 999, requestId: randomUUID() })).ok, false);
  for (const remaining of [1, 0]) {
    time += 11000;
    assert.equal((await send(client, hat)).ok, false);
    assert.equal((await send(client, { ...use, requestId: randomUUID() })).remaining, remaining);
  }
  assert.equal((await send(client, { ...use, requestId: randomUUID() })).ok, false);
  time += 1000;
  const hatResult = await send(client, hat);
  assert.equal(hatResult.ok, true, JSON.stringify(hatResult));
  assert.equal(hatResult.remaining, 2);
  assert.equal((await send(client, hat)).replay, true);
  assert.equal((await send(client, use)).replay, true);
  for (const remaining of [1, 0]) {
    time += 15000;
    assert.equal((await send(client, { ...hat, requestId: randomUUID() })).remaining, remaining);
  }
  assert.equal((await send(client, { ...hat, requestId: randomUUID() })).ok, false);
  assert.deepEqual(
    p.accessoryAbilities.stock.map((x) => x.count),
    [0, 0],
  );
  assert.deepEqual(profiles.find(auth.token).inventory, inventory);
  const oldLife = p.lifeId;
  await send(client, { type: "leaveLife", spawnSerial: p.spawnSerial }, "lifeEnded");
  const save = profiles.save;
  profiles.save = () => {
    throw Error("TEST write failed");
  };
  assert.equal(
    (await send(client, { type: "continueLife", lifeId: oldLife }, "continueResult")).ok,
    false,
  );
  assert.equal(p.accessoryAbilities.stock[0].count, 0);
  profiles.save = save;
  assert.equal(
    (await send(client, { type: "continueLife", lifeId: oldLife }, "continueResult")).ok,
    true,
  );
  assert.equal(p.accessoryAbilities.stock[0].count, 3);
  assert.equal(p.accessoryAbilities.stock[1].count, 3);
  assert.equal((await send(client, use)).ok, false);
  assert.equal(
    (await send(client, { ...use, requestId: randomUUID(), spawnSerial: p.spawnSerial })).ok,
    true,
  );
  assert.equal(
    (await send(client, { type: "continueLife", lifeId: oldLife }, "continueResult")).ok,
    true,
  );
  assert.equal(p.accessoryAbilities.stock[0].count, 2);
  client.ws.close();
  await once(client.ws, "close");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const reconnected = await connect();
  assert.notEqual(reconnected.p.lifeId, p.lifeId);
  assert.equal(reconnected.p.accessoryAbilities.stock[0].count, 3);
  reconnected.ws.close();
  await once(reconnected.ws, "close");
  await new Promise((resolve) => setTimeout(resolve, 30));
  profiles.setAccessory(auth.token, { slot: "bow", accessoryId: null, requestId: randomUUID() });
  profiles.setAccessory(auth.token, { slot: "hat", accessoryId: null, requestId: randomUUID() });
  const bare = await connect();
  assert.deepEqual(bare.p.accessoryAbilities.stock, []);
  assert.equal((await send(bare, { ...use, spawnSerial: bare.p.spawnSerial })).ok, false);
});
