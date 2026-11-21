"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const {
  ArenaStateStream,
  STATE_PROTOCOL,
  MAX_IN_FLIGHT,
} = require("../../src/server/arena/state-stream");

test("Огонь сообщает точную часть и место уничтожения, включая последнюю часть", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "fire");
  arena.tick = 7;
  p.parts = [p.mainPartId, "second"].map((id, i) => ({
    id,
    x: 100 + i * 100,
    y: 200,
    mass: 20,
    radius: radiusForMass(20),
    vx: 0,
    vy: 0,
  }));
  arena.syncParts(p);
  for (const partId of [p.mainPartId, "second"]) {
    const part = arena.bodies(p).find((b) => arena.bodyId(p, b) === partId);
    const expected = {
      type: "partRemoved",
      reason: "fire",
      tick: 7,
      key: p.id + ":" + partId,
      x: part.x,
      y: part.y,
    };
    arena.boosterEffects.burn(p, part, 5000);
    assert.deepEqual(arena.snapshot(5000).visualEvents.at(-1), expected);
    assert.equal(p.dead, partId === "second");
  }
  assert.equal(arena.combat.contacts.length, 2);
});

test("Снятие массы Огнём без уничтожения части не вызывает затухание", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "fire");
  p.mass = 1000;
  p.radius = radiusForMass(1000);
  arena.boosterEffects.burn(p, p, 5000);
  assert.equal(p.mass, 500);
  assert.equal(p.dead, false);
  assert.deepEqual(arena.combat.contacts, []);
});

test("Причина сгорания доходит после задержки ACK и не повторяется", () => {
  const ws = { readyState: 1, bufferedAmount: 0, protocol: STATE_PROTOCOL },
    packets = [];
  const stream = new ArenaStateStream(
    ws,
    (_, data) => packets.push(JSON.parse(data)),
    () => 0,
  );
  const fire = { type: "partRemoved", reason: "fire", key: "a:one", tick: 1, x: 100, y: 200 };
  const state = (tick, visualEvents = []) => ({
    type: "state",
    tick,
    players: [],
    ether: [],
    events: [],
    audioEvents: [],
    visualEvents,
  });
  for (let i = 0; i < MAX_IN_FLIGHT; i++) stream.publish(state(i));
  stream.publish(state(MAX_IN_FLIGHT, [fire]));
  stream.publish(state(MAX_IN_FLIGHT + 1));
  assert.equal(packets.length, MAX_IN_FLIGHT);
  stream.acknowledge(1);
  assert.deepEqual(packets.at(-1).visualEvents, [fire]);
  assert.equal(stream.acknowledge(1), false);
  stream.acknowledge(2);
  stream.publish(state(MAX_IN_FLIGHT + 2));
  assert.deepEqual(packets.at(-1).visualEvents, []);
});
