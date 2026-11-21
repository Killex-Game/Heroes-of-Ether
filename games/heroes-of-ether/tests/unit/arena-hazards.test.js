"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, RULES, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards, HAZARD_RULES: H } = require("../../src/server/arena/arena-hazards");
function scene(easter = false) {
  const a = new Arena({ etherCount: 0 }),
    p = a.addPlayer(0, "human"),
    h = (a.hazards = new ArenaHazards(a));
  Object.assign(p, {
    x: 1000,
    y: 1000,
    targetX: 1000,
    targetY: 1000,
    profileId: "profile",
    level: 25,
    protectedUntil: 0,
    stopped: true,
  });
  h.setRun(easter ? { id: "run" } : null);
  h.nextAt = Infinity;
  const item = h.create(1200, 1000, 0);
  h.items = [item];
  return { a, p, h, item };
}
function mass(a, p, value) {
  a.gainMass(p, value - p.mass);
}
function launch(a, p, id) {
  a.prepareBooster(
    p.id,
    { boosterId: id, spawnSerial: p.spawnSerial, aimX: id === "mine" ? 0 : 2000, aimY: 1000 },
    3000,
  )();
}

test("hazard sweep retains the main part's start when a body becomes split parts", () => {
  const { a, p, h, item } = scene();
  h.replenish = () => {};
  item.x = 1500;
  mass(a, p, 1000);
  h.beginStep(1000);
  // Splitting replaces the single player body with a distinct part object.
  p.parts = [
    { id: p.mainPartId, x: 1750, y: 1000, mass: 1000, radius: radiusForMass(1000), vx: 0, vy: 0 },
  ];
  a.syncParts(p);
  h.collect(1050);
  assert.equal(h.items.length, 0);
  assert.equal(a.bodies(p).length, 3);
  assert.equal(p.mass, 1050);
});

test("a respawn with the same part ID cannot inherit the prior life's hazard sweep", () => {
  const { a, p, h, item } = scene();
  h.replenish = () => {};
  item.x = 1500;
  mass(a, p, 1000);
  h.beginStep(1000);
  p.lifeId = "next-life";
  p.x = 1750;
  h.collect(1050);
  assert.equal(h.items.length, 1);
  assert.equal(p.mass, 1000);
  assert.equal(a.bodies(p).length, 1);
});

