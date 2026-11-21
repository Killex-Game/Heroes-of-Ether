"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  ArenaStateStream,
  STATE_PROTOCOL,
  MAX_IN_FLIGHT,
} = require("../../src/server/arena/state-stream");

function setup(protocol = STATE_PROTOCOL) {
  const ws = { protocol, readyState: 1, bufferedAmount: 0 },
    packets = [];
  let time = 0;
  const stream = new ArenaStateStream(
    ws,
    (_, data) => packets.push(JSON.parse(data)),
    () => time,
  );
  return {
    ws,
    packets,
    stream,
    setTime: (at) => {
      time = at;
    },
  };
}
const food = (id, x = 10, value = 2) => ({
  id,
  x,
  y: 20,
  radius: 6,
  value,
  ejected: true,
  artValue: 5,
});
test("A blocked receiver does not encode discarded snapshots and resumes with the latest one", () => {
  const { ws, stream, packets } = setup();
  ws.bufferedAmount = 1024 * 1024;
  let encodes = 0;
  for (let tick = 1; tick <= 40; tick++) {
    const player = {
      id: "p",
      toJSON() {
        encodes++;
        return { id: "p", x: tick };
      },
    };
    stream.publish({ type: "state", tick, players: [player], ether: [] });
  }
  assert.equal(encodes, 0);
  assert.equal(packets.length, 0);
  ws.bufferedAmount = 0;
  stream.flush();
  assert.equal(packets.length, 1);
  assert.equal(packets[0].tick, 40);
  assert.equal(packets[0].players[0].x, 40);
  assert.equal(encodes, 1);
});
const state = (tick, ether = [], extra = {}) => ({
  type: "state",
  tick,
  players: [],
  ether,
  events: [],
  audioEvents: [],
  ...extra,
});

test("Primitive entity fields retain JSON semantics through deltas and removals", () => {
  const wire = require("../../public/shared/arena-wire");
  const { stream, packets } = setup(wire.PROTOCOL);
  const decoder = new wire.Decoder();
  const samples = [
    { n: -0, b: false, nil: null, text: '\"quoted\"\\n', optional: undefined },
    { n: NaN, b: true, nil: { nested: [1, null] }, text: "new" },
    { n: Infinity, b: false, text: "", extra: -Infinity },
    { n: 1e-7, b: true, nil: null },
  ];
  for (const [tick, fields] of samples.entries()) {
    const entity = { id: "shot", x: 20, y: 30, ...fields };
    stream.publish(state(tick, [], { projectiles: [entity] }));
    const decoded = decoder.decode(packets.at(-1));
    assert.deepEqual(decoded.projectiles, [JSON.parse(JSON.stringify(entity))]);
    stream.acknowledge(stream.sequence);
  }
});

test("35 receivers encode each shared event once while stalled receivers retain their own queue", () => {
  const protocol = require("../../public/shared/arena-wire").PROTOCOL;
  const peers = Array.from({ length: 35 }, () => setup(protocol));
  peers[0].ws.bufferedAmount = 1024 * 1024;
  let encodes = 0;
  const event = (id) => ({
    toJSON() {
      encodes++;
      return { id, type: "contact", x: 10 };
    },
  });
  const first = state(1, [], {
    events: [event("game")],
    audioEvents: [event("sound")],
    visualEvents: [event("flash")],
  });
  for (const peer of peers) peer.stream.publish(first);
  assert.equal(encodes, 3, "event serialization must not scale with recipient count");
  const second = state(2, [], { events: [event("next")] });
  for (const peer of peers) peer.stream.publish(second);
  assert.equal(encodes, 4);
  for (const peer of peers.slice(1)) {
    assert.deepEqual(
      peer.packets[0].events.map((e) => e.id),
      ["game"],
    );
    assert.deepEqual(
      peer.packets[1].events.map((e) => e.id),
      ["next"],
    );
    assert.deepEqual(peer.packets[1].audioEvents, []);
  }
  peers[0].ws.bufferedAmount = 0;
  peers[0].stream.flush();
  const delayed = peers[0].packets[0];
  assert.equal(delayed.tick, 2);
  assert.deepEqual(
    delayed.events.map((e) => e.id),
    ["game", "next"],
  );
  assert.equal(delayed.audioEvents[0].id, "sound");
  assert.equal(delayed.visualEvents[0].id, "flash");
  assert.equal(encodes, 4);
});

