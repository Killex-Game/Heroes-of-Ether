"use strict";
// Run identical complete arena steps with the old/new grid. The old grid is
// injected into every consumer, not merely constructed in an isolated test.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
let serial = 0, wall = 1800000000000;
crypto.randomUUID = () => "fixture-" + (++serial);
Date.now = () => wall;
const { RoomFixture } = require("./resident-room-processes/room-fixture.cjs");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards } = require("../../src/server/arena/arena-hazards");
function compile(relative, source, grid) {
  const file = require.resolve("../../src/server/arena/" + relative);
  const m = new Module(file, module); m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  if (grid) m.require = id => id === "./spatial-collision-index" ? grid : Module.prototype.require.call(m, id);
  m._compile(source || fs.readFileSync(file, "utf8"), file);
  return m.exports;
}
const grid = compile("spatial-collision-index", fs.readFileSync(process.env.BASELINE_SPATIAL_INDEX, "utf8"));
const oldArena = compile("arena-simulation", null, grid).Arena;
const oldHazards = compile("arena-hazards", null, grid).ArenaHazards;
const names = ["collectEther", "resolveAbsorptions"];
const before = names.map(k => oldArena.prototype[k]).concat(oldHazards.prototype.collect);
const after = names.map(k => Arena.prototype[k]).concat(ArenaHazards.prototype.collect);
function run(candidate, seed) {
  serial = 0; wall = 1800000000000;
  const methods = candidate ? after : before;
  names.forEach((k, i) => Arena.prototype[k] = methods[i]);
  ArenaHazards.prototype.collect = methods[2];
  const profiles = Array.from({ length: 35 }, (_, i) => ({ id: "p" + i, name: "Игрок " + i,
    level: 600, skinId: "moon-dragon", appearance: {},
    account: { vipUntil: wall + 86400000, premiumUntil: wall + 86400000 } }));
  const room = new RoomFixture("room-" + seed, profiles, 1000, () => {}, "fixture");
  const hash = crypto.createHash("sha256"); let totalMs = 0;
  for (let tick = 1; tick <= 160; tick++) {
    const at = 1000 + tick * 50; wall = 1800000000000 + tick * 50;
    const start = performance.now(); room.tick(at);
    if (tick > 20) totalMs += performance.now() - start;
    hash.update(JSON.stringify({ snapshot: room.arena.snapshot(at), progress: room.outbox,
      shots: room.arena.combat.shots, hazards: room.arena.hazards.items }));
    room.outbox.length = 0; room.inFlight.clear();
  }
  return { candidate, seed, ms: totalMs, hash: hash.digest("hex"), boosters: Object.keys(room.metrics.boosters).length };
}
const results = [];
for (let seed = 1; seed <= 10; seed++) {
  const runs = [false, true, true, false].map(candidate => run(candidate, seed));
  for (const row of runs) assert.equal(row.hash, runs[0].hash, "grid changed physics or progress, seed " + seed);
  results.push(...runs);
}
console.log(JSON.stringify({ exact: true, results }));