test("hazard sweeps separate identical part IDs belonging to different lives", () => {
  const { a, p, h, item } = scene();
  h.replenish = () => {};
  item.x = 1500;
  mass(a, p, 1000);
  const other = a.addPlayer(0, "other");
  Object.assign(other, {
    x: 1750,
    y: 1000,
    mass: 1000,
    radius: radiusForMass(1000),
    mainPartId: p.mainPartId,
    protectedUntil: 0,
  });
  h.beginStep(1000);
  p.x = 1750;
  h.collect(1050);
  assert.equal(h.items.length, 0);
  assert.equal(p.mass, 1050);
  assert.equal(other.mass, 1000);
});
test("shared natural baseline is 40; offspring can exceed it and empty arenas release hazards", () => {
  const { a, p, h } = scene(true);
  h.items = [];
  h.nextAt = 0;
  h.replenish(0);
  assert.equal(h.items.length, 40);
  const parent = h.items[0];
  h.reproduce(parent, 1, 0, 0);
  assert.equal(h.items.length, 41);
  h.replenish(100);
  assert.equal(h.items.length, 41);
  const ids = h.items.map((item) => item.id);
  h.setRun(null);
  h.replenish(100);
  assert.deepEqual(
    h.items.map((item) => item.id),
    ids,
  );
  assert.ok(h.items.every((item) => item.eggType === null));
  h.items.splice(0, 2);
  h.replenish(200);
  assert.equal(h.items.length, 40);
  h.setRun({ id: "next" });
  h.replenish(200);
  assert.equal(h.items.length, 40);
  assert.ok(h.items.every((item) => Number.isInteger(item.eggType)));
  a.removePlayer(p.id);
  h.replenish(200);
  assert.equal(h.items.length, 0);
});
test("50-mass hazard matches cell radius; small cells pass and 66 mass splits like a rocket", () => {
  const { a, p, h, item } = scene();
  assert.equal(item.mass, 50);
  assert.equal(item.radius, radiusForMass(50));
  Object.assign(p, { x: item.x, y: item.y });
  mass(a, p, 65);
  h.collect(3000);
  assert.ok(h.items.includes(item));
  assert.equal(p.parts, null);
  mass(a, p, 66);
  h.collect(3000);
  assert.equal(a.bodies(p).length, 3);
  assert.equal(p.mass, 116);
  assert.deepEqual(
    a.bodies(p).map((b) => b.mass),
    [58, 29, 29],
  );
  assert.ok(a.bodies(p).every((b) => b.mass >= 2 && b.mergeAt === 33000));
  assert.ok(
    a
      .bodies(p)
      .slice(1)
      .every((b) => b.birth && b.splitStartedAt === 3000),
  );
  assert.ok(
    a
      .bodies(p)
      .slice(1)
      .every((b) => Math.abs(Math.hypot(b.vx, b.vy) - 18) < 1e-6),
  );
});
test("eggs give their mass and split like a rocket, with one collection credit and no food progress", () => {
  const { a, p, h, item } = scene(true);
  mass(a, p, 300);
  Object.assign(p, { x: item.x, y: item.y });
  h.collect(3000);
  assert.equal(p.mass, 350);
  assert.deepEqual(
    a.bodies(p).map((b) => b.mass),
    [176, 87, 87],
  );
  assert.deepEqual(a.progressEvents.filter(e => e.type === "easterPickup"), [
    {
      type: "easterPickup",
      playerId: p.id,
      lifeId: p.lifeId,
      runId: "run",
      eggType: item.eggType,
    },
  ]);
  h.collect(3000);
  assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, 1);
  assert.equal(p.questFoodCount, 0);
});
test("only the struck part bursts, existing siblings keep their mass and merge deadline", () => {
  const { a, p, h, item } = scene();
  mass(a, p, 1000);
  a.boosterEffects.split(p, p, 2, 100);
  const b = p.parts[0],
    sibling = p.parts[1];
  Object.assign(b, { x: item.x, y: item.y });
  Object.assign(sibling, { x: 600, y: 600 });
  const oldMass = sibling.mass,
    oldMerge = sibling.mergeAt;
  h.collect(3000);
  assert.equal(a.bodies(p).length, 4);
  assert.equal(sibling.mass, oldMass);
  assert.equal(sibling.mergeAt, oldMerge);
  assert.equal(p.mass, 1050);
});
for (const easter of [false, true])
  test("full part cap consumes without damage: Easter=" + easter, () => {
    const { a, p, h, item } = scene(easter);
    mass(a, p, 3200);
    a.boosterEffects.split(p, p, 16, 100);
    for (const [i, b] of p.parts.entries()) Object.assign(b, { x: 200 + i * 100, y: 500 });
    Object.assign(p.parts[0], { x: item.x, y: item.y });
    h.collect(3000);
    assert.equal(p.parts.length, 16);
    assert.equal(p.mass, 3250);
    assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, easter ? 1 : 0);
  });
test("spawn protection permits collecting hazards and eggs while retaining PvP protection", () => {
  for (const easter of [false, true]) {
    const { a, p, h, item } = scene(easter);
    mass(a, p, 500);
    Object.assign(p, { x: item.x, y: item.y });
    p.protectedUntil = 4000;
    h.collect(3000);
    assert.ok(!h.items.includes(item));
    assert.equal(p.mass, 550);
    assert.equal(p.protectedUntil, 4000);
    assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, easter ? 1 : 0);
  }
});

