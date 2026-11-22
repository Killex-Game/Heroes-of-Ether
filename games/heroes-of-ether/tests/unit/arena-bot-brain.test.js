"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  Arena,
  radiusForMass,
  massLimitForLevel,
} = require("../../src/server/arena/arena-simulation");
const { BotBrain, LIFE_BOOSTERS } = require("../../src/server/testing/arena-bot-brain");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
function place(p, mass, x, y = 800) {
  Object.assign(p, {
    mass,
    radius: radiusForMass(mass),
    x,
    y,
    targetX: x,
    targetY: y,
    protectedUntil: 0,
    stopped: true,
    nextMassDecayAt: Infinity,
  });
}
function setup() {
  const arena = new Arena({ etherCount: 0 }),
    brain = new BotBrain(arena, () => 0.5, { boostersEnabled: true });
  const bot = arena.addPlayer(0),
    enemy = arena.addPlayer(0);
  bot.clanId = "team";
  bot.isTestBot = true;
  place(bot, 200, 700);
  place(enemy, 100, 1000);
  const state = brain.start(bot, 0);
  return { arena, brain, bot, enemy, state };
}
test("Боты по умолчанию двигаются, но не применяют бустеры даже при наличии запаса", () => {
  const { arena, bot, enemy } = setup(),
    brain = new BotBrain(arena, () => 0.5),
    state = brain.start(bot, 0);
  assert.equal(brain.boostersEnabled, false);
  state.nextSplitAt = Infinity;
  state.bag = [...BOOSTERS.keys()];
  const inventory = [...state.bag];
  const before = { x: bot.x, y: bot.y };
  for (const at of [3000, 6000, 12000]) {
    assert.equal(brain.act(bot, at), null);
    for (const b of BOOSTERS.values())
      assert.equal(brain.use(bot, { b, aim: enemy }, state, at), null);
    arena.step(at);
  }
  assert.notDeepEqual({ x: bot.x, y: bot.y }, before);
  assert.equal(state.used, 0);
  assert.equal(bot.boostersUsed, 0);
  assert.deepEqual(state.bag, inventory);
  assert.equal(arena.combat.shots.length, 0);
});

