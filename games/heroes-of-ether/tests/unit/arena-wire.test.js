"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const wire = require("../../public/shared/arena-wire");
const { ArenaStateStream } = require("../../src/server/arena/state-stream");
function client(protocol = wire.PROTOCOL) {
  const ws = { readyState: 1, bufferedAmount: 0, protocol };
  const buffers = [],
    packets = [],
    decoder = new wire.Decoder();
  const stream = new ArenaStateStream(
    ws,
    (_, data) => {
      buffers.push(data);
      packets.push(decoder.decode(JSON.parse(data)));
    },
    () => 0,
  );
  return { ws, stream, buffers, packets, decoder };
}

test("Ejected food cache preserves movement, metadata changes, room isolation and old frames", () => {
  const a = client(),
    b = client();
  const birth = { tick: 1, x: 10, y: 20 },
    otherBirth = { ...birth };
  const orb = { id: "same-room-local-id", x: 11, y: 21, value: 5, radius: 2, ejected: true, birth };
  let tick = 0;
  const publish = (c, value) => {
    c.stream.publish(state(++tick, [], [{ ...value }]));
    c.stream.acknowledge(c.stream.sequence);
    assert.deepEqual(
      [...c.decoder.food.values()],
      [{ ...value, x: Math.round(value.x * 10) / 10, y: Math.round(value.y * 10) / 10 }],
    );
    return JSON.parse(c.buffers.at(-1));
  };
  publish(a, orb);
  const first = structuredClone(a.packets[0]);
  const original = a.packets[0];
  assert.equal(publish(a, { ...orb, x: 11.01 }).foodDelta.upsert.length, 0);
  assert.equal(publish(a, { ...orb, x: 12 }).foodDelta.upsert[0].length, 3);
  assert.equal(publish(a, { ...orb, x: 12, value: 8 }).foodDelta.upsert[0][3].value, 8);
  publish(b, { ...orb, x: 900, color: "red", birth: otherBirth });
  birth.x = 15;
  publish(a, { ...orb, x: 13 });
  publish(a, { ...orb, extra: { quantity: 3 } });
  publish(a, { ...orb, extra: { quantity: 4 } });
  assert.deepEqual(original, first);
  assert.equal(b.decoder.food.get(orb.id).x, 900);
});

test("Projectile and hazard deltas retain exact geometry, metadata, order and old frame immutability", () => {
  const a = client(),
    b = client(),
    legacy = client(wire.LEGACY_PROTOCOL),
    stalled = client();
  stalled.ws.bufferedAmount = 100000;
  const frames = [
    {
      projectiles: [{ id: "held", held: true, x: 10.1234567, y: 8, length: 20 }],
      hazards: [{ id: "thorn", x: 50, y: 60, mass: 50, radius: 12 }],
    },
    {
      projectiles: [
        { id: "shot", x: 2, y: 3, dx: 0.70710678, dy: 0.70710678 },
        { id: "held", held: true, x: 11, y: 9, length: 21 },
      ],
      hazards: [{ id: "thorn", x: 50, y: 60, mass: 100, radius: 17 }],
    },
    { projectiles: [{ id: "held", x: 11, y: 9, landed: true }], hazards: [] },
    { projectiles: [], hazards: [{ id: "egg", type: "blue", x: 100, y: 120, mass: 50 }] },
  ];
  const saved = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = { ...state(i, []), ...frames[i] };
    for (const c of [a, b, legacy, stalled]) c.stream.publish(frame);
    for (const c of [a, b, legacy]) {
      assert.deepEqual(c.packets.at(-1).projectiles, frame.projectiles);
      assert.deepEqual(c.packets.at(-1).hazards, frame.hazards);
      c.stream.acknowledge(c.stream.sequence);
    }
    assert.equal(a.buffers.at(-1), b.buffers.at(-1));
    saved.push(structuredClone(a.packets.at(-1)));
  }
  assert.deepEqual(a.packets, saved);
  const raw = JSON.parse(a.buffers[2]);
  assert.equal(raw.projectiles, undefined);
  assert.deepEqual(raw.projectilesDelta.removed, ["shot"]);
  assert.deepEqual(raw.projectilesDelta.upsert[0].unset, ["held", "length"]);
  assert.ok(Array.isArray(JSON.parse(legacy.buffers[2]).projectiles));
  stalled.ws.bufferedAmount = 0;
  stalled.stream.flush();
  assert.deepEqual(stalled.packets.at(-1).hazards, frames.at(-1).hazards);
  assert.deepEqual(stalled.packets.at(-1).projectiles, []);
});