test("lock allows thorns and event eggs to burst the struck part without clearing the lock", () => {
  for (const easter of [false, true]) {
    const { a, p, h, item } = scene(easter);
    mass(a, p, 300);
    Object.assign(p, { x: item.x, y: item.y });
    p.effects.lock = 13000;
    h.collect(3000);
    assert.ok(!h.items.includes(item));
    assert.equal(p.mass, 350);
    assert.deepEqual(
      a.bodies(p).map((part) => part.mass),
      [176, 87, 87],
    );
    assert.equal(p.effects.lock, 13000);
    assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, easter ? 1 : 0);
    h.collect(3050);
    assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, easter ? 1 : 0);
  }
});

test("all booster shields allow centre-cover bursting without being stripped, for thorns and eggs", () => {
  for (const easter of [false, true]) {
    for (const effect of ["colorful_shield", "sphere", "golden_shield", "clan_shield"]) {
      const { a, p, h, item } = scene(easter);
      mass(a, p, 300);
      Object.assign(p, { x: item.x, y: item.y });
      p.effects[effect] = 4000;
      h.collect(3000);
      assert.ok(!h.items.includes(item));
      assert.equal(a.bodies(p).length, 3);
      assert.equal(p.mass, 350);
      assert.equal(p.effects[effect], 4000);
      assert.equal(a.hasEffect(p, "shield", 3000), true);
      assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, easter ? 1 : 0);
    }
  }
});
test("real profile bots collect event eggs; departing remnants never collect them", () => {
  for (const kind of ["isTestBot", "isRemnant"]) {
    const { a, p, h, item } = scene(true);
    mass(a, p, 300);
    Object.assign(p, { x: item.x, y: item.y, [kind]: true, removeAt: 20000 });
    h.collect(3000);
    assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, kind === "isTestBot" ? 1 : 0);
    assert.equal(a.bodies(p).length, 3);
  }
});
function checkFeedingCycle(easter) {
  const { a, h, item } = scene(easter);
  for (let i = 1; i <= 6; i++) {
    a.ether.push({
      id: "w" + i,
      ejected: true,
      value: 5,
      radius: 6,
      x: item.x - 100,
      y: item.y,
      vx: 420,
      vy: 0,
      updatedAt: 0,
      expiresAt: 60000,
    });
    a.moveFeed(1000);
    assert.equal(a.ether.length, 0);
    assert.equal(h.items.length, i === 6 ? 2 : 1);
    assert.equal(item.mass, i === 6 ? 50 : 50 + i * 10);
    assert.equal(item.radius, radiusForMass(item.mass));
  }
  assert.equal(item.mass, 50);
  const child = h.items[1];
  assert.equal(child.mass, 50);
  assert.equal(child.radius, radiusForMass(50));
  assert.ok(child.vx > 0);
  assert.equal(child.vy, 0);
  assert.equal(child.birth.x, item.x);
  h.beginStep(1100);
  assert.ok(child.x > item.x);
  const x = child.x;
  h.beginStep(1200);
  assert.ok(child.x > x);
  a.ether.push({ id: "natural", value: 2, radius: 6, x: item.x, y: item.y });
  a.moveFeed(1300);
  assert.equal(a.ether.length, 1);
  assert.equal(item.mass, 50);
}
for (const easter of [false, true])
  test("five W pellets fill the hazard; the sixth duplicates it: Easter=" + easter, () => {
    checkFeedingCycle(easter);
  });
