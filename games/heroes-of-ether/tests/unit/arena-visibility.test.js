"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const visibility = require("../../src/server/arena/visibility");
const { ArenaStateStream } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
const world = { width: 3600, height: 2400 };
const body = (id, x, y = 300, radius = 10) => ({ id, x, y, radius, mass: 50 });
const snapshot = (tick) => ({
  type: "state",
  tick,
  world,
  players: [
    { ...body("me", 3000), parts: [body("one", 3000), body("two", 100)] },
    { ...body("near", 300), parts: [body("n", 300)] },
    { ...body("far", 3000), parts: [body("f", 3000)] },
    { ...body("large", 900, 300, 200), parts: [body("l", 900, 300, 200)] },
  ],
  ether: [body("nearFood", 300), body("farFood", 3000)],
  projectiles: [body("nearShot", 400), body("farShot", 3000)],
  hazards: [body("nearHazard", 400), body("farHazard", 3000)],
  events: [],
  audioEvents: [],
  visualEvents: [],
  leaderboard: [{ id: "far", mass: 9000 }],
});
const near = { x: 300, y: 300, width: 200, height: 200 };

test("food grid matches inclusive brute force across small and wide cameras and outlying rows", () => {
  for (const special of [[],[body("outside",-300,512,64)],[body("huge",500,500,100000)]]) {
    const s=snapshot(1);
    s.ether=Array.from({length:1600},(_,i)=>body("f"+i,(i*137)%3600,(i*179)%2400,i%19));
    s.ether.push(...special,body("edge",768,512,0));
    const copy=structuredClone(s);
    for(let i=0;i<70;i++) {
      const request={x:(i*167)%4200,y:(i*83)%3000,width:i%3?400:2800,height:i%4?300:2100};
      const v=visibility.select(s,request,"me");
      if(!v)continue;
      const [left,top,right,bottom]=v.key.split(":").map(Number);
      assert.deepEqual([...v.ether],s.ether.filter(p=>p.x+p.radius>=left&&p.x-p.radius<=right&&
        p.y+p.radius>=top&&p.y-p.radius<=bottom).map(p=>p.id));
    }
    assert.deepEqual(s,copy);
  }
});
test("Sparse food visibility crosses bitset words and empties without stale or missing particles", () => {
  const decoder = new wire.Decoder();
  const ws = { protocol: wire.PROTOCOL, readyState: 1, bufferedAmount: 0 };
  const stream = new ArenaStateStream(ws, (_, bytes) => decoder.decode(JSON.parse(bytes)), () => 0);
  stream.viewport = near;
  const masks = [[0, 31, 32, 63, 64, 127, 255, 256, 320], [], [31, 64, 255], [0, 32, 256, 320]];
  for (const [tick, visible] of masks.entries()) {
    const s = snapshot(tick);
    s.ether = Array.from({ length: 321 }, (_, i) => ({
      ...body("e" + i.toString(36), visible.includes(i) ? 300 + tick : 3000),
      ejected: true, value: tick + 1,
    }));
    stream.publish(s);
    assert.deepEqual([...decoder.food.keys()].sort(), visible.map(i => "e" + i.toString(36)).sort());
    for (const row of decoder.food.values()) assert.equal(row.value, tick + 1);
    stream.acknowledge(stream.sequence);
  }
});
test("Overlapping cameras keep independent food histories across reorders, skips and full views", () => {
  const peers = [300, 1100].map(x => {
    const decoder = new wire.Decoder(), ws = { protocol: wire.PROTOCOL, readyState: 1, bufferedAmount: 0 };
    const stream = new ArenaStateStream(ws, (_, bytes) => decoder.decode(JSON.parse(bytes)), () => 0);
    stream.viewport = { ...near, x };
    return { stream, decoder, ws };
  });
  for (let tick = 0; tick < 9; tick++) {
    const s = snapshot(tick);
    s.ether = Array.from({ length: 97 }, (_, i) => {
      const n = i + tick;
      return { ...body("e" + n.toString(36), (n * 47 + tick * 95) % 3600),
        ejected: true, value: n % 9 ? 5 : tick + 1 };
    });
    if (tick % 2) s.ether.reverse();
    if (tick === 5) peers[0].stream.viewport = null;
    if (tick === 7) peers[0].stream.viewport = near;
    for (const [i, peer] of peers.entries()) {
      peer.ws.bufferedAmount = i === 1 && tick % 3 === 1 ? 100000 : 0;
      peer.stream.acknowledge(peer.stream.sequence);
      peer.stream.publish(s);
      if (peer.ws.bufferedAmount) continue;
      const camera = visibility.select(s, peer.stream.viewport);
      const expected = s.ether.filter(row => !camera || camera.ether.has(row.id));
      assert.deepEqual(peer.decoder.food, new Map(expected.map(row => [row.id, row])));
    }
  }
});
test("Dense visibility preserves snapshot order, boundary contacts and overlapping parts", () => {
  const s = snapshot(1);
  s.ether = Array.from({ length: 610 }, (_, i) =>
    body("e" + i, (i * 97) % world.width, (i * 139) % world.height, i % 17));
  s.ether.push(body("tangent", 1024 + 24, 400, 24));
  s.players = Array.from({ length: 35 }, (_, i) => ({
    id: "p" + i, parts: s.ether.slice(i * 16, (i + 1) * 16),
  }));
  for (const x of [300, 1000, 1150, 2000, 3050, 3300]) {
    const v = visibility.select(s, { ...near, x }, "own");
    const [left, top, right, bottom] = v.key.split(":").map(Number);
    const touches = (p) => p.x + p.radius >= left && p.y + p.radius >= top &&
      p.x - p.radius <= right && p.y - p.radius <= bottom;
    assert.deepEqual([...v.ether], s.ether.filter(touches).map(p => p.id));
    assert.deepEqual([...v.players], [...s.players.filter(p => p.parts.some(touches)).map(p => p.id), "own"]);
  }
});
test("Visibility includes intersecting large parts, margin and every own part, without touching physics", () => {
  const s = snapshot(1),
    copy = structuredClone(s),
    v = visibility.select(s, near, "me");
  assert.deepEqual([...v.players].sort(), ["large", "me", "near"]);
  for (const [key, id] of [
    ["ether", "nearFood"],
    ["projectiles", "nearShot"],
    ["hazards", "nearHazard"],
  ])
    assert.deepEqual([...v[key]], [id]);
  assert.deepEqual(s, copy);
  assert.equal(visibility.viewport({ ...near, x: NaN }, world), null);
  assert.equal(visibility.viewport({ ...near, width: -1 }, world), null);
  assert.equal(visibility.viewport({ ...near, width: 1e10 }, world).width, 7200);
});

