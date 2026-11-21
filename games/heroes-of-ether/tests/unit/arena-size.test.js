"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, RULES, radiusForMass } = require("../../src/server/arena/arena-simulation");

test("Увеличенная арена создаёт еду и игроков за прежними границами, передаёт размер клиенту", () => {
  const arena = new Arena({ random: () => 0.9 });
  const player = arena.addPlayer(0);
  assert.deepEqual(arena.world, { width: 6120, height: 4080 });
  assert.ok(player.x > 3600 && player.y > 2400);
  assert.equal(player.radius, radiusForMass(RULES.START_MASS));
  assert.equal(arena.ether.length, RULES.ETHER_COUNT);
  assert.ok(arena.ether.every((orb) => orb.x > 3600 && orb.y > 2400));
  assert.deepEqual(arena.snapshot(0).world, { width: 6120, height: 4080 });
  Object.assign(player, { x: 9000, y: 7000 });
  arena.clampPlayer(player);
  const edgeInset = player.radius * (1 - 2 * RULES.OUTSIDE_DIAMETER_FRACTION);
  assert.equal(player.x, 6120 - edgeInset);
  assert.equal(player.y, 4080 - edgeInset);
});

test("Явно заданный размер комнаты и независимость арен сохраняются", () => {
  const first = new Arena({ etherCount: 0 }),
    second = new Arena({ etherCount: 0 });
  first.world.width = 1000;
  assert.equal(second.world.width, 6120);
  const custom = new Arena({
    etherCount: 0,
    world: { width: 900, height: 600 },
    random: () => 0.5,
  });
  const p = custom.addPlayer(0);
  assert.deepEqual([p.x, p.y], [450, 300]);
  assert.deepEqual(custom.snapshot(0).world, { width: 900, height: 600 });
});