test("W volley index preserves moving hits, growth at a cell edge and newly born hazards", () => {
  function volley(indexed) {
    const { h, item } = scene();
    item.id = "parent";
    // Cross two columns this tick. The child will be born in the last one.
    Object.assign(item, { previousX: 440, x: 784, previousY: 1000 });
    let serial = 0;
    const create = h.create.bind(h);
    h.create = (...args) => ({ ...create(...args), id: "child-" + ++serial });
    const index = indexed ? h.feedIndex() : null;
    const result = [];
    for (const x of [610, 930, 770, 610, 780, 780, 780, 780, 790, 765, 812, 812]) {
      const orb = { id: result.length, radius: 6, vx: 2 };
      result.push(h.feed(orb, x, 1000, x + 5, 1000, 50, index));
    }
    assert.ok(h.items.length > 1);
    return { result, contacts: h.contacts, masses: h.items.map((i) => i.mass) };
  }
  assert.deepEqual(volley(true), volley(false));
});
test("actual W costs 5 mass and feeds a hazard without becoming food progress", () => {
  const { a, p, h, item } = scene();
  mass(a, p, 1000);
  item.x = p.x + p.radius + 65;
  assert.ok(a.feedPlayer(p, { spawnSerial: p.spawnSerial, sequence: 1, x: 2000, y: 1000 }, 3000));
  assert.equal(p.mass, 995);
  a.step(3100);
  assert.equal(a.ether.length, 0);
  assert.equal(item.mass, 60);
  assert.equal(p.questFoodCount, 0);
  assert.ok(a.combat.contacts.some((e) => e.key.startsWith("food:")));
});
test("thorn and egg burst when the cell boundary reaches the hazard centre", () => {
  for (const easter of [false, true]) {
    for (const hazardMass of [50, 100]) {
      const { a, p, h, item } = scene(easter);
      item.mass = hazardMass;
      item.radius = radiusForMass(hazardMass);
      const playerMass = Math.ceil(hazardMass * H.EAT_RATIO);
      mass(a, p, playerMass);
      p.y = item.y;
      for (const distance of [
        p.radius + item.radius + 0.01,
        p.radius + item.radius,
        p.radius + item.radius - 0.01,
        p.radius + 0.01,
      ]) {
        p.x = item.x - distance;
        h.collect(3000);
        assert.ok(h.items.includes(item), "hazard centre is outside the cell: " + distance);
        assert.equal(p.mass, playerMass);
        assert.equal(p.parts, null);
      }
      p.x = item.x - p.radius;
      h.collect(3050);
      assert.ok(!h.items.includes(item), "cell boundary touches the hazard centre");
      assert.equal(a.bodies(p).length, 3);
      assert.equal(p.mass, playerMass + hazardMass);
      assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, easter ? 1 : 0);
      h.collect(3050);
      assert.equal(p.mass, playerMass + hazardMass, "contact cannot be credited twice");
    }
  }
});

test("fast grazing overlap does not trigger when the hazard centre stays outside", () => {
  const { a, p, h, item } = scene(true);
  mass(a, p, 300);
  p.y = item.y + p.radius + 1;
  p.x = item.x - 300;
  h.beginStep(3000);
  p.x = item.x + 300;
  h.collect(3050);
  assert.ok(h.items.includes(item));
  assert.equal(p.mass, 300);
  assert.equal(a.bodies(p).length, 1);
  assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, 0);
});

test("swept pickup catches a fast large part crossing a stationary egg", () => {
  const { a, p, h, item } = scene(true);
  mass(a, p, 300);
  p.x = item.x - 200;
  h.beginStep(3000);
  p.x = item.x + 200;
  h.collect(3050);
  assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, 1);
});
test("flying hazard crossing a large cell bursts it, even when both endpoints are outside", () => {
  const { a, p, h, item } = scene(true);
  mass(a, p, 300);
  item.x = p.x - 150;
  item.vx = 900;
  h.beginStep(1000);
  assert.ok(item.x > p.x + 150);
  h.collect(1000);
  assert.equal(a.progressEvents.filter(e => e.type === "easterPickup").length, 1);
});
test("children bounce off arena boundary and cannot leave map", () => {
  const { a, h, item } = scene();
  item.x = a.world.width - 45;
  h.reproduce(item, 1, 0, 0);
  const child = h.items[1];
  h.beginStep(200);
  assert.ok(child.x <= a.world.width - child.radius);
  assert.ok(child.vx < 0);
});
for (const id of ["rocket", "warheads", "mine", "axe"])
  test(id + " multiplies on physical contact, then cannot hit twice", () => {
    const { a, p, h, item } = scene(true);
    item.mass = 86;
    item.radius = radiusForMass(86);
    if (id === "mine") item.x = 1130;
    launch(a, p, id);
    // Each rocket touching the same large hazard is a separate impact.
    if (id === "warheads")
      for (const shot of a.combat.shots) {
        shot.dx = 1;
        shot.dy = 0;
        shot.y = item.y;
      }
    const count = a.combat.shots.length;
    a.combat.update(5000);
    assert.equal(h.items.length, 1 + count);
    assert.ok(h.items.every((i) => i.mass === 50 && i.radius === radiusForMass(50)));
    assert.equal(a.combat.shots.length, 0);
    a.combat.update(5100);
    assert.equal(h.items.length, 1 + count);
  });