test("Food grid matches exact intersections at world edges and for multicell objects", () => {
  // Non-cell-aligned world edges exercise partial cells. Zero-sized particles,
  // tangencies and oversized objects must remain visible exactly once and in
  // snapshot order; a grid cell's presence alone cannot decide boundary cases.
  const s = { ...snapshot(1), world: { width: 6113, height: 4077 } };
  s.ether = Array.from({ length: 1200 }, (_, i) =>
    body("edge" + i, (i * 97) % 6500 - 180, (i * 139) % 4500 - 150,
      [0, 5, 24, 257, 700][i % 5]));
  s.ether.push(body("tangent-in", 1024, 256, 0), body("tangent-out", 1024.01, 256, 0));
  for (const x of [0, 100, 500, 1900, 4000, 6100])
    for (const y of [0, 900, 4077])
      for (const width of [32, 800, 2200]) {
        const v = visibility.select(s, { x, y, width, height: width * 0.7 }, "me");
        assert.ok(v);
        const [left, top, right, bottom] = v.key.split(":").map(Number);
        const expected = s.ether.filter(p => p.x + p.radius >= left && p.x - p.radius <= right &&
          p.y + p.radius >= top && p.y - p.radius <= bottom).map(p => p.id);
        assert.deepEqual([...v.ether], expected);
      }
});
test("AoI deltas remove and reintroduce objects, preserve rankings/count, coalesce slow clients, reconnect cleanly", () => {
  const ws = { readyState: 1, bufferedAmount: 0, playerId: "me", protocol: wire.PROTOCOL };
  let decoder = new wire.Decoder();
  const packets = [];
  const make = () =>
    new ArenaStateStream(
      ws,
      (_, data) => packets.push(decoder.decode(JSON.parse(data))),
      () => 0,
    );
  let stream = make();
  stream.viewport = near;
  stream.publish(snapshot(1));
  assert.equal(packets.at(-1).playerCount, 4);
  assert.deepEqual(packets.at(-1).leaderboard, [{ id: "far", mass: 9000 }]);
  assert.equal(packets.at(-1).players.find((p) => p.id === "me").parts.length, 2);
  stream.acknowledge(1);
  stream.viewport = { ...near, x: 3000 };
  stream.publish(snapshot(2));
  assert.ok(packets.at(-1).etherDelta.removed.includes("nearFood"));
  assert.ok(packets.at(-1).etherDelta.upsert.some((x) => x.id === "farFood"));
  for (let i = 3; i <= 20; i++) stream.publish(snapshot(i));
  stream.viewport = near;
  stream.publish(snapshot(21));
  stream.acknowledge(stream.sequence);
  assert.equal(packets.at(-1).tick, 21);
  assert.deepEqual(
    packets
      .at(-1)
      .players.map((p) => p.id)
      .sort(),
    ["large", "me", "near"],
  );
  assert.deepEqual([...decoder.food.keys()], ["nearFood"]);
  decoder = new wire.Decoder();
  stream = make();
  stream.viewport = near;
  stream.publish(snapshot(22));
  assert.deepEqual([...decoder.food.keys()], ["nearFood"]);
  assert.equal(packets.at(-1).stateSequence, 1);
});
