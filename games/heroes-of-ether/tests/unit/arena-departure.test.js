"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
function scene() {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "leaving");
  Object.assign(p, {
    profileId: "profile-left",
    x: 800,
    y: 800,
    mass: 1000,
    radius: radiusForMass(1000),
    protectedUntil: 0,
  });
  return { arena, p };
}
test("Модель после выхода сохраняет части на 15 секунд, после чего удаляется", () => {
  const { arena, p } = scene();
  p.parts = [
    { id: p.mainPartId, x: 700, y: 800, mass: 600, radius: radiusForMass(600), vx: 20, vy: 10 },
    { id: "small", x: 900, y: 800, mass: 400, radius: radiusForMass(400), vx: -20, vy: 0 },
  ];
  arena.syncParts(p);
  const remnant = arena.leaveRemnant(p, 5000);
  arena.removePlayer(p.id);
  assert.equal(arena.leaveRemnant(p, 6000), null, "повтор не создаёт вторую модель");
  assert.equal(remnant.profileId, undefined, "жизнь владельца уже завершена");
  assert.deepEqual(
    remnant.parts.map((part) => [part.x, part.y, part.mass]),
    [
      [700, 800, 600],
      [900, 800, 400],
    ],
  );
  assert.ok(remnant.parts.every((part) => !p.parts.some((original) => original.id === part.id)));
  arena.handleInput(remnant.id, { type: "move", x: 1800, y: 1800 }, 6000);
  assert.throws(() =>
    arena.prepareBooster(
      remnant.id,
      { boosterId: "candy", spawnSerial: remnant.spawnSerial },
      6000,
    ),
  );
  arena.ether = [{ id: "food", x: 700, y: 800, radius: 5, value: 10 }];
  arena.step(18999);
  assert.equal(remnant.mass, 1000);
  assert.equal(arena.ether.length, 1, "модель не собирает еду");
  assert.deepEqual(arena.progressEvents, [], "не получает время жизни и прогресс");
  let visible = arena.snapshot(18999);
  assert.equal(visible.players[0].departure.remainingMs, 1001);
  assert.deepEqual(visible.leaderboard, []);
  arena.step(19500);
  visible = arena.snapshot(19500);
  assert.deepEqual(visible.players[0].departure, { remainingMs: 500, fadeMs: 1000 });
  arena.step(20000);
  assert.equal(arena.players.size, 0);
});
test("Модель и новая жизнь одного владельца не поглощают друг друга; соперник может съесть модель", () => {
  const { arena, p } = scene(),
    remnant = arena.leaveRemnant(p, 5000);
  arena.removePlayer(p.id);
  const other = arena.addPlayer(5000, "other");
  Object.assign(other, {
    x: remnant.x,
    y: remnant.y,
    protectedUntil: 0,
    profileId: remnant.departedProfileId,
  });
  assert.deepEqual(
    arena.resolveAbsorptions(6000),
    [],
    "старая модель не поглощает новую жизнь владельца",
  );
  other.mass = 4000;
  other.radius = radiusForMass(other.mass);
  other.profileId = remnant.departedProfileId;
  assert.deepEqual(arena.resolveAbsorptions(6000), [], "новая жизнь не собирает свою старую массу");
  other.profileId = "other-profile";
  const events = arena.resolveAbsorptions(6000);
  assert.equal(events.length, 1);
  assert.equal(events[0].gain, 800);
  assert.equal(other.mass, 4800);
  assert.equal(remnant.dead, true);
  arena.step(6050);
  assert.equal(arena.players.has(remnant.id), false);
});

test("Модель поглощает соперников до конца 15 секунд, соблюдая размер и защиту", () => {
  const { arena, p } = scene(),
    remnant = arena.leaveRemnant(p, 5000);
  arena.removePlayer(p.id);
  const other = arena.addPlayer(5000, "other");
  Object.assign(other, {
    x: remnant.x,
    y: remnant.y,
    mass: 100,
    radius: radiusForMass(100),
    protectedUntil: 7000,
    profileId: "other-profile",
  });
  assert.deepEqual(arena.resolveAbsorptions(6000), [], "защита появления сохраняется");
  other.protectedUntil = 0;
  remnant.effects.lock = 8000;
  assert.deepEqual(arena.resolveAbsorptions(7000), [], "Замок блокирует поглощение");
  delete remnant.effects.lock;
  other.mass = 1000;
  other.radius = radiusForMass(other.mass);
  assert.deepEqual(arena.resolveAbsorptions(8000), [], "равную часть поглотить нельзя");
  other.mass = 100;
  other.radius = radiusForMass(other.mass);
  const events = arena.resolveAbsorptions(19999);
  assert.equal(events.length, 1);
  assert.equal(events[0].eaterId, remnant.id);
  assert.equal(events[0].victimId, other.id);
  assert.equal(events[0].gain, 80);
  assert.equal(remnant.mass, 1080);
  assert.equal(other.dead, true);
  assert.equal(remnant.removeAt, 20000, "поглощение не продлевает оставшееся время");
  const late = arena.addPlayer(20000, "late");
  Object.assign(late, { x: remnant.x, y: remnant.y, protectedUntil: 0 });
  assert.deepEqual(
    arena.resolveAbsorptions(20000),
    [],
    "после 15 секунд новых поглощений нет",
  );
  arena.step(20000);
  assert.equal(arena.players.has(remnant.id), false);
  assert.equal(late.dead, false);
});
