/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { createGameServer } = require("../../src/server/game-server"),
  { temporary } = require("../temp");
const { placements } = require("../../public/arena/accessory-renderer");
function equip(store, token, slot, accessoryId, requestId = randomUUID()) {
  return store.setAccessory(token, { slot, accessoryId, requestId });
}
test("Аксессуары Новичка выдаются за титул, отдельные места, повтор и сохранение без списаний", (t) => {
  const filePath = path.join(temporary(t, "wardrobe"), "profiles.json"),
    store = new ProfileStore({ filePath }),
    a = store.open();
  assert.deepEqual(a.profile.wardrobe.owned, []);
  assert.throws(() => equip(store, a.token, "bow", "novice_bow"), /недоступен/);
  store.transact(a.token, randomUUID(), "fixture-title", p => { p.greatness=100; });
  const granted=store.view(store.find(a.token));
  assert.deepEqual(granted.wardrobe, {
    seen: a.profile.wardrobe.seen,
    owned: ["novice_bow", "novice_hat"],
    equipped: { bow: null, hat: null },
  });
  const wallet = structuredClone(a.profile.wallet),
    id = randomUUID();
  equip(store, a.token, "bow", "novice_bow", id);
  assert.equal(equip(store, a.token, "bow", "novice_bow", id).replay, true);
  equip(store, a.token, "hat", "novice_hat");
  assert.deepEqual(store.find(a.token).outfit, { bow: "novice_bow", hat: "novice_hat" });
  const disk = new ProfileStore({ filePath });
  assert.deepEqual(disk.find(a.token).outfit, store.find(a.token).outfit);
  assert.deepEqual(disk.find(a.token).wallet, wallet);
  equip(disk, a.token, "bow", null);
  assert.deepEqual(disk.find(a.token).outfit, { bow: null, hat: "novice_hat" });
  assert.throws(() => equip(disk, a.token, "hat", "novice_bow"), /доступный аксессуар/);
  assert.throws(() => equip(disk, a.token, "bow", "unknown"), /доступный аксессуар/);
  assert.throws(() => equip(disk, a.token, "__proto__", "novice_bow"), /доступный аксессуар/);
});
test("Старые профили получают доступ без изменения кошельков; повреждённый выбор не затирается", (t) => {
  const filePath = path.join(temporary(t, "wardrobe-old"), "profiles.json"),
    store = new ProfileStore(),
    a = store.open();
  delete store.find(a.token).outfit;
  fs.writeFileSync(filePath, JSON.stringify(store.data));
  const old = fs.readFileSync(filePath, "utf8"),
    disk = new ProfileStore({ filePath });
  assert.deepEqual(disk.view(disk.find(a.token)).wardrobe.equipped, { bow: null, hat: null });
  assert.equal(fs.readFileSync(filePath, "utf8"), old);
  disk.find(a.token).outfit = { bow: "novice_hat", hat: null };
  fs.writeFileSync(filePath, JSON.stringify(disk.data));
  const corrupt = fs.readFileSync(filePath, "utf8");
  assert.throws(() => new ProfileStore({ filePath }), /гардероба/);
  assert.equal(fs.readFileSync(filePath, "utf8"), corrupt);
});
test("Ошибка сохранения не надевает аксессуар и не расходует номер операции", () => {
  const store = new ProfileStore(),
    a = store.open(),
    p = store.find(a.token);
  p.wardrobeState.legacyNovice=true;
  const before = structuredClone(p);
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => equip(store, a.token, "hat", "novice_hat"), /disk full/);
  assert.deepEqual(store.find(a.token), before);
});
test("Бабочка удваивает 1/3/5/10 еды, действует на часть-сборщик и соблюдает предел", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p");
  p.outfit = { bow: "novice_bow", hat: null };
  for (const value of [1, 3, 5, 10]) arena.ether.push({ id: String(value), x: p.x, y: p.y, value });
  arena.collectEther(5000);
  assert.equal(p.mass, 58);
  assert.equal(arena.ether.length, 0);
  p.parts = [100, 200].map((mass, i) => ({
    id: i ? "part" : p.id,
    mass,
    radius: radiusForMass(mass),
    x: 500 + i * 500,
    y: 500,
  }));
  arena.syncParts(p);
  arena.ether = [{ id: "food", x: 500, y: 500, value: 10 }];
  arena.collectEther(5000);
  assert.deepEqual(
    p.parts.map((x) => x.mass),
    [120, 200],
  );
  p.parts = null;
  p.mass = 4999;
  p.radius = radiusForMass(p.mass);
  arena.ether = [{ id: "cap", x: p.x, y: p.y, value: 10 }];
  arena.collectEther(5000);
  assert.equal(p.mass, 5000);
  arena.ether = [{ id: "full", x: p.x, y: p.y, value: 10 }];
  arena.collectEther(5000);
  assert.equal(p.mass, 5000);
  assert.equal(arena.ether.length, 0);
});
test("Бабочка не усиливает массовые бустеры, Торт и поглощение", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p"),
    q = arena.addPlayer(0, "q");
  p.outfit = { bow: "novice_bow", hat: null };
  arena.prepareBooster(p.id, { boosterId: "candy", spawnSerial: p.spawnSerial }, 5000)();
  assert.equal(p.mass, 170);
  arena.combat.impact(
    { boosterId: "cake", ownerId: q.id, ownerLife: q.lifeId },
    p,
    5000,
    arena.mainBody(p),
  );
  arena.boosterEffects.tick(p, 6000);
  assert.equal(p.mass, 171);
  Object.assign(q, { x: p.x, y: p.y, mass: 10, radius: radiusForMass(10), protectedUntil: 0 });
  p.protectedUntil = 0;
  const event = arena.resolveAbsorptions(7000)[0];
  assert.equal(event.gain, 8);
  assert.equal(p.mass, 179);
});
test("Шапка: 3 × 1,1 округляется до 3 за поглощение, каждая минута округляется отдельно, лимит сохраняется", () => {
  const store = new ProfileStore(),
    a = store.open();
  store.find(a.token).wardrobeState.legacyNovice=true;
  equip(store, a.token, "hat", "novice_hat");
  store.startLife(a.profile.id, "first");
  const apply = (events, at = 5000) =>
    store.applyArenaProgress(
      randomUUID(),
      events.map((e) => ({ profileId: a.profile.id, ...e })),
      at,
    );
  apply([
    { type: "absorbed", victimProfileId: "victim", gain: 8 },
    { type: "survivalMinute", mass: 5000, minutes: 1 },
    { type: "survivalMinute", mass: 500, minutes: 4 },
  ]);
  assert.equal(store.find(a.token).progress.session.xp, 18); // 3 + 11 + 1×4
  apply([{ type: "absorbed", victimProfileId: "victim", gain: 8 }], 5001);
  assert.equal(store.find(a.token).progress.session.xp, 18);
  apply([{ type: "survivalMinute", mass: 75000, minutes: 100 }]);
  assert.equal(store.find(a.token).progress.session.xp, 500);
  apply([{ type: "lifeEnded", lifeId: "first", durationSeconds: 60, reason: "left" }]);
  assert.equal(store.find(a.token).progress.xp, 500);
  equip(store, a.token, "hat", null);
  store.startLife(a.profile.id, "second");
  apply([{ type: "absorbed", victimProfileId: "second-victim", gain: 8 }]);
  assert.equal(store.find(a.token).progress.session.xp, 3);
});
test("Аксессуары передаются в снимке каждой жизни, небольшие шары сохраняют пропорции", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p");
  p.outfit = { bow: "novice_bow", hat: "novice_hat" };
  arena.resetPlayer(p, 1000);
  assert.deepEqual(arena.snapshot(1000).players[0].outfit, p.outfit);
  const small = placements(p.outfit, { x: 0, y: 0, radius: 20 }),
    large = placements(p.outfit, { x: 0, y: 0, radius: 40 });
  assert.equal(small.length, 2);
  assert.ok(small[0].y < 0);
  assert.ok(small[1].y > 0);
  small.forEach((r, i) => {
    for (const key of ["x", "y", "width", "height"])
      assert.ok(Math.abs(large[i][key] - r[key] * 2) < 1e-8);
  });
});
test("Крупные шары: аксессуары ограничены на экране и остаются у краёв шара при любом масштабе", () => {
  const outfit = { bow: "novice_bow", hat: "novice_hat" };
  for (const scale of [0.15, 0.5, 1, 2]) {
    const body = { x: 1500, y: 1500, radius: 1000, scale };
    const [hat, bow] = placements(outfit, body);
    assert.ok(hat.width * scale <= 47);
    assert.ok(bow.width * scale <= 38);
    assert.ok(bow.width < hat.width);
    for (const item of [hat, bow]) assert.ok(Math.abs(item.x + item.width / 2 - body.x) < 1e-8);
    assert.ok(hat.y < body.y - body.radius);
    assert.ok(hat.y + hat.height > body.y - body.radius);
    assert.ok(bow.y < body.y + body.radius);
    assert.ok(bow.y + bow.height > body.y + body.radius);
    const larger = placements(outfit, { ...body, radius: 2000 });
    assert.equal(larger[0].width, hat.width);
    assert.equal(larger[1].width, bow.width);
  }
});
test("HTTP: экипировка серверная, обе части видны, смена на арене запрещена и XP не берётся от клиента", async (t) => {
  let now = 5000;
  const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => now,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    response = await fetch(url + "/api/profile");
  const cookie = response.headers.get("set-cookie").split(";")[0],
    opened = await response.json();
  app.profiles.find(cookie.split("=")[1]).wardrobeState.legacyNovice=true;
  const post = (body) =>
    fetch(url + "/api/profile/accessory", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: randomUUID(), ...body }),
    });
  assert.equal(
    (await post({ slot: "bow", accessoryId: "novice_bow", bonus: { food: 9999 } })).status,
    200,
  );
  assert.equal(
    (await post({ slot: "hat", accessoryId: "novice_hat", bonus: { xp: 9999 } })).status,
    200,
  );
  const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  t.after(() => ws.terminate());
  const snapshot = await new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "state") resolve(m);
    });
  });
  const p = app.arena.players.get(snapshot.players[0].id);
  assert.deepEqual(snapshot.players[0].outfit, { bow: "novice_bow", hat: "novice_hat" });
  assert.equal((await post({ slot: "hat", accessoryId: null })).status, 409);
  app.arena.ether = [{ id: "food", x: p.x, y: p.y, value: 5 }];
  app.tick();
  assert.equal(p.mass, 30);
  // This case fixes mass to test accessory XP. A thorn created while the
  // player was small can be swallowed after the artificial size increase,
  // legitimately adding 50 mass and moving 5.5 XP above the rounding tie.
  app.arena.hazards.items = [];
  app.arena.hazards.replenish = () => {};
  p.mass = 5000;
  p.radius = radiusForMass(5000);
  p.stopped = true;
  p.nextMassDecayAt = Infinity;
  app.tick();
  for (now = 5050; now <= 35000; now += 50) app.tick();
  now = 65000;
  app.tick();
  assert.equal(app.profiles.byId(opened.profile.id).progress.session.xp, 5);
});