test("Shared encoding keeps separate food history for fast, stalled and newly joined clients", () => {
  const fast = setup(),
    slow = setup(),
    newcomer = setup();
  for (let tick = 0; tick < 20; tick++) {
    const snapshot = state(tick, [food("moving", tick)], {
      players: [{ id: "hero", x: tick }],
      backgroundId: "grass",
    });
    fast.stream.publish(snapshot);
    slow.stream.publish(snapshot);
    fast.stream.acknowledge(fast.packets.at(-1).stateSequence);
    if (tick === 19) newcomer.stream.publish(snapshot);
  }
  assert.equal(slow.packets.length, MAX_IN_FLIGHT);
  slow.stream.acknowledge(MAX_IN_FLIGHT);
  assert.deepEqual(slow.packets.at(-1).players, [{ id: "hero", x: 19 }]);
  assert.deepEqual(slow.packets.at(-1).etherDelta.upsert, [food("moving", 19)]);
  assert.deepEqual(newcomer.packets[0].ether, [food("moving", 19)]);
  assert.equal(newcomer.packets[0].stateSequence, 1);
  assert.equal(fast.packets.at(-1).stateSequence, 20);
  assert.equal(slow.packets.at(-1).backgroundId, "grass");
});

test("Slow renderer: bounded pipeline, latest positions and complete food changes after ACK", () => {
  const { stream, packets } = setup();
  stream.publish(state(0, [food("removed"), food("moving"), food("value")]));
  for (let tick = 1; tick <= 200; tick++)
    stream.publish(state(tick, [food("moving", tick / 10), food("value", 10, 35), food("new")]));
  assert.equal(packets.length, MAX_IN_FLIGHT);
  assert.equal(stream.acknowledge(0), false);
  assert.equal(stream.acknowledge(999), false);
  assert.equal(stream.acknowledge(1), true);
  assert.equal(packets.length, MAX_IN_FLIGHT + 1);
  assert.equal(packets.at(-1).tick, 200);
  assert.equal(packets.at(-1).stateSequence, MAX_IN_FLIGHT + 1);
  assert.equal(packets[1].ether, undefined);
  assert.deepEqual(packets[1].etherDelta.removed, ["removed"]);
  const received = new Map(packets[0].ether.map((orb) => [orb.id, orb]));
  for (const packet of packets.slice(1)) {
    for (const id of packet.etherDelta.removed) received.delete(id);
    for (const orb of packet.etherDelta.upsert) received.set(orb.id, orb);
  }
  assert.deepEqual(
    [...received.values()],
    [food("moving", 20), food("value", 10, 35), food("new")],
  );
  assert.equal(stream.acknowledge(1), false, "duplicate ACK must not release the next state");
  assert.equal(stream.acknowledge(2), true);
  stream.publish(state(201, [...received.values()]));
  assert.deepEqual(packets.at(-1).etherDelta, { upsert: [], removed: [] });
});

test("Full food set on every new connection; unchanged 1224 particles are not retransmitted", () => {
  const { stream, packets } = setup();
  const ether = Array.from({ length: 1224 }, (_, i) => food(String(i), i + 0.0123456));
  const before = structuredClone(ether);
  stream.publish(state(0, ether));
  stream.acknowledge(1);
  stream.publish(state(1, ether));
  assert.equal(packets[0].ether.length, 1224);
  assert.deepEqual(packets[1].etherDelta, { removed: [], upsert: [] });
  assert.ok(JSON.stringify(packets[1]).length < JSON.stringify(packets[0]).length / 100);
  assert.deepEqual(ether, before, "wire rounding must not alter physics or mass");
  const reconnected = setup();
  reconnected.stream.publish(state(2, ether));
  assert.equal(reconnected.packets[0].ether.length, 1224);
});

test("Copies of a W drop share launch data but still replicate movement and poison value changes", () => {
  const wire = require("../../public/shared/arena-wire");
  const { stream, packets } = setup(wire.PROTOCOL);
  const decoder = new wire.Decoder();
  const birth = Object.freeze({ x: 8, y: 20, tick: 1 });
  for (const [i, [x, value]] of [[10, 5], [12, 5], [12, 20], [12, 20]].entries()) {
    const orb = { ...food("e1", x, value), birth };
    stream.publish(state(i + 1, [orb]));
    const packet = packets.at(-1);
    decoder.decode(packet);
    assert.deepEqual([...decoder.food.values()], [orb]);
    if (i === 1) assert.ok(packet.foodDelta.moves);
    if (i === 2) assert.equal(packet.foodDelta.upsert.length, 1);
    stream.acknowledge(stream.sequence);
  }
});

