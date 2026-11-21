"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");

function setup(ids = ["z-player", "a-player"]) {
  const arena = new Arena({ etherCount: 0 });
  const eaters = ids.map(id => arena.addPlayer(0, id));
  const victim = arena.addPlayer(0, "victim");
  function reset(masses = eaters.map(() => 1000)) {
    for (const [i, p] of [...eaters, victim].entries()) {
      const mass = i < eaters.length ? masses[i] : 50;
      Object.assign(p, { dead: false, mass, radius: radiusForMass(mass), x: 500, y: 500,
        protectedUntil: 0, parts: null, effects: {} });
    }
  }
  reset();
  return { arena, eaters, victim, reset };
}

test("Absorption ties keep locale order while masses change between snapshots", () => {
  const s = setup(["ёж", "Ястреб", "alpha", "Alpha"]);
  const expected = [...s.eaters].sort((a, b) => a.id.localeCompare(b.id))[0].id;
  for (let i = 0; i < 10; i++) {
    s.reset();
    const events = s.arena.resolveAbsorptions(5000);
    assert.equal(events[0].eaterId, expected);
    s.reset(s.eaters.map((_, n) => n === 1 ? 1100 : 1000));
    assert.equal(s.arena.resolveAbsorptions(5000)[0].eaterId, s.eaters[1].id);
  }
});

test("Split, reorder and replacement IDs cannot reuse another part's tie priority", () => {
  const s = setup(["eater"]), p = s.eaters[0];
  for (const ids of [["z", "a"], ["a", "z"], ["z", "b"], ["Я", "ёж", "alpha"], ["new"]]) {
    s.reset();
    p.parts = ids.map(id => ({ id, x: 500, y: 500, mass: 1000, radius: radiusForMass(1000) }));
    p.mainPartId = ids[0];
    s.arena.syncParts(p);
    const expected = p.parts ? [...ids].sort((a, b) => a.localeCompare(b))[0] : s.arena.bodyId(p, p);
    const event = s.arena.resolveAbsorptions(5000)[0];
    assert.equal(event.eaterPartId, expected);
    assert.equal(event.gain, 40);
    assert.equal(s.victim.dead, true);
  }
});

test("Protection and roster changes refresh absorption tie order", () => {
  const s = setup();
  assert.equal(s.arena.resolveAbsorptions(5000)[0].eaterId, "a-player");
  s.reset(); s.eaters[1].protectedUntil = 6000;
  assert.equal(s.arena.resolveAbsorptions(5000)[0].eaterId, "z-player");
  s.reset();
  const old = s.eaters[1];
  s.arena.players.delete(old.id);
  old.id = "zz-player";
  s.arena.players.set(old.id, old);
  assert.equal(s.arena.resolveAbsorptions(5000)[0].eaterId, "z-player");
});
