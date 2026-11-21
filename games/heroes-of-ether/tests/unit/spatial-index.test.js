/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CircleIndex } = require("../../src/server/arena/spatial-collision-index");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");

function seeded(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}

test("ordinal queries reuse only an explicitly supplied buffer and preserve candidate order", () => {
  const bodies = Array.from({ length: 130 }, (_, id) => ({ id, x: id * 10, y: 0, radius: 20 }));
  const index = new CircleIndex(bodies, 64), buffer = [999];
  const regions = [{ x: 200, y: 0, radius: 180 }, { x: 900, y: 0, radius: 240 }];
  const retained = index.queryOrdinals(regions);
  assert.deepEqual(retained.map(i => bodies[i]), index.queryMany(regions));
  assert.equal(index.queryOrdinals(regions, buffer), buffer);
  assert.deepEqual(buffer, retained);
  assert.equal(index.queryOrdinals([{x:9000,y:9000,radius:1}], buffer), buffer);
  assert.deepEqual(buffer, []);
  assert.ok(retained.length > 0);
  assert.deepEqual(bodies.map(x => Object.keys(x)), bodies.map(() => ['id','x','y','radius']));
});

test("independent candidate queries retain their contents and do not mutate food", () => {
  const food = [{ x: -100, y: 0, radius: 5.5 }, { x: 100, y: 0, radius: 5.5 }, { x: 5000, y: 0, radius: 9 }];
  const saved = structuredClone(food), index = new CircleIndex(food, 64);
  const region = { x: 0, y: 0, radius: 180 };
  const retained = index.query(region);
  assert.deepEqual(retained, food.slice(0, 2));
  assert.deepEqual(index.queryMany([region]), food.slice(0, 2));
  assert.deepEqual(index.queryMany([{ x: 5000, y: 0, radius: 20 }]), [food[2]]);
  assert.deepEqual(index.queryMany([{ x: 9000, y: 9000, radius: 1 }]), []);
  assert.deepEqual(retained, food.slice(0, 2));
  assert.deepEqual(food, saved);
});

test("numeric cell coordinates cannot alias across signed 16-bit bounds; query epoch rollover is safe", () => {
  const cells=[-65536,-32769,-32768,-1,0,32767,32768,65535,65536];
  const bodies=cells.flatMap(x=>cells.map(y=>({x:x*64+32,y:y*64+32,radius:1})));
  for(const centersOnly of [false,true]) {
    const index = new CircleIndex(bodies, 64, centersOnly);
    assert.deepEqual(index.queryMany(bodies),bodies);
    index.querySerial = 0xfffffffe;
    // Every ordinary and overflow bucket previously had visited === 1.
    assert.deepEqual(index.queryMany(bodies),bodies);
    for (const body of bodies) assert.deepEqual(index.query(body), [body]);
  }
});

test("Candidate suffix preserves word boundaries, union order and repeated queries", () => {
  const bodies = Array.from({ length: 130 }, (_, id) => ({ id, x: id * 10, y: 0, radius: 20 }));
  for (const centersOnly of [false, true]) {
    const index = new CircleIndex(bodies, 64, centersOnly);
    const regions = [{ x: 200, y: 0, radius: 180 }, { x: 900, y: 0, radius: 240 }];
    const all = index.queryMany(regions);
    for (const start of [0, 1, 31, 32, 33, 63, 64, 65, 96, 129, 130, 150, 0]) {
      assert.deepEqual(index.queryMany(regions, start), all.filter(body => body.id >= start));
      const one = index.query(regions[0]);
      assert.deepEqual(index.query(regions[0], start), one.filter(body => body.id >= start));
    }
  }
});

test("Absorption index falls back safely for non-monotonic imported radii", () => {
  const arena = new Arena({ etherCount: 0, random: seeded(19) });
  for (let i = 0; i < 35; i++) {
    const p = arena.addPlayer(0, `radius-${i}`);
    p.protectedUntil = 0;
    p.parts = Array.from({ length: 4 }, (_, j) => ({
      id: `${i}-${j}`, x: 500 + i * 30, y: 500 + j * 50,
      mass: 1000 + i * 10 + j, radius: 20 + ((i * 7 + j * 11) % 13) * 8,
    }));
    p.mainPartId = p.parts[0].id;
    arena.syncParts(p);
  }
  const linear = new Arena({ etherCount: 0, spatialIndex: false });
  linear.players = structuredClone(arena.players);
  assert.deepEqual(arena.resolveAbsorptions(5000), linear.resolveAbsorptions(5000));
  assert.deepEqual(arena.players, linear.players);
});