test("a closer player's boundary wins over a hazard, including clan reflection", () => {
  for (const shield of [false, true]) {
    const { a, p, h } = scene();
    const other = a.addPlayer(0, "other");
    Object.assign(other, { x: 1100, y: 1000, protectedUntil: 0 });
    mass(a, other, 100);
    if (shield) other.effects.clan_shield = 10000;
    launch(a, p, "rocket");
    a.combat.update(5000);
    assert.equal(h.items.length, 1);
    assert.equal(other.parts?.length || 1, shield ? 1 : 3);
  }
});
test("unsupported boosters pass hazards without multiplying them", () => {
  for (const id of ["fire", "hook", "harpoon", "poison", "stone", "knuckles", "web"]) {
    const { a, p, h } = scene();
    launch(a, p, id);
    a.combat.update(9000);
    assert.equal(h.items.length, 1, id);
  }
});
test("landed mine can be hit by a moving hazard even after its owner left", () => {
  const { a, p, h, item } = scene();
  launch(a, p, "mine");
  const shot = a.combat.shots[0];
  Object.assign(shot, { x: 1500, y: 1000, landed: true, lastAt: 4000 });
  a.removePlayer(p.id);
  const other = a.addPlayer(0, "observer");
  Object.assign(other, { x: 3000, y: 2000 });
  Object.assign(item, { x: 1400, vx: 900, updatedAt: 4000 });
  h.beginStep(4500);
  a.combat.update(4500);
  assert.equal(h.items.length, 2);
  assert.equal(a.combat.shots.length, 0);
});
test("event transitions preserve positions, ids and counts but switch reward type", () => {
  const { h, item } = scene();
  h.reproduce(item, 1, 0, 0);
  const before = h.items.map(({ id, x, y }) => ({ id, x, y }));
  h.setRun({ id: "first" });
  assert.ok(h.items.every((i) => Number.isInteger(i.eggType)));
  h.setRun(null);
  assert.ok(h.items.every((i) => i.eggType === null));
  h.setRun({ id: "next" });
  assert.deepEqual(
    h.items.map(({ id, x, y }) => ({ id, x, y })),
    before,
  );
  assert.equal(h.runId, "next");
});
test("reproduction has a per-arena safety ceiling, parent remains usable afterwards", () => {
  const { h, item } = scene();
  for (let i = 0; i < 300; i++) h.reproduce(item, 1, 0, 0);
  assert.equal(h.items.length, H.MAX_COUNT);
  assert.equal(h.items.length, 80);
  item.mass = 100;
  item.radius = radiusForMass(100);
  for (const child of h.items.slice(1)) child.x = 3000;
  const pellet = { id: "cap", radius: 6, vx: 100, vy: 0 };
  h.feed(pellet, item.x, item.y, item.x, item.y, 0);
  assert.equal(item.mass, 100);
  assert.equal(item.radius, radiusForMass(100));
  assert.equal(h.items.length, 80);
  assert.equal(h.reproduce(item, 1, 0, 0), false);
  h.items.pop();
  h.feed(pellet, item.x, item.y, item.x, item.y, 0);
  assert.equal(h.items.length, 80);
  assert.equal(item.mass, 50);
  assert.equal(h.items.at(-1).mass, 50);
});

