/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { Arena, RULES, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { createGameServer } = require("../../src/server/game-server");
function scene(mass = 100, options = {}) {
  const arena = new Arena({ etherCount: 0, ...options }),
    p = arena.addPlayer(0, "sender");
  Object.assign(p, {
    mass,
    radius: radiusForMass(mass),
    x: 500,
    y: 500,
    targetX: 1500,
    targetY: 500,
    protectedUntil: 0,
  });
  const feed = (sequence = 1, at = 5000, extra = {}) =>
    arena.handleInput(
      p.id,
      { type: "feed", spawnSerial: p.spawnSerial, sequence, x: 1500, y: 500, ...extra },
      at,
    );
  return { arena, p, feed };
}
test("W передаёт по 5 массы из каждой подходящей части в сторону одной цели", () => {
  const { arena, p, feed } = scene();
  p.parts = [100, 50, 2].map((mass, i) => ({
    id: "part" + i,
    mass,
    radius: radiusForMass(mass),
    x: 500,
    y: 300 + i * 200,
  }));
  arena.syncParts(p);
  const before = structuredClone(p.parts);
  assert.equal(feed(), true);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [95, 45, 2],
  );
  assert.equal(p.mass, 142);
  assert.equal(arena.ether.length, 2);
  for (const [i, orb] of arena.ether.entries()) {
    const part = before[i],
      dx = 1500 - part.x,
      dy = 500 - part.y;
    assert.ok(Math.abs(orb.vx * dy - orb.vy * dx) < 1e-8);
    assert.ok(orb.vx > 0);
    assert.ok(Math.hypot(orb.x - part.x, orb.y - part.y) > part.radius + orb.radius);
    assert.ok([1, 3, 5, 10].includes(orb.artValue));
    assert.equal(orb.value, 5);
  }
  assert.equal(p.mass + arena.ether.reduce((n, o) => n + o.value, 0), 152);
  assert.ok(p.parts.every((part) => part.radius === radiusForMass(part.mass)));
});
test("Маленькие шары остаются на минимуме, кормление не делит их и не тратит бустеры", () => {
  for (const mass of [2, 4, 6, 6.99]) {
    const small = scene(mass);
    assert.equal(small.feed(), false);
    assert.equal(small.p.mass, mass);
    assert.equal(small.arena.ether.length, 0);
    assert.equal(small.arena.snapshot(5000).players[0].canFeed, false);
  }
  const { arena, p, feed } = scene(7);
  assert.equal(arena.snapshot(5000).players[0].canFeed, true);
  assert.equal(feed(), true);
  assert.equal(p.mass, 2);
  assert.equal(feed(2, 5200), false);
  assert.equal(p.mass, 2);
  assert.equal(p.parts, null);
  assert.equal(p.radius, radiusForMass(2));
  assert.equal(p.boostersUsed, 0);
  assert.equal(arena.snapshot(5200).players[0].canFeed, false);
});
test("Сервер проверяет жизнь, последовательность, координаты и частоту; данные массы клиента игнорируются", () => {
  const { arena, p, feed } = scene();
  for (const extra of [
    { x: NaN },
    { y: Infinity },
    { x: "1" },
    { sequence: 0 },
    { sequence: 1.5 },
    { spawnSerial: 99 },
  ])
    assert.equal(feed(1, 5000, extra), false);
  assert.equal(feed(1, 5000, { value: 999, mass: 99999, radius: 999, ejected: false }), true);
  assert.equal(p.mass, 95);
  assert.equal(arena.ether[0].value, 5);
  assert.equal(feed(1, 5200), false);
  assert.equal(feed(2, 5199), false);
  assert.equal(feed(2, 5200), false);
  assert.equal(feed(3, 5200), true);
  assert.equal(p.mass, 90);
  p.dead = true;
  assert.equal(feed(4, 5500), undefined);
  assert.equal(p.mass, 90);
  const oldSerial = p.spawnSerial;
  arena.resetPlayer(p, 6000);
  p.mass = 20;
  p.radius = radiusForMass(20);
  assert.equal(feed(5, 6000, { spawnSerial: oldSerial }), false);
  assert.equal(feed(1, 6000), true);
  assert.equal(p.mass, 15);
});
test("Чужой игрок подбирает корм сразу, бабочка не умножает передачу; природная еда сохраняет бонус", () => {
  const { arena, p, feed } = scene(),
    receiver = arena.addPlayer(0, "receiver");
  receiver.outfit = { bow: "novice_bow" };
  feed();
  const food = arena.ether[0];
  Object.assign(receiver, { x: food.x, y: food.y });
  arena.collectEther(5000);
  assert.equal(p.mass, 95);
  assert.equal(receiver.mass, 25);
  assert.equal(arena.ether.length, 0);
  arena.ether.push({ id: "natural", x: receiver.x, y: receiver.y, value: 1 });
  arena.collectEther(5001);
  assert.equal(receiver.mass, 27);
  assert.deepEqual(arena.progressEvents, []);
});
test("Свою еду нельзя сразу подобрать ни одной частью; повторный подбор сохраняет общую массу", () => {
  const { arena, p, feed } = scene();
  p.outfit = { bow: "novice_bow" };
  feed();
  const food = arena.ether[0];
  p.parts = [
    { id: "one", mass: 50, radius: radiusForMass(50), x: food.x, y: food.y },
    { id: "two", mass: 45, radius: radiusForMass(45), x: food.x, y: food.y },
  ];
  arena.syncParts(p);
  arena.collectEther(food.sourcePickupAt - 1);
  assert.equal(p.mass, 95);
  assert.equal(arena.ether.length, 1);
  arena.collectEther(food.sourcePickupAt);
  assert.equal(p.mass, 100);
  assert.equal(arena.ether.length, 0);
});
test("Корм летит, замедляется, остаётся в границах и исчезает по сроку, не затрагивая природную еду", () => {
  const { arena, p, feed } = scene();
  feed();
  const orb = arena.ether[0],
    start = orb.x;
  arena.step(5050);
  assert.ok(orb.x > start);
  assert.ok(orb.vx > 0 && orb.vx < RULES.FEED_SPEED);
  const velocity = orb.vx;
  arena.step(5100);
  assert.ok(orb.vx < velocity);
  arena.removePlayer(p.id);
  arena.moveFeed(orb.expiresAt - 1);
  assert.equal(arena.ether.length, 1);
  arena.ether.push({ id: "natural", x: 2000, y: 1000, value: 1 });
  arena.moveFeed(orb.expiresAt);
  assert.deepEqual(
    arena.ether.map((o) => o.id),
    ["natural"],
  );
  const edge = scene();
  edge.p.x = 10;
  edge.feed(1, 5000, { x: -100, y: 500 });
  edge.arena.moveFeed(6000);
  assert.equal(edge.arena.ether[0].x, edge.arena.ether[0].radius);
  assert.equal(edge.arena.ether[0].vx, 0);
});
test("W замещает природный эфир первым и не списывает массу при заполнении свежими выбросами", () => {
  const { arena, p, feed } = scene(100, { etherCount: 200 });
  feed();
  assert.equal(arena.ether.length, 201);
  arena.ether.splice(
    arena.ether.findIndex((o) => !o.ejected && o.value === 1),
    1,
  );
  arena.fillEther();
  assert.equal(arena.ether.length, 201);
  assert.deepEqual(
    [1, 3, 5, 10].map((value) => arena.ether.filter((o) => !o.ejected && o.value === value).length),
    [120, 50, 20, 10],
  );
  arena.ether.push(
    ...Array.from({ length: RULES.FEED_MAX_PARTICLES - 1 }, () => ({ ejected: true })),
  );
  assert.equal(feed(2, 5200), true);
  assert.equal(p.mass, 90);
  assert.equal(arena.ether.length, arena.etherLimit);
  arena.fillEther();
  assert.equal(arena.ether.filter(o => !o.ejected).length, 199);
  assert.equal(arena.ether.length, arena.etherLimit);
  arena.ether = arena.ether.map(o => o.ejected ? o : { ...o, ejected: true });
  assert.equal(feed(3, 5400), false);
  assert.equal(p.mass, 90);
  const view = arena.snapshot(5200).ether.find((o) => o.id && o.ejected);
  for (const key of ["sourceId", "sourcePickupAt", "vx", "vy", "expiresAt", "updatedAt"])
    assert.equal(Object.hasOwn(view, key), false);
});
test("Полная арена: новый W и яд появляются у игрока, старые капли освобождают место, природные восстанавливаются", () => {
  const { arena, p, feed } = scene(500, { etherCount: RULES.ETHER_COUNT });
  const old = Array.from({ length: arena.etherLimit }, (_, i) => ({
    id: "old-" + i, x: 900, y: 900, value: 5, radius: 6,
    ejected: true, sourcePickupAt: i === 0 ? 99999 : 1000,
  }));
  arena.ether = [...old];
  assert.equal(feed(), true);
  assert.ok(arena.ether.includes(old[0]));
  assert.ok(!arena.ether.includes(old[1]));
  arena.boosterEffects.ejectPoisonFood(p, [{ part: p, mass: p.mass + 100 }], 5000);
  const emitted = arena.ether.filter(o => o.poisonFood);
  assert.equal(emitted.reduce((sum, o) => sum + o.value, 0), 15);
  assert.equal(emitted.length, 3);
  assert.ok(emitted.every(o => Math.hypot(o.x - p.x, o.y - p.y) < p.radius + 12));
  assert.equal(arena.ether.length, arena.etherLimit);
  assert.ok(arena.ether.includes(old[0]));
  assert.ok(arena.ether.some(o => o.sourceId === p.id && !o.poisonFood));
  arena.fillEther();
  assert.equal(arena.ether.length, arena.etherLimit);
  arena.ether = emitted;
  arena.fillEther();
  assert.equal(arena.ether.filter(o => !o.ejected).length, 300);
});
test("Настоящие WebSocket-клиенты видят одинаковый корм и серверное списание/получение массы", async (t) => {
  let now = 5000;
  const arena = new Arena({ etherCount: 0 }),
    app = createGameServer({ arena, autoTick: false, now: () => now });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  async function connect() {
    const res = await fetch(url + "/api/profile"),
      cookie = res.headers.get("set-cookie").split(";")[0];
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url.replace("http", "ws"), { headers: { Cookie: cookie } });
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") resolve({ ws, p: arena.players.get(m.id) });
      });
    });
  }
  function state(ws, predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off("message", read);
        reject(Error("state timeout"));
      }, 2000);
      function read(raw) {
        const m = JSON.parse(raw);
        if (m.type === "state" && predicate(m)) {
          clearTimeout(timer);
          ws.off("message", read);
          resolve(m);
        }
      }
      ws.on("message", read);
    });
  }
  const a = await connect(),
    b = await connect();
  Object.assign(a.p, {
    x: 500,
    y: 500,
    targetX: 500,
    targetY: 500,
    mass: 100,
    radius: radiusForMass(100),
  });
  Object.assign(b.p, { x: 1800, y: 1400, targetX: 1800, targetY: 1400 });
  const emitted = [
    state(a.ws, (s) => s.ether.length === 1),
    state(b.ws, (s) => s.ether.length === 1),
  ];
  a.ws.send(
    JSON.stringify({
      type: "feed",
      sequence: 1,
      spawnSerial: a.p.spawnSerial,
      x: 1500,
      y: 500,
      value: 999,
    }),
  );
  for (let i = 0; i < 100 && !arena.ether.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  now += 50;
  app.tick();
  const [sa, sb] = await Promise.all(emitted);
  assert.deepEqual(sa, sb);
  assert.equal(a.p.mass, 95);
  assert.equal(sa.ether[0].value, 5);
  const food = arena.ether[0];
  Object.assign(b.p, { x: food.x, y: food.y, targetX: food.x, targetY: food.y });
  const collected = state(
    a.ws,
    (s) => s.ether.length === 0 && s.players.find((p) => p.id === b.p.id).mass === 25,
  );
  arena.collectEther(now);
  app.broadcast();
  await collected;
  assert.equal(b.p.mass, 25);
  assert.equal(app.profiles.byId(a.p.profileId).progress.kills, 0);
  assert.equal(app.profiles.byId(b.p.profileId).progress.kills, 0);
});