test("Food index preserves linear pickup order, growth, caps, bow bonuses and W pickup delay", () => {
  let consumed = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const random = seeded(seed),
      indexed = new Arena({ etherCount: 0, random });
    for (let i = 0; i < 8; i++) {
      const p = indexed.addPlayer(0, `p${i}`);
      p.level = i % 2 ? 1 : 501;
      p.outfit = i % 2 ? { bow: "novice_bow" } : {};
      if (i === 2) p.effects.lock = 5000;
      p.parts = Array.from({ length: 4 }, (_, j) => {
        const mass = 2 + Math.floor(random() * 5000);
        return {
          id: `${i}-${j}`,
          x: random() * 1500,
          y: random() * 1500,
          mass,
          radius: radiusForMass(mass),
        };
      });
      indexed.syncParts(p);
    }
    indexed.ether = Array.from({ length: 400 }, (_, i) => ({
      id: `f${i}`,
      x: random() * 1800,
      y: random() * 1800,
      value: 1 + Math.floor(random() * 10),
      ...(i % 2 ? { ejected: true, sourceId: `p${i % 8}`, sourcePickupAt: 5000 } : {}),
    }));
    const linear = new Arena({ etherCount: 0, spatialIndex: false });
    linear.players = structuredClone(indexed.players);
    linear.ether = structuredClone(indexed.ether);
    indexed.collectEther(1000);
    linear.collectEther(1000);
    assert.deepEqual(indexed.ether, linear.ether, `food seed ${seed}`);
    assert.deepEqual(indexed.players, linear.players, `players seed ${seed}`);
    consumed += 400 - indexed.ether.length;
  }
  assert.ok(consumed > 1000);
});

test("Food pickup refreshes its candidates after a large gain and wall clamp in the same tick", () => {
  const run = (spatialIndex) => {
    const arena = new Arena({ etherCount: 0, spatialIndex, random: seeded(19) });
    const p = arena.addPlayer(0, "p");
    Object.assign(p, { x: 15, y: 400, mass: 20, radius: radiusForMass(20), level: 501 });
    arena.ether = Array.from({ length: 128 }, (_, i) => ({
      id: "far" + i, x: 2300 + i, y: 1800, value: 1, radius: 3,
    }));
    arena.ether.push({ id: "edge", x: 350, y: 400, value: 5, radius: 3 });
    arena.ether.push({ id: "growth", x: 15, y: 400, value: 25000, radius: 3 });
    arena.collectEther(1000);
    return { mass: p.mass, left: arena.ether.map((orb) => orb.id) };
  };
  const linear = run(false);
  assert.ok(!linear.left.includes("edge"));
  assert.deepEqual(run(true), linear);
});

test("Пространственный индекс: все пересекающиеся круги, без дублей и с исходным порядком", () => {
  const random = seeded(42);
  const bodies = Array.from({ length: 512 }, (_, id) => ({
    id,
    x: random() * 6000 - 500,
    y: random() * 6000 - 500,
    radius: 10 + random() * 450,
  }));
  bodies.push({ id: 512, x: 0, y: 0, radius: 256 }, { id: 513, x: 512, y: 0, radius: 256 });
  const index = new CircleIndex(bodies);
  for (const body of bodies) {
    const candidates = index.query(body),
      ids = candidates.map((p) => p.id);
    assert.deepEqual(
      ids,
      [...new Set(ids)].sort((a, b) => a - b),
    );
    for (const other of bodies) {
      if (Math.hypot(body.x - other.x, body.y - other.y) <= body.radius + other.radius) {
        assert.ok(candidates.includes(other), `missing ${body.id} / ${other.id}`);
      }
    }
  }
});

