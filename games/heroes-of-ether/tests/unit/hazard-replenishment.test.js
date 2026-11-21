"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { linearReplenish, scene, view } = require("../helpers/hazard-replenishment-reference");
test("Hazard search preserves full-search placement, RNG and retries at mixed masses", () => {
  for (let seed = 1; seed <= 36; seed++) {
    const current = scene(seed, seed % 3 ? 35 : 3, seed % 2 === 0, seed % 4 !== 0);
    const old = scene(seed, seed % 3 ? 35 : 3, seed % 2 === 0, seed % 4 !== 0);
    for (const now of [0, 500, 1000, 2000, 60000, 61000]) {
      current.h.replenish(now); linearReplenish.call(old.h, now);
      assert.deepEqual(view(current), view(old), `seed ${seed}, time ${now}`);
      current.h.items.splice(0, 5); old.h.items.splice(0, 5);
    }
    for (const s of [current, old]) for (const p of s.arena.players.values()) p.dead = true;
    current.h.replenish(62000); linearReplenish.call(old.h, 62000);
    assert.deepEqual(view(current), view(old));
  }
});
test("Unchanged full population does not enumerate any body collections", () => {
  const s = scene(9, 1);
  s.h.items = Array.from({ length: 80 }, (_, i) => s.h.create(i * 100, 500, 0));
  s.arena.bodies = () => { throw Error("Unnecessary body search"); };
  s.h.replenish(1000);
  assert.equal(s.h.items.length, 80);
});
