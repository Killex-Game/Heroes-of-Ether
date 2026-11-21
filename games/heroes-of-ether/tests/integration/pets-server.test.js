"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
test("pet HTTP economy and WebSocket authority: replay, Origin, arena lock, Q/R and saved disconnect", async (t) => {
  let time = 0;
  const at = Date.UTC(2026, 9, 23, 10),
    profiles = new ProfileStore({ now: () => at + time }),
    session = profiles.open(),
    get = () => profiles.find(session.token);
  get().level = 12;
  get().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  get().wallet = { coins: 20000, crystals: 2000, bucks: 3000 };
  profiles.save(profiles.data);
  const app = createGameServer({
    profiles,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => time,
    wallNow: () => at + time,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`,
    cookie = `sferorumiya_session=${session.token}`;
  const post = (body, headers = {}) =>
    fetch(url + "/api/pets/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, ...headers },
      body: JSON.stringify(body),
    });
  const request = { action: "buy", petId: "manya", requestId: randomUUID(), price: 1, level: 5 };
  assert.equal((await post(request, { Origin: "http://external.example" })).status, 403);
  assert.equal(get().wallet.bucks, 3000);
  get().level = 11;
  get().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(11);
  const beforeLocked = structuredClone(get());
  for (const action of ["buy", "equip", "unequip", "feed", "food"]) {
    const response = await post({ action, petId: "manya", requestId: randomUUID(), level: 999 });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /12/);
  }
  assert.deepEqual(get(), beforeLocked);
  get().level = 12;
  get().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  assert.equal((await post(request)).status, 200);
  assert.equal(get().wallet.bucks, 1000);
  const foodRequest = { action: "food", requestId: randomUUID(), quantity: 100, price: 1 };
  assert.equal((await post(foodRequest)).status, 200);
  assert.equal(get().pets.food, 1);
  assert.equal(get().wallet.crystals, 1900);
  assert.equal((await (await post(foodRequest)).json()).replay, true);
  assert.equal(get().pets.food, 1);
  assert.equal(get().wallet.crystals, 1900);
  assert.equal(get().pets.owned.manya.games, 0);
  assert.equal((await (await post(request)).json()).replay, true);
  assert.equal(get().wallet.bucks, 1000);
  const socket = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  t.after(() => socket.terminate());
  const welcome = await new Promise((resolve) =>
    socket.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "welcome") resolve(m);
    }),
  );
  const p = app.arena.players.get(welcome.id);
  assert.equal(p.pet.stock.fire, 5);
  assert.equal(p.pet.stock.claw, 5);
  assert.equal(p.pet.stock.glove, 5);
  assert.equal((await post({ action: "unequip", requestId: randomUUID() })).status, 409);
  const reply = (message) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("missing pet reply")), 2000);
      function receive(raw) {
        const m = JSON.parse(raw);
        if (m.type === "petBoosterResult" && m.requestId === message.requestId) {
          clearTimeout(timer);
          socket.off("message", receive);
          resolve(m);
        }
      }
      socket.on("message", receive);
      socket.send(JSON.stringify(message));
    });
  time = 4000;
  app.tick();
  const use = {
    type: "usePetBooster",
    ability: "fire",
    spawnSerial: p.spawnSerial,
    sequence: 1,
    requestId: randomUUID(),
    aimX: p.x + 100,
    aimY: p.y,
    firePercent: 100,
    stock: 999,
  };
  assert.equal((await reply(use)).ok, true);
  assert.equal(p.pet.stock.fire, 4);
  assert.equal(app.arena.combat.shots[0].petBooster.firePercent, 50);
  assert.equal((await reply(use)).replay, true);
  assert.equal(p.pet.stock.fire, 4);
  const repeat = { ...use, requestId: randomUUID(), sequence: 2 };
  time = 4299;
  assert.equal((await reply({...repeat,spawnSerial:999})).ok, false);
  assert.equal(p.pet.stock.fire, 4);
  assert.equal(
    (await reply({ ...repeat, ability: "secondary", requestId: randomUUID() })).ok,
    true,
  );
  assert.equal(p.pet.stock.claw, 4);
  time = 4300;
  assert.equal((await reply({ ...repeat, sequence: 3 })).ok, true);
  assert.equal(p.pet.stock.fire, 3);
  assert.equal(
    (await reply({ ...use, requestId: randomUUID(), sequence: 2, spawnSerial: 999 })).ok,
    false,
  );
  assert.equal(p.pet.stock.fire, 3);
  p.parts = [100, 200, 300].map((mass, i) => ({
    id: `pet-gift-part-${i}`,
    mass,
    radius: radiusForMass(mass),
    x: 500 + i * 100,
    y: 500,
    vx: 0,
    vy: 0,
    mergeAt: Infinity,
  }));
  app.arena.syncParts(p);
  p.nextMassDecayAt = Infinity;
  // This test isolates the pet gift: random hazards must not burst its fixture cells.
  app.arena.hazards.items = [];
  app.arena.hazards.nextAt = Infinity;
  time = 65000;
  app.tick();
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [200, 300, 400],
  );
  assert.equal(p.mass, 900);
  app.tick();
  assert.equal(p.mass, 900, "the same server tick must not award the gift twice");
  const closed = once([...app.wss.clients][0], "close");
  socket.close();
  await closed;
  assert.equal(get().pets.games, 1);
  assert.equal(get().pets.owned.manya.vitalityMs, 90 * 60000 - 65000);
  assert.equal(get().inventory.pet_fire, undefined);
  assert.equal(get().wallet.bucks, 1000);
  assert.equal((await post({ action: "unequip", requestId: randomUUID() })).status, 200);
});
