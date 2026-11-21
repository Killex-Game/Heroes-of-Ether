"use strict";
// Exact deterministic all-booster replay. Baseline methods run in the same
// fixture as the candidate; no profiles, sockets or production data are used.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
let serial = 0;
crypto.randomUUID = () => "fixture-" + (++serial);
let wall = 1800000000000;
Date.now = () => wall;
const { RoomFixture } = require("./resident-room-processes/room-fixture.cjs");
const { ArenaHazards } = require("../../src/server/arena/arena-hazards");
const { Combat } = require("../../src/server/arena/projectile-combat");
function oldModule(relative) {
  const file = require.resolve("../../src/server/arena/" + relative);
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(path.join(process.env.BASELINE_PHYSICS, relative + ".js"), "utf8"), file);
  return m.exports;
}
const before = [oldModule("arena-hazards").ArenaHazards.prototype.beginStep,
  oldModule("projectile-combat").Combat.prototype.updateProjectiles];
const after = [ArenaHazards.prototype.beginStep, Combat.prototype.updateProjectiles];
function run(variant, seed) {
  serial = 0; wall = 1800000000000;
  const methods = [variant & 1 ? after[0] : before[0], variant & 2 ? after[1] : before[1]];
  ArenaHazards.prototype.beginStep = methods[0]; Combat.prototype.updateProjectiles = methods[1];
  const profiles = Array.from({ length: 35 }, (_, i) => ({ id: "p" + i, name: "Игрок " + i,
    level: 600, skinId: "moon-dragon", appearance: {},
    account: { vipUntil: wall + 86400000, premiumUntil: wall + 86400000 } }));
  const room = new RoomFixture("room-" + seed, profiles, 1000, () => {}, "fixture");
  const hash = crypto.createHash("sha256"); let totalMs = 0;
  for (let tick = 1; tick <= 160; tick++) {
    const at = 1000 + tick * 50; wall = 1800000000000 + tick * 50;
    const start = performance.now(); room.tick(at); const end = performance.now();
    if (tick > 20) totalMs += end - start;
    hash.update(JSON.stringify({ snapshot: room.arena.snapshot(at), progress: room.outbox,
      shots: room.arena.combat.shots, hazards: room.arena.hazards.items }));
    // The fixture's no-socket sender is acknowledged without changing events.
    room.outbox.length = 0; room.inFlight.clear();
  }
  return { variant: ["before", "axes-only", "distance-only", "both"][variant], seed, ms: totalMs, hash: hash.digest("hex"),
    boosters: Object.keys(room.metrics.boosters).length };
}
const results = [];
for (let seed = 1; seed <= 10; seed++) {
  const pair = Array.from({length:4}, (_, i) => run((i + seed) % 4, seed));
  for (const item of pair) assert.equal(pair[0].hash, item.hash, "physics/progress diverged for seed " + seed);
  results.push(...pair);
}
console.log(JSON.stringify({ exact: true, results }));
