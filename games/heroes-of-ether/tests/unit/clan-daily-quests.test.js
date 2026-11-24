"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const q = require("../../src/server/clans/daily-quests/engine");
const seasons = require("../../src/server/clans/daily-quests/seasons");
const start = Date.parse("2026-11-14T04:00:00Z"), end = start + 15 * 3600000;
const catalog = { version: 1, items: q.GROUPS.flatMap((group, i) => [0, 1].map(n => ({
  id: `${group}${n}`, group, name: group, metric: ["xp", "kills", "hookHits", "shieldUses", "arenaSeconds"][i],
  target: 10, reward: { kind: "crystals", amount: 500 },
}))) };
const event = (playerId, sequence, deltas, at = start) => ({ playerId, sequence, clanId: "c", deltas, at });
test("MSK boundaries: exactly 07:00 starts; 22:00 closes; previous ranking retained until 07:00", () => {
  assert.equal(q.period(start - 1).active, false); assert.equal(q.period(start).active, true);
  assert.equal(q.period(end - 1).active, true); assert.equal(q.period(end).active, false);
  assert.equal(q.period(start + 86400000 - 1).id, "2026-11-14");
  assert.equal(q.period(start + 86400000).id, "2026-11-15");
});
test("five unique quests, XP first only once, separate clan seeds and stable catalog snapshot", () => {
  const a = q.createBoard("c", catalog, start), b = q.createBoard("other", catalog, start + 1000);
  assert.notDeepEqual(a.quests,b.quests); assert.equal(new Set(a.quests.map(x=>x.id)).size,5);
  assert.equal(a.quests[0].metric,"xp"); assert.equal(a.quests.filter(x=>x.metric==="xp").length,1);
  assert.equal(a.quests[1].metric,"kills"); assert.equal(a.quests.filter(x=>x.metric==="kills").length,1);
  assert(a.quests.slice(2).every(x=>!['xp','kills'].includes(x.metric)));
  assert.deepEqual(a.quests,q.createBoard("c",catalog,start+1000).quests);
  const before = structuredClone(a); const changed = structuredClone(catalog); changed.items[0].reward.amount++;
  q.createBoard("next", changed, start); assert.deepEqual(a, before);
  assert.throws(() => q.validateCatalog({ version: 1, items: [] }));
});
test("shared contribution, no double counting on replay/restart; old board immutable", () => {
  const a = q.createBoard("c", catalog, start), initial = structuredClone(a);
  const b = q.record(a, event("p", 1, { xp: 6 })); assert.deepEqual(a, initial);
  assert.equal(q.record(b.board, event("p", 1, { xp: 6 }), b.pledge).accepted, false);
  const restored = JSON.parse(JSON.stringify(b.board));
  const c = q.record(restored, event("p2", 1, { xp: 8 }));
  assert.equal(c.board.quests[0].progress, 10); assert.equal(Object.keys(c.board.contributors).length, 2);
  assert.equal(q.record(c.board, event("p", 2, { xp: 1 }, end)).accepted, false);
});

test("frozen shared boards preserve earlier progress and reward plans across contributors", () => {
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value); Object.values(value).forEach(freeze);
    }
    return value;
  };
  const initial = freeze(q.createBoard('c', catalog, start, { p: true, late: true }));
  const first = freeze(q.record(initial, event('p', 1, { xp: 10 })).board);
  const firstPrizes = q.rewardPlan(first, end);
  const later = freeze(q.record(first, event('late', 1, { kills: 10 }, end - 1)).board);
  assert.equal(initial.quests.every(row => row.progress === 0), true);
  assert.deepEqual(q.rewardPlan(first, end), firstPrizes);
  assert.equal(firstPrizes.length, 1);
  assert.equal(q.rewardPlan(later, end).length, 4);
  const detached = q.rewardPlan(later, end);
  detached[0].reward.amount = 1;
  assert(q.rewardPlan(later, end).every(row => row.reward.amount === 500));
  assert.equal(q.record(later, event('p', 2, { hookHits: 1 }, end)).accepted, false);
  assert.equal(q.record(later, event('late', 1, { hookHits: 1 })).accepted, false);
});
test("all prizes only after 22:00, full amount for every contributor to ANY task, including late participant", () => {
  let board = q.createBoard("c", catalog, start);
  board = q.record(board, event("p", 1, { xp: 10 })).board;
  board = q.record(board, event("late", 1, { kills: 1 }, end - 1)).board;
  assert.equal(q.rewardPlan(board, end - 1).length, 0);
  const plan = q.rewardPlan(board, end); assert.equal(plan.length, 2);
  assert(plan.every(r => r.reward.amount === 500)); assert.equal(new Set(plan.map(r => r.id)).size, 2);
  assert(plan.every(r => r.greatness === 15));
  assert.deepEqual(q.rewardPlan(JSON.parse(JSON.stringify(board)), end + 10000), plan);
  assert(!plan.some(r => r.playerId === "inactive"));
});
test("first contribution pins clan for the day, membership/invalid deltas rejected without mutation", () => {
  const a = q.createBoard("c", catalog, start), other = q.createBoard("other", catalog, start);
  const b = q.record(a, event("p", 1, { xp: 1 }));
  assert.equal(q.record(other, { ...event("p", 2, { xp: 1 }), clanId: "other" }, b.pledge).accepted, false);
  assert.equal(q.record(a, { ...event("p", 2, { xp: 1 }), clanId: "wrong" }).accepted, false);
  assert.equal(q.record(a, event("p", 2, { xp: 0 })).accepted, false);
  assert.throws(() => q.record(a, event("p", 2, { xp: Infinity })));
  assert.throws(() => q.record(a, event("p", 2, { fake: 1 })));
  assert.throws(() => q.record(a, event("p", 2, { xp: -1 })));
  assert.equal(Object.keys(a.contributors).length, 0);
});
test("all clans ranked with stable final tie break, next day starts from zero", () => {
  const board = q.record(q.createBoard("c", catalog, start), event("p", 1, { xp: 10 })).board;
  const clans = ["c", "b", "a"].map(id => ({ id, name: id }));
  assert.deepEqual(q.ranking(clans, { c: board }, end).map(r => [r.id, r.rank, r.completed]), [["c", 1, 1], ["a", 2, 0], ["b", 3, 0]]);
  assert(q.ranking(clans, { c: board }, start + 86400000).every(r => r.completed === 0));
});
test("seasons only by owner, no overlap, no automatic season, accumulated prizes stay after next season", () => {
  const input = { id: "s1", name: "Первый", startsAt: start, endsAt: end };
  assert.throws(() => seasons.announce([], input, { role: "moderator" }));
  let history = seasons.announce([], input, { role: "owner" });
  assert.throws(() => seasons.announce(history, { ...input, id: "overlap" }, { role: "owner" }));
  assert.equal(seasons.active(history, end), null);
  history = seasons.announce(history, { ...input, id: "s2", startsAt: end + 1000, endsAt: end + 2000 }, { role: "owner" });
  let ledger = seasons.appendReward([], history[0], "c", { crystals: 500 });
  assert.equal(seasons.appendReward(ledger, history[0], "c", { crystals: 500 }), ledger);
  ledger = seasons.appendReward(ledger, history[1], "c", { crystals: 700 });
  assert.equal(ledger.reduce((sum, r) => sum + r.reward.crystals, 0), 1200);
});
