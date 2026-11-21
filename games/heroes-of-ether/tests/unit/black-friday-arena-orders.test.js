"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture");
const Q = require("../../src/server/progression/personal-quests");
const B = require("../../src/server/events/black-friday");
const book = require("../../src/server/events/black-friday-orders");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards } = require("../../src/server/arena/arena-hazards");

function combatScene() {
  const arena = new Arena({ etherCount: 0 });
  const owner = arena.addPlayer(0, "owner"), target = arena.addPlayer(0, "target");
  for (const [p, x] of [[owner, 1000], [target, 1500]]) {
    Object.assign(p, { x, y: 1000, targetX: x, targetY: 1000, protectedUntil: 0,
      stopped: true, profileId: p.id, level: 25 });
    arena.gainMass(p, 1000 - p.mass);
  }
  arena.progressEvents.length = 0;
  return { arena, owner, target };
}
test("only successful Rocket/freeze impacts produce ordered quest receipts; shields and repeated freeze do not", () => {
  for (const id of ["rocket", "freeze"]) {
    const { arena, owner, target } = combatScene();
    const shot = { id: "shot", boosterId: id, ownerId: owner.id, ownerLife: owner.lifeId,
      x: target.x - target.radius, y: target.y, dx: 1, dy: 0, speed: 200 };
    for (const shield of ["colorful_shield", "sphere", "golden_shield", "clan_shield"]) {
      target.effects = { [shield]: 10000 };
      arena.combat.impact({ ...shot }, target, 3000);
      assert.equal(arena.progressEvents.length, 0, shield);
    }
    target.effects = {};
    arena.combat.impact({ ...shot }, target, 3000);
    assert.deepEqual(arena.progressEvents.filter(e=>e.type==='arenaAction'), [{ type: "arenaAction", playerId: owner.id,
      lifeId: owner.lifeId, sequence: 1, metric: id === "rocket" ? "rocketHits" : "freezeHits", targetProfileId: target.profileId }]);
    if (id === "freeze") {
      arena.combat.impact({ ...shot, id: "next" }, target, 3050);
      assert.equal(arena.progressEvents.length, 1);
    }
  }
});

test("hazard launch attribution credits the same living attacker only once; collection has its own receipt", () => {
  const { arena, owner, target } = combatScene();
  const hazards = arena.hazards = new ArenaHazards(arena);
  const parent = hazards.create(2500, 1000, 0); hazards.items = [parent];
  hazards.reproduce(parent, -1, 0, 1000, owner.id, owner.lifeId);
  const child = hazards.items[1]; child.x = target.x; child.y = target.y;
  hazards.collect(3000);
  assert.deepEqual(arena.progressEvents.map(e => [e.playerId, e.metric, e.sequence]),
    [[target.id, "hazards", 1], [owner.id, "hazardHits", 1]]);
  hazards.collect(3000);
  assert.equal(arena.progressEvents.length, 2);
  hazards.reproduce(parent, -1, 0, 3100, owner.id, "previous-life");
  const stale = hazards.items.at(-1), part = arena.mainBody(target);
  stale.x = part.x; stale.y = part.y;
  hazards.collect(3200);
  assert.equal(arena.progressEvents.filter(e => e.metric === "hazardHits").length, 1);
});

function choose(f, template, questId = "thorns_small") {
  f.p().blackFriday ||= { runs: { [f.run.id]: { tokens: 0, completedOrders: 0, days: {}, purchases: {}, finalAt: null } } };
  const s = f.p().blackFriday.runs[f.run.id], d = book.ensure(f.p(), s, B.day(f.now()), f.now());
  fixture.forceOrder(d, template);
  const def = Q.CATALOG.find(q => q.id === questId), q = f.p().quests;
  const row = q.items.find(row => Q.CATALOG.find(q => q.id === row.questId).tier === def.tier) || q.items.at(-1);
  row.questId = questId; row.progress = 0;
  return row.id;
}
test("thorn daily quest resets each life; event order accumulates across lives, rejects duplicate/stale receipts", () => {
  const f = fixture();
  f.progress({ type: "lifeStarted", lifeId: "life1" });
  const id = choose(f, 4);
  const hits = (lifeId, n) => { for (let i = 1; i <= n; i++) f.progress({ type: "arenaAction", lifeId, sequence: i, metric: "hazards" }); };
  hits("life1", 6);
  assert.equal(f.view().orders[0].progress, 6);
  hits("life1", 6);
  assert.equal(f.view().orders[0].progress, 6);
  f.time(f.now() + 1000);
  f.progress({ type: "lifeEnded", lifeId: "life1", durationSeconds: 1, reason: "exit" });
  f.progress({ type: "lifeStarted", lifeId: "life2" });
  assert.equal(f.p().quests.items.find(q => q.id === id).progress, 0);
  hits("life1", 7); assert.equal(f.view().orders[0].progress, 6);
  hits("life2", 4); assert.equal(f.view().orders[0].progress, 10);
  f.act("order", f.view().orders[0].id);
  const after = structuredClone(f.p()), save = f.store.save;
  f.store.save = () => { throw Error("disk failure"); };
  assert.throws(() => f.progress({ type: "arenaAction", lifeId: "life2", sequence: 5, metric: "hazards" }), /disk failure/);
  assert.deepEqual(f.p(), after);
  f.store.save = save;
  hits("life2", 10);
  assert.ok(f.p().quests.pending.some(c => c.id === id));
});

