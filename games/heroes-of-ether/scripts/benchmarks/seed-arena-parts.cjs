"use strict";
const { performance } = require("node:perf_hooks");
const { massLimitForLevel, radiusForMass } = require("../../src/server/arena/arena-simulation");
function seedParts(arena, player, mass, level, now = performance.now()) {
  if (!Number.isSafeInteger(mass) || mass < 1 || mass > massLimitForLevel(level) * arena.maxParts)
    throw Error("Invalid synthetic split mass");
  while (mass > arena.bodies(player).length * massLimitForLevel(level)) {
    if (!arena.splitPlayer(player, { spawnSerial: player.spawnSerial, sequence: player.splitSequence + 1 }, now))
      throw Error("Cannot seed legal split parts");
  }
  const bodies = arena.bodies(player);
  for (const [ordinal, body] of bodies.entries()) {
    body.mass = Math.floor(mass / bodies.length) + Number(ordinal < mass % bodies.length);
    body.radius = radiusForMass(body.mass);
  }
  arena.syncParts(player);
  player.splitSequence = 0;
}
module.exports = { seedParts };
