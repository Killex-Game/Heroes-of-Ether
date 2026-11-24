"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { BotBrain } = require("../../src/server/testing/arena-bot-brain");

function fixture(food, body = { x: 1000, y: 1000, radius: 20 }, locked = false) {
  const arena = { ether: food, world: { width: 8000, height: 8000 }, hasEffect: () => locked };
  const brain = new BotBrain(arena, () => { throw Error("Unexpected wander draw"); });
  const player = { id: "bot" }, state = { wander: { x: 7000, y: 7000 }, nextWanderAt: Infinity };
  const context = { body, threats: [], prey: null, ally: null };
  return { brain, player, state, context, pick: () => brain.destination(player, context, state, 1000) };
}

// Independent eligibility/ordering oracle: strict radius, delayed own pickups,
// weighted distance, and first-in-world ties are existing gameplay rules.
function expected(food, body) {
  const eligible = food.filter(o => !(o.sourceId === "bot" && o.sourcePickupAt > 1000))
    .map((orb, index) => ({ orb, index, distance: Math.hypot(body.x - orb.x, body.y - orb.y) }))
    .filter(e => e.distance < 650)
    .map(e => ({ ...e, score: e.distance / Math.sqrt(e.orb.value) }))
    .filter(e => e.score < Infinity)
    .sort((a, b) => a.score - b.score || a.index - b.index);
  return eligible[0]?.orb;
}

test("bot food selection preserves radius boundaries, weighting, source delay and stable ties", () => {
  const food = [
    { id: "boundary", x: 1650, y: 1000, value: 1e9 },
    { id: "outside-diagonal", x: 1500, y: 1500, value: 1e9 },
    { id: "delayed", x: 1000, y: 1000, value: 10, sourceId: "bot", sourcePickupAt: 1001 },
    { id: "first-tie", x: 1003, y: 1004, value: 1 },
    { id: "second-tie", x: 1006, y: 1008, value: 4 },
  ];
  let f = fixture(food);
  assert.strictEqual(f.pick(), food[3]);
  food[2].sourcePickupAt = 1000;
  assert.strictEqual(f.pick(), food[2]);
  f = fixture(food, undefined, true);
  assert.strictEqual(f.pick(), f.state.wander);
  f = fixture(food.slice(0, 2));
  assert.strictEqual(f.pick(), f.state.wander);
  f = fixture([{ x: 1649.999999, y: 1000, value: 1 }]);
  assert.strictEqual(f.pick(), f.brain.arena.ether[0]);
});

test("128 varied 3000-food worlds choose exactly the same weighted target", () => {
  let seed = 314159;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let n = 0; n < 128; n++) {
    const body = { x: random() * 8000, y: random() * 8000, radius: 20 };
    const food = Array.from({ length: 3000 }, (_, id) => ({ id,
      x: random() * 8000, y: random() * 8000, value: 1 + Math.floor(random() * 300),
      sourceId: id % 7 === 0 ? "bot" : "other", sourcePickupAt: id % 3 === 0 ? 1100 : 900,
    }));
    const f = fixture(food, body);
    assert.strictEqual(f.pick(), expected(food, body) || f.state.wander, `world ${n}`);
  }
});

test("threat, prey and ally decisions still take priority over food", () => {
  const f = fixture([{ x: 1000, y: 1000, value: 1e6 }]);
  f.context.threats = [{ body: { x: 1100, y: 1000 } }];
  assert.deepEqual(f.pick(), { x: 900, y: 1000 });
  f.context.threats = [];
  f.context.prey = { body: { x: 1100, y: 1000, radius: 10 }, distance: 100, vx: 10, vy: -10 };
  assert.deepEqual(f.pick(), { x: 1103, y: 997 });
  f.context.prey = null;
  f.context.ally = { body: { x: 1100, y: 1000, radius: 10 }, distance: 100 };
  assert.deepEqual(f.pick(), { x: 1030, y: 1000 });
});
