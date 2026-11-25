"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards } = require("../../src/server/arena/arena-hazards");

test("empty, dead, remnant and locked rosters skip food scans, then resume on unlock", () => {
  for (const state of ["empty", "dead", "remnant", "locked"]) {
    const a = new Arena({ etherCount: 0 });
    const p = state === "empty" ? null : a.addPlayer(0, "p");
    if (p) Object.assign(p, { x: 1000, y: 1000, dead: state === "dead", isRemnant: state === "remnant" });
    if (state === "locked") p.effects.lock = 500;
    let reads = 0;
    const orb = { id: "food", x: 1000, y: 1000, value: 5, radius: 5.5 };
    const food = Array.from({ length: 128 }, (_, i) => ({ ...orb, id: "food" + i }));
    const array = new Proxy(food, { get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) reads++;
      return Reflect.get(target, key, receiver);
    } });
    a.ether = array;
    a.collectEther(499);
    assert.equal(reads, 0, state);
    assert.equal(a.ether, array);
    if (state === "locked") {
      a.collectEther(500);
      assert(reads > 0);
      assert.equal(p.questFoodCount, 128);
      assert.equal(p.clanFoodCount, 128);
    }
  }
});

test("idle pickup fast path keeps food motion and expiry in the normal tick", () => {
  const a = new Arena({ etherCount: 0 });
  a.ether = [{ id: "moving", x: 1000, y: 1000, value: 5, radius: 5.5,
    ejected: true, sourceId: "gone", sourcePickupAt: 0, vx: 100, vy: 0, updatedAt: 0, expiresAt: 1000 }];
  a.step(50);
  assert(a.ether[0].x > 1000);
  a.step(1001);
  assert.equal(a.ether.length, 0);
});

test("empty hazard pickup publishes contacts and remains ready for a later eligible body", () => {
  const a = new Arena({ etherCount: 0 });
  const h = a.hazards = new ArenaHazards(a);
  h.nextAt = Infinity;
  const item = h.create(1000, 1000, 0);
  h.items = [item];
  const contact = { type: "hazard", id: "contact" };
  h.contacts = [contact];
  h.collect(50);
  assert.deepEqual(a.combat.contacts, [contact]);
  assert.equal(h.items.length, 0);
  const p = a.addPlayer(50, "p");
  Object.assign(p, { x: 1000, y: 1000, mass: 65, radius: radiusForMass(65), protectedUntil: 0 });
  h.items = [item]; h.nextAt = Infinity;
  h.collect(100);
  assert.equal(h.items.length, 1);
  p.mass = 66; p.radius = radiusForMass(66);
  h.collect(150);
  assert(!h.items.includes(item));
  assert.equal(h.items.length, 40);
  assert.equal(p.mass, 116);
});