test("Stationary mine/web/stone and hazards are sent once, then removed on leaving the viewport", () => {
  const c = client();
  const frame = {
    ...state(1, []),
    world: { width: 5000, height: 4000 },
    projectiles: ["mine", "web", "stone"].map((boosterId, i) => ({
      id: boosterId,
      boosterId,
      x: 150 + i * 10,
      y: 150,
      landed: true,
      moving: false,
    })),
    hazards: [{ id: "thorn", x: 150, y: 150, radius: 25, mass: 50 }],
  };
  c.stream.viewport = { x: 150, y: 150, width: 600, height: 400 };
  c.stream.publish(frame);
  c.stream.acknowledge(1);
  c.stream.publish({ ...frame, tick: 2 });
  const unchanged = JSON.parse(c.buffers.at(-1));
  assert.deepEqual(unchanged.projectilesDelta, { removed: [], upsert: [] });
  assert.deepEqual(unchanged.hazardsDelta, { removed: [], upsert: [] });
  c.stream.acknowledge(2);
  c.stream.viewport = { x: 4000, y: 3000, width: 600, height: 400 };
  c.stream.publish({ ...frame, tick: 3 });
  assert.deepEqual(c.packets.at(-1).projectiles, []);
  assert.deepEqual(c.packets.at(-1).hazards, []);
  c.stream.acknowledge(3);
  c.stream.viewport = { x: 150, y: 150, width: 600, height: 400 };
  c.stream.publish({ ...frame, tick: 4 });
  assert.deepEqual(c.packets.at(-1).projectiles, frame.projectiles);
  assert.deepEqual(c.packets.at(-1).hazards, frame.hazards);
});
const part = (id, x = 0) => ({
  id,
  x,
  y: 20,
  mass: 50,
  radius: 30,
  mergeVersion: 0,
  mergeMs: 0,
  burnMs: 0,
});
const state = (tick, players, ether = []) => ({
  type: "state",
  tick,
  players,
  ether,
  events: [],
  audioEvents: [],
  visualEvents: [],
});
test("v5 decodes the same formations and moving projectiles as v4 after stalls and reorders", () => {
  const current = client(), old = client(wire.PRESENTATION_PROTOCOL);
  let sawParts = false, sawShots = false;
  const makePart = (i, t) => ({
    ...part("cell-" + i, 5800.21 - t * (i + 0.33)),
    y: 0.03 + i * t / 9, mass: 732.123456789 - i * t / 13,
    mergeMs: 3434232 - 50 * t, burnMs: t * 0.02, mergeVersion: t % 2,
    ...(i === 1 && t <= 3 ? { birth: { tick: 1, x: 4, y: 5 } } : {}),
  });
  for (let t = 1; t <= 10; t++) {
    const parts = Array.from({ length: t < 5 ? 12 : 16 }, (_, i) => makePart(i, t));
    const shots = ["held", "fire", ...(t >= 4 ? ["moving"] : [])]
      .map((id, i) => ({ id, x: 200 / (i + t), y: 4000 - t * 0.01234567, landed: false }));
    if (t >= 4) shots.reverse();
    const snapshot = { ...state(t, [{ id: "p", parts }]), projectiles: shots };
    for (const peer of [old, current]) {
      peer.ws.bufferedAmount = t === 6 || t === 7 ? 100000 : 0;
      peer.stream.publish(snapshot);
      peer.stream.acknowledge(peer.stream.sequence);
    }
    assert.deepEqual(current.packets.at(-1).players, old.packets.at(-1).players);
    assert.deepEqual(current.packets.at(-1).projectiles, old.packets.at(-1).projectiles);
    const raw = JSON.parse(current.buffers.at(-1));
    sawParts ||= typeof raw.playersDelta.upsert[0]?.parts === "string";
    sawShots ||= !!raw.projectilesDelta.moves;
    assert.equal(JSON.parse(old.buffers.at(-1)).projectilesDelta.moves, undefined);
  }
  assert.ok(sawParts && sawShots);
});
test("v4 and v3 peers sharing a snapshot receive the same W positions across skipped ticks", () => {
  const current = client(), legacy = client(wire.ENTITY_PROTOCOL);
  const pellet = { id: "e1z141z3", ejected: true, x: 10, y: 11, value: 5 };
  const absorption = {
    type: "absorbed", victimId: "p", victimPartId: "part", tick: 1, victimX: 7, victimY: 8,
    lifeId: "life", killer: { name: "Other" },
  };
  const first = { ...state(1, [], [pellet]), events: [absorption] };
  for (const peer of [legacy, current]) peer.stream.publish(first);
  assert.deepEqual(legacy.packets[0].events[0], absorption);
  assert.deepEqual(current.packets[0].events[0], {
    type: "absorbed", victimId: "p", victimPartId: "part", tick: 1, victimX: 7, victimY: 8,
  });
  const next = state(2, [], [{ ...pellet, x: 6553.5, y: 0.1 }]);
  for (const peer of [current, legacy]) peer.stream.publish(next);
  assert.ok(JSON.parse(current.buffers[1]).foodDelta.moves);
  assert.equal(JSON.parse(legacy.buffers[1]).foodDelta.moves, undefined);
  assert.deepEqual(current.packets[1].etherDelta, legacy.packets[1].etherDelta);
  current.ws.bufferedAmount = 100000;
  current.stream.publish(state(3, [], []));
  current.stream.publish(state(4, [], [{ ...pellet, x: 7000, value: 8 }]));
  current.ws.bufferedAmount = 0;
  current.stream.flush();
  assert.deepEqual(current.decoder.food.get(pellet.id), { ...pellet, x: 7000, value: 8 });
  assert.deepEqual(current.packets[0].etherDelta.upsert, [pellet]);
});
test("Compact state reconstructs split, merge, fire, appearance, departure and food metadata, without mutating previous frames", () => {
  const c = client();
  const frames = [
    state(
      1,
      [{ id: "p", name: "First", parts: [part("a")] }],
      [{ id: "food", x: 0, y: 0, value: 5, birth: { x: 2 } }],
    ),
    state(
      2,
      [
        {
          id: "p",
          name: "First",
          parts: [part("a", 5), { ...part("b", 4), birth: { x: 5, y: 20 } }],
        },
      ],
      [{ id: "food", x: 5, y: 0, value: 5, birth: { x: 2 } }],
    ),
    state(
      3,
      [
        {
          id: "p",
          name: "New",
          parts: [{ ...part("a", 8), burnMs: 2000 }, part("b", 9)],
          departure: { remainingMs: 500 },
        },
      ],
      [{ id: "food", x: 10, y: 0, value: 5 }],
    ),
    state(4, [{ id: "p", name: "New", parts: [{ ...part("a", 12), mass: 100, radius: 40 }] }], []),
    state(5, [], []),
    state(
      6,
      [{ id: "p", name: "Respawn", parts: [part("c")] }],
      [{ id: "food", x: 9, y: 9, value: 1 }],
    ),
  ];
  const saved = [];
  for (const snapshot of frames) {
    c.stream.publish(snapshot);
    c.stream.acknowledge(c.stream.sequence);
    const packet = c.packets.at(-1);
    assert.deepEqual(packet.players, snapshot.players);
    assert.deepEqual([...c.decoder.food.values()], snapshot.ether);
    saved.push(structuredClone(packet));
  }
  assert.deepEqual(c.packets, saved);
  assert.equal(new wire.Decoder().decode({ players: [{ id: "legacy" }] }).players[0].id, "legacy");
});
test("Compact coalescing and reconnect use each connection's actual history", () => {
  const fast = client(),
    slow = client(),
    newcomer = client();
  for (let tick = 0; tick < 50; tick++) {
    const snapshot = state(
      tick,
      [{ id: "p", parts: tick < 10 ? [part("old", tick)] : [part("new", tick)] }],
      [{ id: "f", x: tick, y: 0, value: 5 }],
    );
    fast.stream.publish(snapshot);
    slow.stream.publish(snapshot);
    fast.stream.acknowledge(fast.stream.sequence);
    if (tick === 49) newcomer.stream.publish(snapshot);
  }
  assert.equal(slow.packets.length, 4);
  slow.stream.acknowledge(4);
  for (const c of [slow, newcomer]) {
    assert.deepEqual(c.packets.at(-1).players, fast.packets.at(-1).players);
    assert.deepEqual([...c.decoder.food.values()], [...fast.decoder.food.values()]);
  }
});
test("Identical receiver histories share UTF-8 buffers; skipped histories remain isolated", () => {
  const a = client(),
    b = client();
  for (let i = 0; i < 5; i++) {
    const snapshot = state(i, [{ id: "p", parts: [part("a", i)] }]);
    a.stream.publish(snapshot);
    b.stream.publish(snapshot);
    a.stream.acknowledge(a.stream.sequence);
    b.stream.acknowledge(b.stream.sequence);
    assert.ok(Buffer.isBuffer(a.buffers.at(-1)));
    assert.equal(a.buffers.at(-1), b.buffers.at(-1));
  }
  const newcomer = client(),
    snapshot = state(9, [{ id: "p", parts: [part("a", 9)] }]);
  a.stream.publish(snapshot);
  newcomer.stream.publish(snapshot);
  assert.notEqual(a.buffers.at(-1), newcomer.buffers.at(-1));
  assert.deepEqual(a.packets.at(-1).players, newcomer.packets.at(-1).players);
});