test("Cached natural food invalidates on movement, metadata changes, removed keys and nested edits", () => {
  const { stream, packets } = setup();
  const orb = food("natural");
  delete orb.ejected;
  const publish = (tick) => {
    stream.acknowledge(stream.sequence);
    stream.publish(state(tick, [orb]));
  };
  publish(1);
  publish(2);
  assert.deepEqual(packets.at(-1).etherDelta.upsert, []);
  orb.x = 450;
  publish(3);
  assert.equal(packets.at(-1).etherDelta.upsert[0].x, 450);
  orb.value = 10;
  delete orb.artValue;
  publish(4);
  assert.deepEqual(packets.at(-1).etherDelta.upsert, [orb]);
  orb.future = { state: 1 };
  publish(5);
  orb.future.state = 2;
  publish(6);
  assert.deepEqual(packets.at(-1).etherDelta.upsert, [orb]);
  assert.equal(packets[4].etherDelta.upsert[0].future.state, 1);
});

test("Coalescing preserves fresh visual events and rankings, bounds and expires stale effects", () => {
  const { stream, packets, setTime } = setup();
  for (let i = 0; i < MAX_IN_FLIGHT; i++) stream.publish(state(0));
  stream.publish(
    state(1, [], {
      leaderboard: [{ id: "winner" }],
      audioEvents: [{ id: "mine", type: "mine" }],
      events: [{ type: "absorbed", lifeId: "life" }],
      visualEvents: [{ type: "projectileContact", tick: 1, shot: { id: "hook", x: 10, y: 20 } }],
    }),
  );
  stream.publish(state(2));
  stream.acknowledge(1);
  assert.deepEqual(packets.at(-1).leaderboard, [{ id: "winner" }]);
  assert.equal(packets.at(-1).audioEvents[0].id, "mine");
  assert.equal(packets.at(-1).events[0].lifeId, "life");
  assert.equal(packets.at(-1).visualEvents[0].shot.id, "hook");
  for (let i = 0; i < 500; i++) stream.publish(state(i, [], { audioEvents: [{ id: String(i) }] }));
  assert.ok(stream.audioEvents.size <= 128);
  setTime(3000);
  stream.acknowledge(2);
  assert.deepEqual(packets.at(-1).audioEvents, []);
  assert.deepEqual(packets.at(-1).visualEvents, [], "подтверждённый контакт не повторяется");
});

test("150 ms RTT does not throttle a 20 Hz arena to one snapshot per round trip", () => {
  const { stream, packets, setTime } = setup();
  const acks = [];
  let inspected = 0;
  for (let at = 0; at <= 5000; at += 10) {
    setTime(at);
    while (acks.length && acks[0].at <= at) stream.acknowledge(acks.shift().sequence);
    if (at % 50 === 0) stream.publish(state(at / 50));
    while (inspected < packets.length)
      acks.push({ at: at + 150, sequence: packets[inspected++].stateSequence });
    assert.ok(stream.sequence - stream.acknowledgedSequence <= MAX_IN_FLIGHT);
  }
  assert.equal(packets.length, 101);
  assert.equal(stream.acknowledge(stream.sequence + 1), false);
  assert.equal(stream.acknowledge(stream.sequence), true);
  assert.equal(stream.inFlight, null);
});

test("Legacy and ACK clients coalesce snapshots while socket is congested and resume once writable", () => {
  for (const protocol of ["", STATE_PROTOCOL]) {
    const { stream, packets, ws } = setup(protocol);
    ws.bufferedAmount = 900000;
    for (let i = 0; i < 300; i++) stream.publish(state(i, [food(String(i))]));
    assert.equal(packets.length, 0);
    ws.bufferedAmount = 0;
    stream.publish(state(300, [food("latest")]));
    assert.equal(packets.length, 1);
    assert.equal(packets[0].tick, 300);
    assert.deepEqual(packets[0].ether, [food("latest")]);
    if (!protocol) {
      stream.publish(state(301));
      assert.equal(packets.length, 2);
      assert.equal(packets[1].stateSequence, undefined);
    }
  }
});