test("Every life has twenty personal supplies; all 22 personal boosters are available across loadouts", () => {
  const f = setup(),
    seen = new Set();
  let seed = 32;
  f.brain.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let n = 0; n < 200; n++) {
    const s = f.brain.start(f.bot, n);
    assert.equal(s.bag.length, LIFE_BOOSTERS);
    for (const id of s.bag) {
      assert.notEqual(BOOSTERS.get(id).tier, "clan");
      seen.add(id);
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    [...BOOSTERS.values()]
      .filter((b) => b.ready && ["common", "advanced", "rare"].includes(b.tier))
      .map((b) => b.id)
      .sort(),
  );
});
test("Split catches small prey, preserves mass and uses the usual split delay", () => {
  const { arena, brain, bot, enemy, state } = setup();
  place(bot, 400, 700);
  place(enemy, 20, 845);
  state.bag = [];
  brain.act(bot, 3000);
  assert.equal(bot.parts.length, 2);
  assert.equal(bot.mass, 400);
  assert.equal(bot.mergeAt, 33000);
  brain.act(bot, 3400);
  assert.equal(bot.parts.length, 2);
  assert.equal(
    arena.bodies(bot).reduce((sum, p) => sum + p.mass, 0),
    400,
  );
});
test("Bot refuses a split that would expose its halves, and flees a threat to a small part", () => {
  const { arena, brain, bot, enemy, state } = setup();
  place(bot, 400, 700);
  place(enemy, 20, 845);
  state.bag = [];
  const danger = arena.addPlayer(0);
  place(danger, 350, 700, 1100);
  brain.act(bot, 3000);
  assert.equal(bot.parts, null);
  arena.boosterEffects.split(bot, bot, 4, 3000);
  place(danger, 300, bot.parts[0].x + 140, bot.parts[0].y);
  brain.act(bot, 3400);
  assert.ok(bot.targetX < arena.mainBody(bot).x);
});
test("Feeds a weaker clanmate through real food particles without duplicating mass", () => {
  const { arena, brain, bot, enemy, state } = setup();
  enemy.clanId = bot.clanId;
  place(bot, 200, 700);
  place(enemy, 20, bot.x + bot.radius + radiusForMass(20) + 40);
  state.bag = [];
  const total = bot.mass + enemy.mass;
  brain.act(bot, 3000);
  assert.equal(bot.mass, 195);
  assert.equal(arena.ether.filter((p) => p.ejected).length, 1);
  assert.equal(bot.mass + enemy.mass + arena.ether.reduce((sum, p) => sum + p.value, 0), total);
  arena.handleInput(bot.id, { type: "stop" }, 3000);
  for (let at = 3000; at < 4200; at += 50) arena.step(at);
  assert.ok(enemy.mass > 20);
  assert.equal(bot.mass + enemy.mass + arena.ether.reduce((sum, p) => sum + p.value, 0), total);
});
test("Never feeds through an enemy or shoots through a clanmate", () => {
  const { arena, brain, bot, enemy, state } = setup();
  state.bag = ["poison"];
  const ally = arena.addPlayer(0);
  ally.clanId = bot.clanId;
  place(ally, 20, 850);
  place(enemy, 100, 1000);
  state.nextSplitAt = Infinity;
  brain.act(bot, 3000);
  assert.equal(state.used, 0);
  assert.equal(arena.combat.shots.length, 0);
  const foodBefore = arena.ether.length;
  place(enemy, 100, 800);
  brain.act(bot, 3400);
  assert.equal(arena.ether.length, foodBefore);
});
test("All personal boosters have a usable tactical situation and use normal arena effects", () => {
  for (const b of [...BOOSTERS.values()].filter((b) => b.ready && !["clan", "potion"].includes(b.tier))) {
    const { arena, brain, bot, enemy, state } = setup();
    place(bot, 150, 700);
    place(enemy, 25, 900);
    state.bag = [b.id];
    state.nextSplitAt = Infinity;
    if (b.id === "glove") place(enemy, 1000, 900);
    if (b.trap) place(enemy, 25, 800);
    if (b.kind === "sponge") arena.boosterEffects.split(bot, bot, 2, 1000);
    const event = brain.act(bot, 3000);
    assert.equal(event?.boosterId, b.id, b.id + " must have a tactical use");
    assert.equal(bot.boostersUsed, 1);
    assert.equal(state.used, 1);
    assert.equal(state.bag.length, 0);
    assert.equal(bot.boosterUses[b.id], 1);
    if (b.target === "direction") assert.ok(arena.combat.shots.some((s) => s.boosterId === b.id));
  }
});
test("Total twenty-use budget is shared, clan boosters are rejected, respawn resets only life supplies", () => {
  const { arena, brain, bot, state } = setup();
  bot.level = 121;
  state.bag = Array(21).fill("candy");
  for (let n = 0; n < 21; n++)
    brain.use(bot, { b: BOOSTERS.get("candy"), aim: bot }, state, 3000 + n * 3000);
  assert.equal(state.used, 20);
  assert.equal(bot.boostersUsed, 20);
  assert.equal(bot.mass, 3200);
  state.bag.push("fire");
  assert.equal(
    brain.use(bot, { b: BOOSTERS.get("fire"), aim: { x: 1000, y: 800 } }, state, 40000),
    null,
  );
  arena.resetPlayer(bot, 50000);
  const fresh = brain.start(bot, 50000);
  assert.equal(fresh.used, 0);
  assert.equal(fresh.bag.length, 20);
  fresh.bag.push("fire");
  assert.equal(
    brain.use(bot, { b: BOOSTERS.get("fire"), aim: { x: 1000, y: 800 } }, fresh, 53000),
    null,
  );
  brain.forget(bot);
  assert.equal(brain.lives.size, 0);
});
test("Spawn attacks and mass caps never consume supplies; repeated shields and poison remain charged", () => {
  const { arena, brain, bot, state } = setup();
  const tryUse = (id, at) =>
    brain.use(bot, { b: BOOSTERS.get(id), aim: { x: 1000, y: 800 } }, state, at);
  state.bag = ["mine", "poison", "poison", "candy", "sphere", "sphere"];
  bot.protectedUntil = 5000;
  assert.equal(tryUse("mine", 3000), null);
  assert.equal(state.used, 0);
  bot.protectedUntil = 0;
  assert.ok(tryUse("mine", 6000));
  assert.ok(tryUse("poison", 6000));
  place(bot, massLimitForLevel(bot.level), 700);
  assert.equal(tryUse("candy", 7000), null);
  assert.ok(tryUse("sphere", 7100));
  assert.equal(tryUse("sphere", 7599),null);
  assert.ok(tryUse("sphere",7600));
  assert.equal(state.used, 4);
  const prepare = arena.prepareBooster;
  arena.prepareBooster = () => {
    throw Error("unexpected failure");
  };
  assert.throws(() => tryUse("poison", 9000), /unexpected failure/);
  arena.prepareBooster = prepare;
  assert.equal(state.used, 4);
});
test("Projectile aim leads observed movement, respects range and ignores protected targets", () => {
  const { arena, brain, bot, enemy, state } = setup();
  state.bag = ["freeze"];
  state.nextSplitAt = Infinity;
  brain.act(bot, 2000);
  enemy.y += 25;
  const event = brain.act(bot, 3000);
  assert.equal(event.boosterId, "freeze");
  const shot = arena.combat.shots[0];
  assert.ok(shot.dy / shot.dx > (enemy.y - bot.y) / (enemy.x - bot.x));
  state.bag = ["poison"];
  state.nextBoosterAt = 0;
  place(enemy, 100, 1600);
  assert.equal(brain.act(bot, 6000), null);
  place(enemy, 100, 900);
  enemy.protectedUntil = 10000;
  assert.equal(brain.act(bot, 6400), null);
});
