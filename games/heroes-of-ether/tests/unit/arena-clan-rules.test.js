/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
test("Главный — крупнейший текущий: еда, уменьшение, равные массы и бустер", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p");
  p.parts = [200, 199].map((mass, i) => ({
    id: i ? "other" : "p",
    mass,
    radius: radiusForMass(mass),
    x: 500 + i * 700,
    y: 500,
  }));
  arena.syncParts(p);
  arena.gainMass(p, 1, p.parts[1]);
  assert.equal(p.mainPartId, "p");
  arena.gainMass(p, 1, p.parts[1]);
  assert.equal(p.mainPartId, "other");
  arena.prepareBooster(p.id, { boosterId: "candy", spawnSerial: 0 }, 5000)();
  assert.deepEqual(
    p.parts.map((b) => b.mass),
    [200, 351],
  );
  p.parts[1].mass = 150;
  p.parts[1].radius = radiusForMass(150);
  arena.syncParts(p);
  assert.equal(p.mainPartId, "p");
  assert.equal(arena.snapshot(5000).players[0].mainPartId, "p");
});
test("Каждая часть выходит за каждую стену максимум на 40% диаметра", () => {
  const arena = new Arena({ etherCount: 0 });
  for (const mass of [10, 5000, 18000, 30000]) {
    const radius = radiusForMass(mass),
      part = { mass, radius, x: -10000, y: -10000 };
    arena.clampPlayer(part);
    assert.ok(Math.abs((radius - part.x) / (radius * 2) - 0.4) < 1e-12);
    assert.equal(part.x, part.y);
    part.x = part.y = 10000;
    arena.clampPlayer(part);
    assert.ok(Math.abs((part.x + radius - arena.world.width) / (radius * 2) - 0.4) < 1e-12);
    assert.ok(Math.abs((part.y + radius - arena.world.height) / (radius * 2) - 0.4) < 1e-12);
  }
});
test("Арена: 10 игроков, до 10 кланов; сумма всех частей и только живых участников, без величия", () => {
  const arena = new Arena({ etherCount: 0 });
  for (let i = 0; i < 14; i++) {
    const p = arena.addPlayer(0, String(i));
    Object.assign(p, {
      mass: 100 + i,
      clanId: "clan" + (i % 7),
      clanPrefix: "X",
      clanName: "Клан " + (i % 7),
    });
  }
  const p = arena.players.get("0");
  p.parts = [400, 300].map((mass, i) => ({
    id: "part" + i,
    mass,
    radius: radiusForMass(mass),
    x: 500 + i * 500,
    y: 500,
  }));
  arena.syncParts(p);
  const dead = arena.addPlayer(0, "dead");
  Object.assign(dead, { dead: true, mass: 999999, clanId: "clan1" });
  const solo = arena.addPlayer(0, "solo");
  Object.assign(solo, { mass: 800, clanId: null });
  const snapshot = arena.snapshot(5000);
  assert.equal(snapshot.leaderboard.length, 10);
  assert.equal(snapshot.leaderboard[0].id, "solo");
  assert.equal(snapshot.clanLeaderboard.length, 7);
  assert.equal(snapshot.clanLeaderboard[0].id, "clan0");
  assert.equal(snapshot.clanLeaderboard[0].mass, 807);
  assert.equal(snapshot.clanLeaderboard[0].count, 2);
  assert.equal(new Set(snapshot.clanLeaderboard.map((c) => c.id)).size, 7);
  p.clanId = null;
  const next = arena.snapshot(6000);
  assert.equal(
    next.clanLeaderboard.find((c) => c.id === "clan0").mass,
    107,
  );
});
