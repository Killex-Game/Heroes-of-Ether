/* Compare the saved pre-optimization implementation with the current source. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const filename = require.resolve("../../src/server/arena/arena-simulation");
const previous = new Module(filename, module);
previous.filename = filename;
previous.paths = Module._nodeModulePaths(path.dirname(filename));
previous._compile(fs.readFileSync(path.resolve(process.argv[2], "arena-simulation.js"), "utf8"), filename);
const { Arena, radiusForMass } = require(filename), OldArena = previous.exports.Arena;
const hash = crypto.createHash("sha256");
let pickups = 0, absorptions = 0;
for (let seed = 1; seed <= 180; seed++) {
  let state = seed;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const current = new Arena({ etherCount: 0, random });
  for (let i = 0; i < 35; i++) {
    const p = current.addPlayer(0, `p-${i}`);
    p.protectedUntil = i % 13 === 0 ? 3000 : 0;
    p.level = i % 2 ? 1 : 601;
    p.outfit = i % 3 ? { bow: "novice_bow" } : {};
    if (i === 2) p.effects.lock = 4000;
    if (i === 3) Object.assign(p, { isRemnant: true, removeAt: 2000 });
    p.parts = Array.from({ length: 1 + (i * seed) % 16 }, (_, j) => {
      const mass = [20, 50, 150, 1000, 5000, 25000, 75000, 120000][(i+j+seed)%8];
      return { id: `part-${i}-${j}`, x: random()*6500, y: random()*4300,
        mass, radius: radiusForMass(mass), vx: 0, vy: 0 };
    });
    p.mainPartId = p.parts[0].id;
    current.syncParts(p);
  }
  current.ether = Array.from({ length: seed % 2 ? 1224 : 70 }, (_, i) => ({
    id: `f-${i}`, x: random()*6500, y: random()*4300,
    value: i % 31 ? 1 + i%10 : 25000,
    ...(i%5 ? { radius: 3+i%3 } : {}),
    ...(i%2 ? { ejected:true, sourceId:`p-${i%35}`, sourcePickupAt:3000 } : {}),
  }));
  const old = new OldArena({ etherCount: 0 });
  old.players = structuredClone(current.players);
  old.ether = structuredClone(current.ether);
  const initial = current.ether.length;
  for (const at of [1000, 3500]) {
    old.collectEther(at); current.collectEther(at);
    assert.deepEqual(current.ether, old.ether, `food ${seed}/${at}`);
    assert.deepEqual(current.players, old.players, `pickup ${seed}/${at}`);
    const expected = old.resolveAbsorptions(at), actual = current.resolveAbsorptions(at);
    assert.deepEqual(actual, expected, `absorption ${seed}/${at}`);
    assert.deepEqual(current.players, old.players, `mass ${seed}/${at}`);
    absorptions += actual.length;
  }
  pickups += initial-current.ether.length;
  hash.update(JSON.stringify({ food:current.ether, players:[...current.players.values()] }));
}
console.log(JSON.stringify({ scenarios:180, pickups, absorptions, exact:true, sha256:hash.digest("hex") }));