test("full player kills count once across parts; rocket orders retain progress over respawns and reset on replacement", () => {
  const f = fixture(); f.progress({ type: "lifeStarted", lifeId: "life1" }); choose(f, 3);
  const kill = { type: "absorbed", lifeId: "victim1", victimProfileId: "other", victimPartId: "part1", gain: 100, victimDefeated: false };
  f.progress(kill); assert.equal(f.view().orders[0].progress, 0);
  f.progress({ ...kill, victimPartId: "part2", victimDefeated: true });
  f.progress({ ...kill, victimPartId: "part2", victimDefeated: true });
  assert.equal(f.view().orders[0].progress, 1);
  choose(f, 6, "rocket_small");
  for (let i = 1; i <= 3; i++) f.progress({ type: "arenaAction", lifeId: "life1", sequence: i, metric: "rocketHits", targetProfileId: `target-${i}` });
  f.time(f.now() + 1000);
  f.progress({ type: "lifeEnded", lifeId: "life1", durationSeconds: 1, reason: "exit" });
  f.progress({ type: "lifeStarted", lifeId: "life2" });
  for (let i = 1; i <= 2; i++) f.progress({ type: "arenaAction", lifeId: "life2", sequence: i, metric: "rocketHits", targetProfileId: `target-${i+3}` });
  assert.equal(f.view().orders[0].progress, 5);
  f.act("swap", f.view().orders[0].id);
  assert.equal(f.view().orders[0].progress, 0);
  f.progress({ type: "arenaAction", lifeId: "life2", sequence: 2, metric: "rocketHits" });
  assert.equal(f.view().orders[0].progress, 0);
});

test("pending arena-level reward recovery is once-only and leaves the published profile untouched", () => {
  const f = fixture();
  f.store.confirmMockPurchase(f.user.token, { productId: "event:manya-coupon", confirmed: true, eventId: f.run.id, requestId: randomUUID() });
  f.p().progress.lastLife = { ...(f.p().progress.lastLife || {}), pendingFridayLevel: { runId: f.run.id, at: f.now() }, levelReward: { levels: 1 } };
  const world = { profiles: { [f.p().id]: f.p() } }, before = structuredClone(world);
  const next = B.recover(world, f.manager, f.now());
  assert.deepEqual(world, before);
  assert.equal(next.profiles[f.p().id].blackFriday.runs[f.run.id].tokens, 510);
  assert.equal(next.profiles[f.p().id].blackFriday.runs[f.run.id].arenaLevels, 1);
  assert.equal(B.recover(next, f.manager, f.now()), next);
});

test("Hook, glove and poison receipts require an unshielded opponent; repeated poison impacts count", () => {
  for (const [id, metric] of [["hook", "hookHits"], ["glove", "pushHits"], ["poison", "poisonHits"]]) {
    const { arena, owner, target } = combatScene();
    const shot = { id: "hit", boosterId: id, ownerId: owner.id, ownerLife: owner.lifeId,
      x: target.x - target.radius, y: target.y, dx: 1, dy: 0, speed: 200 };
    for (const shield of ["colorful_shield", "sphere", "golden_shield", "clan_shield"]) {
      target.effects = { [shield]: 10000 };
      arena.combat.impact({ ...shot }, target, 3000);
      assert.equal(arena.progressEvents.length, 0, id + ":" + shield);
    }
    target.effects = {};
    arena.combat.impact({ ...shot }, target, 3000);
    assert.deepEqual(arena.progressEvents.filter(e=>e.type==='arenaAction').map(e => [e.metric, e.targetProfileId, e.sequence]),
      [[metric, target.profileId, 1]]);
    if (id === "poison") {
      arena.combat.impact({ ...shot, id: "second" }, target, 3050);
      assert.deepEqual(arena.progressEvents.filter(e=>e.type==='arenaAction').map(e => [e.metric, e.targetProfileId, e.sequence]),
        [[metric, target.profileId, 1], [metric, target.profileId, 2]]);
    }
  }
});