test("all multiplying boosters share the 80-object cap for both thorns and Easter eggs", () => {
  for (const easter of [false, true]) {
    for (const id of ["rocket", "warheads", "mine", "axe"]) {
      for (const initial of [79, 80]) {
        const { a, p, h, item } = scene(easter);
        item.mass = 86;
        item.radius = radiusForMass(86);
        if (id === "mine") item.x = 1130;
        h.items.push(...Array.from({ length: initial - 1 }, () => h.create(3000, 2200, 0)));
        launch(a, p, id);
        if (id === "warheads")
          for (const shot of a.combat.shots) Object.assign(shot, { dx: 1, dy: 0, y: item.y });
        a.combat.update(5000);
        assert.equal(h.items.length, 80, `${id}, Easter=${easter}, initial=${initial}`);
        h.replenish(5000);
        assert.equal(h.items.length, 80);
      }
    }
  }
});

test("offspring free flight is halved to about 225 units", () => {
  const { h, item } = scene();
  h.reproduce(item, 1, 0, 0);
  const child = h.items[1],
    start = child.x;
  for (let now = 50; now <= 10000; now += 50) h.beginStep(now);
  assert.ok(child.x - start > 224 && child.x - start < 226);
  assert.equal(child.vx, 0);
});

for (const easter of [false, true])
  test("fed hazard grants its actual 100 mass to the struck cell: Easter=" + easter, () => {
    const { a, p, h, item } = scene(easter);
    item.mass = 100;
    item.radius = radiusForMass(100);
    Object.assign(p, { x: item.x, y: item.y });
    mass(a, p, 131);
    h.collect(3000);
    assert.ok(h.items.includes(item));
    mass(a, p, 200);
    h.collect(3000);
    assert.equal(p.mass, 300);
    assert.deepEqual(
      a.bodies(p).map((b) => b.mass),
      [150, 75, 75],
    );
  });

test("one remaining part slot uses the rocket's partial split without extra damage", () => {
  const { a, p, h, item } = scene();
  mass(a, p, 3000);
  a.boosterEffects.split(p, p, 15, 0);
  p.parts.forEach((b, i) => Object.assign(b, { x: 200 + i * 100, y: 500 }));
  const body = p.parts[0];
  Object.assign(body, { x: item.x, y: item.y });
  h.collect(3000);
  assert.equal(p.parts.length, 16);
  assert.equal(p.mass, 3050);
  assert.equal(body.mass, 188);
  assert.equal(p.parts.at(-1).mass, 62);
});
test("egg weights also apply to offspring: each of four colours has 25%", () => {
  const { a, h, item } = scene(true),
    counts = [0, 0, 0, 0];
  for (let i = 0; i < 100; i++) {
    h.items = [item];
    a.random = () => (i + 0.5) / 100;
    h.reproduce(item, 1, 0, 0);
    counts[h.items.at(-1).eggType]++;
  }
  assert.deepEqual(counts, [25, 25, 25, 25]);
});
test("spatial candidates preserve crossing hits, new parts and deterministic ownership", () => {
  const results = [];
  for (const spatialIndex of [false, true]) {
    const a = new Arena({ etherCount: 0, spatialIndex });
    const h = (a.hazards = new ArenaHazards(a));
    h.setRun({ id: "test" });
    h.nextAt = Infinity;
    a.random = () => 0.2;
    for (let i = 0; i < 40; i++) {
      const p = a.addPlayer(0, "p" + i);
      Object.assign(p, {
        profileId: "owner" + i,
        lifeId: "life" + i,
        x: 100 + (i % 8) * 400,
        y: 100 + Math.floor(i / 8) * 400,
        protectedUntil: 0,
      });
      a.gainMass(p, 500 - p.mass);
    }
    h.items = [...a.players.values()].map((p, i) => ({
      ...h.create(p.x + 200, p.y, 0),
      id: "hazard" + i,
    }));
    h.beginStep(0);
    for (const p of a.players.values()) p.x += 400;
    h.collect(50);
    results.push({
      progress: a.progressEvents,
      remaining: h.items.map((i) => i.id),
      players: [...a.players.values()].map((p) => ({
        id: p.id,
        mass: p.mass,
        parts: a
          .bodies(p)
          .map((b) => b.mass)
          .sort((a, b) => a - b),
      })),
    });
  }
  assert.deepEqual(results[1], results[0]);
  assert.ok(results[0].progress.length > 0);
});