test("Некорректные координаты и слишком большой запрос не зацикливают индекс", () => {
  for (const body of [
    { x: Infinity, y: 0, radius: 1 },
    { x: NaN, y: 0, radius: 1 },
    { x: 1e30, y: 0, radius: 1 },
    { x: 0, y: 0, radius: -1 },
    { x: 0, y: 0, radius: 1e8 },
  ]) {
    assert.throws(() => new CircleIndex([body]), RangeError);
  }
  assert.throws(() => new CircleIndex([], 0), RangeError);
});

test("Centre-only absorption index preserves order and includes every centre inside the search circle", () => {
  const random = seeded(1106);
  const bodies = Array.from({ length: 560 }, (_, id) => ({
    id, x: random() * 6400 - 100, y: random() * 4300 - 100,
    radius: radiusForMass(2 + random() * 480000),
  }));
  bodies.push({ id: 560, x: 256, y: -256, radius: 1 });
  const index = new CircleIndex(bodies, 256, true);
  for (const body of bodies) {
    const found = index.query(body);
    assert.deepEqual(found.map(b => b.id), [...new Set(found.map(b => b.id))].sort((a,b) => a-b));
    for (const other of bodies)
      if (Math.hypot(body.x - other.x, body.y - other.y) <= body.radius)
        assert.ok(found.includes(other));
  }
  // A huge radius must not duplicate a centre into hundreds of cells.
  const buckets = [...index.cells.values(),
    ...[...index.wideCells.values()].flatMap(column => [...column.values()])];
  let memberships = 0;
  for (const bucket of buckets) for (let i=1;i<bucket.length;i+=2)
    for (let mask=bucket[i];mask;mask&=mask-1) memberships++;
  assert.equal(memberships,bodies.length);
});

test("35 fully split players: centre index matches exhaustive absorption at mixed mass and protection", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const random = seeded(seed), arena = new Arena({ etherCount: 0, random });
    for (let i = 0; i < 35; i++) {
      const p = arena.addPlayer(0, `player-${i}`);
      p.level = 501;
      p.protectedUntil = i % 7 === 0 ? 10000 : 0;
      if (i % 9 === 0) p.effects.lock = 10000;
      if (i % 11 === 0) { p.isRemnant = true; p.removeAt = i % 2 ? 10000 : 5500; }
      const totalMass = [20, 50, 150, 1000, 5000, 25000, 75000, 120000, 480000][i % 9];
      p.parts = Array.from({ length: 16 }, (_, j) => {
        const mass = Math.max(2, Math.floor(totalMass / 16 * (0.5 + random())));
        return { id: `${i}-${j}`, x: random() * 6120, y: random() * 4080, mass, radius: radiusForMass(mass) };
      });
      p.mainPartId = p.parts[0].id;
      arena.syncParts(p);
    }
    const linear = new Arena({ etherCount: 0, spatialIndex: false });
    linear.players = structuredClone(arena.players);
    assert.deepEqual(arena.resolveAbsorptions(5000), linear.resolveAbsorptions(5000), `events ${seed}`);
    assert.deepEqual(arena.players, linear.players, `world ${seed}`);
  }
});

test("Индекс и полный перебор дают одинаковые поглощения, остатки массы и смерти", () => {
  let totalEvents = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const random = seeded(seed),
      arena = new Arena({ etherCount: 0, random });
    for (let i = 0; i < 12; i++) {
      const p = arena.addPlayer(0, `player-${i}`);
      p.level = 501;
      p.protectedUntil = i % 5 === 0 ? 10000 : 0;
      p.parts = Array.from({ length: 8 }, (_, j) => {
        const mass = 10 + Math.floor(random() * 30000);
        return {
          id: `${i}-${j}`,
          x: random() * 2500,
          y: random() * 2500,
          mass,
          radius: radiusForMass(mass),
        };
      });
      p.mainPartId = p.parts[0].id;
      arena.syncParts(p);
    }
    const linear = new Arena({ etherCount: 0, spatialIndex: false });
    linear.players = structuredClone(arena.players);
    const expected = linear.resolveAbsorptions(5000),
      actual = arena.resolveAbsorptions(5000);
    totalEvents += actual.length;
    assert.deepEqual(actual, expected, `events seed ${seed}`);
    assert.deepEqual(arena.players, linear.players, `state seed ${seed}`);
  }
  assert.ok(totalEvents > 100, "fixtures must actually exercise absorptions");
});
