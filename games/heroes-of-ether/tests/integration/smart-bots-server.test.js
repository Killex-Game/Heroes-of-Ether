"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { createGameServer } = require("../../src/server/game-server");
test("Explicitly enabled bot supplies survive a failed save once, broadcast normally, and reset on reconnect", async (t) => {
  let at = 0;
  const start = Date.parse("2026-10-21T06:00:00Z");
  const profiles = new ProfileStore({ now: () => start + at }),
    user = profiles.open();
  const app = createGameServer({
    profiles,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => at,
    wallNow: () => start + at,
    testBots: { enabled: true },
  });
  await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const url = "ws://127.0.0.1:" + app.httpServer.address().port;
  async function connect() {
    const ws = new WebSocket(url, { headers: { Cookie: "sferorumiya_session=" + user.token } });
    const messages = [];
    const welcome = new Promise((resolve) =>
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        messages.push(m);
        if (m.type === "welcome") resolve(m);
      }),
    );
    const m = await welcome;
    t.after(() => ws.terminate());
    return { ws, messages, human: app.arena.players.get(m.id) };
  }
  const client = await connect();
  assert.equal(app.bots.brain.boostersEnabled, false);
  // Проверяем сохранённую механику для будущего включения, отдельно от текущего запрета.
  app.bots.brain.boostersEnabled = true;
  client.human.protectedUntil = 1e9;
  app.tick();
  const bots = [...app.arena.players.values()].filter((p) => p.isTestBot),
    bot = bots[0];
  const profileBefore = structuredClone(profiles.byId(bot.profileId));
  for (const p of bots) {
    p.protectedUntil = 1e9;
    app.bots.brain.lives.get(p.id).bag = [];
  }
  Object.assign(bot, {
    x: 300,
    y: 300,
    targetX: 300,
    targetY: 300,
    mass: 10,
    radius: radiusForMass(10),
    protectedUntil: 0,
  });
  const state = app.bots.brain.lives.get(bot.id);
  state.bag = ["candy"];
  // This assertion measures candy alone. A randomly placed 50-mass hazard
  // beside the relocated bot otherwise makes the result nondeterministic.
  app.arena.hazards.items = [];
  app.arena.hazards.replenish = () => {};
  const save = profiles.save.bind(profiles);
  profiles.save = () => {
    throw Error("Simulated write failure");
  };
  at = 3000;
  const events = app.tick();
  assert.equal(events.filter((e) => e.type === "boosterUsed").length, 1);
  assert.equal(bot.mass, 160);
  assert.equal(state.used, 1);
  assert.equal(
    profiles.byId(bot.profileId).progress.boosterUses,
    profileBefore.progress.boosterUses,
  );
  profiles.save = save;
  at += 50;
  app.tick();
  await new Promise((r) => setTimeout(r, 25));
  const credited = profiles.byId(bot.profileId);
  assert.equal(credited.progress.boosterUses, profileBefore.progress.boosterUses + 1);
  assert.deepEqual(credited.inventory, profileBefore.inventory);
  assert.deepEqual(credited.wallet, profileBefore.wallet);
  assert.ok(
    client.messages.some(
      (m) =>
        m.type === "state" &&
        m.events?.some((e) => e.type === "boosterUsed" && e.playerId === bot.id),
    ),
  );
  at += 50;
  app.tick();
  assert.equal(state.used, 1);
  assert.equal(
    profiles.byId(bot.profileId).progress.boosterUses,
    profileBefore.progress.boosterUses + 1,
  );
  client.ws.close();
  await once(client.ws, "close");
  for (let i = 0; i < 50 && app.bots.status().activeBots; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(app.bots.status().activeBots, 0);
  assert.equal(app.bots.brain.lives.size, 0);
  assert.ok(Object.values(profiles.data.profiles).every((p) => !p.progress.session));
  await connect();
  at += 50;
  app.tick();
  assert.ok(app.bots.brain.lives.size > 0);
  for (const life of app.bots.brain.lives.values()) {
    assert.equal(life.used, 0);
    assert.equal(life.bag.length, 20);
  }
});

test("Сервер по умолчанию запрещает бустеры ботам, сохраняя движение и прогресс", async (t) => {
  let at = 0;
  const profiles = new ProfileStore({ now: () => Date.parse("2026-10-24T10:00:00Z") + at }),
    app = createGameServer({
      profiles,
      arena: new Arena({ etherCount: 0 }),
      autoTick: false,
      now: () => at,
      wallNow: () => Date.parse("2026-10-24T10:00:00Z") + at,
      testBots: { enabled: true },
    });
  t.after(() => app.close());
  const human = app.arena.addPlayer(0, "human");
  human.protectedUntil = 1e9;
  app.tick();
  const bots = [...app.arena.players.values()].filter((p) => p.isTestBot);
  assert.ok(bots.length > 0);
  for (const p of bots) {
    p.protectedUntil = 1e9;
    app.bots.brain.lives.get(p.id).bag = ["candy", "rocket", "golden_shield"];
  }
  Object.assign(bots[0], {
    x: 300,
    y: 300,
    mass: 10,
    radius: radiusForMass(10),
    protectedUntil: 0,
  });
  const before = bots.map((p) => ({
    id: p.profileId,
    uses: profiles.byId(p.profileId).progress.boosterUses,
    inventory: structuredClone(profiles.byId(p.profileId).inventory),
    x: p.x,
    y: p.y,
  }));
  for (at = 3000; at <= 12000; at += 300) {
    const events = app.tick();
    assert.equal(
      events.some((e) => e.type === "boosterUsed"),
      false,
    );
  }
  assert.equal(app.arena.combat.shots.length, 0);
  assert.ok(bots.some((p, i) => p.x !== before[i].x || p.y !== before[i].y));
  for (const saved of before) {
    const p = profiles.byId(saved.id);
    assert.equal(p.progress.boosterUses, saved.uses);
    assert.deepEqual(p.inventory, saved.inventory);
  }
});
