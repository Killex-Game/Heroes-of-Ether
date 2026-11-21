"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { EventManager } = require("../../src/server/events/event-manager");
const A = require("../../src/server/events/ether-alchemy");
const { BOOSTERS, publicCatalog } = require("../../src/server/boosters/booster-catalog");
const loadout = require("../../public/shared/quick-slot-rules");
function fixture(options = {}) {
  let now = Date.UTC(2026, 10, 16, 12);
  const store = new ProfileStore({ ...options, now: () => now });
  const manager = store.events = new EventManager({ now: () => now });
  const user = store.open(), p = () => store.find(user.token), lifeId = randomUUID();
  const command = (action, extra = {}) => manager.apply("test", action,
    { requestId: randomUUID(), revision: manager.data.revision, ...extra });
  const progress = (...events) => store.applyArenaProgress(randomUUID(), events.map(e =>
    ({ ...e, profileId: p().id, lifeId: e.lifeId ?? lifeId })), now);
  progress({ type: "lifeStarted" });
  return { store, manager, user, p, lifeId, command, progress,
    time: n => now = n, view: () => A.view(p(), manager, now),
    input: (action, extra = {}) => ({ action, requestId: randomUUID(), ...extra }),
    act: input => A.mutate(store, user.token, input) };
}
test("natural ether is permanent, cumulative and preserves overflow; exchange is exactly once", () => {
  const f = fixture();
  f.progress({ type: "alchemyGather", natural: 150000, ingredients: {} });
  f.progress({ type: "alchemyGather", natural: 150000 });
  f.progress({ type: "alchemyGather", natural: 149999 });
  assert.equal(f.view().natural, 150000);
  const input = f.input("exchange"), before = f.p().wallet.bucks;
  f.act(input);
  assert.equal(f.view().natural, 50000);
  assert.equal(f.p().wallet.bucks, before + 10);
  assert.equal(f.act(input).replay, true);
  assert.equal(f.view().natural, 50000);
  assert.throws(() => f.act(f.input("exchange")), /100 000/);
  const snapshot = JSON.stringify(f.p());
  assert.throws(() => f.act({ ...input, action: "equip", potionId: null }), /номер/);
  assert.equal(JSON.stringify(f.p()), snapshot);
});

test("gathering never repeats food, XP, quest or achievement accounting",()=>{
  const f=fixture(),before=structuredClone(f.p());
  f.progress({type:"alchemyGather",natural:300});
  const after=f.p();
  for(const field of ["activity","quests","greatness","honors","inventory","wallet","pets"])
    assert.deepEqual(after[field],before[field],field);
  const progress=structuredClone(after.progress);delete progress.session.alchemyNatural;
  assert.deepEqual(progress,before.progress);assert.equal(f.view().natural,300);
});
test("brew exact Strength recipe, study and equip; replay, insufficient stock and off-event rejection", () => {
  const f = fixture(); f.command("start", { eventId: A.manifest.id });
  const run = f.manager.active();
  f.progress({ type: "alchemyGather", natural: 5, runId: run.id,
    ingredients: { mushroom: 3, leaf: 3, berries: 5 } });
  const input = f.input("brew", { runId: run.id, potionId: "strength" });
  f.act(input); f.act(input);
  assert.equal(f.p().inventory.alchemy_strength, 5);
  assert.deepEqual(f.view().learned, ["strength"]);
  assert.equal(f.view().equipped, "strength");
  assert.deepEqual(f.view().ingredients, { mushroom: 0, leaf: 0, berries: 0 });
  assert.throws(() => f.act(f.input("brew", { runId: run.id, potionId: "strength" })), /Не хватает/);
  f.time(run.endsAt);
  f.store.refreshCompetition();
  const saved = JSON.stringify(f.p());
  assert.throws(() => f.act(f.input("brew", { runId: run.id, potionId: "strength" })), /во время/);
  assert.equal(JSON.stringify(f.p()), saved);
  f.act(f.input("equip", { potionId: null }));
  f.act(f.input("equip", { potionId: "strength" }));
  assert.equal(f.view().equipped, "strength");
  assert.equal(f.view().active, false);
});
test("life and event boundaries reject stale totals, do not lose natural ether after event", () => {
  const f = fixture(); f.command("start", { eventId: A.manifest.id });
  const run = f.manager.active();
  f.progress({ type: "alchemyGather", natural: 10, runId: run.id, ingredients: { leaf: 2 } });
  f.progress({ type: "alchemyGather", natural: 10, runId: run.id, ingredients: { leaf: 2 } });
  assert.equal(f.view().ingredients.leaf, 2);
  f.time(run.endsAt);
  f.progress({ type: "alchemyGather", natural: 15, runId: run.id, ingredients: { leaf: 10 } });
  assert.equal(f.view().natural, 15); assert.equal(f.view().ingredients.leaf, 2);
  f.progress({ type: "lifeEnded", reason: "exit", durationSeconds: 1 });
  f.progress({ type: "alchemyGather", natural: 100000 });
  assert.equal(f.view().natural, 15);
  f.progress({ type: "lifeStarted", lifeId: "next-life" },
    { type: "alchemyGather", lifeId: "next-life", natural: 3 });
  assert.equal(f.view().natural, 18);
});
test("invalid counters roll back whole batch and pure views never mutate profiles", () => {
  const f = fixture(); f.command("start", { eventId: A.manifest.id });
  const runId = f.manager.active().id, before = JSON.stringify(f.p());
  f.view(); assert.equal(JSON.stringify(f.p()), before);
  assert.throws(() => f.progress({ type: "alchemyGather", natural: 100, runId, ingredients: { leaf: -1 } }));
  assert.equal(JSON.stringify(f.p()), before);
  assert.throws(() => f.progress({ type: "alchemyGather", natural: Infinity }));
  assert.equal(JSON.stringify(f.p()), before);
});
test("potion catalog cannot be bought for zero or equipped in normal slots", () => {
  const f = fixture();
  for (const potion of A.rules.potions) {
    const booster = BOOSTERS.get(potion.boosterId);
    assert.equal(booster.kind, "potion");
    assert.equal(loadout.itemAllowed(booster, 999), false);
    assert.equal(publicCatalog().items.find(p => p.id === booster.id).purchasable, false);
    assert.throws(() => f.store.buy(f.user.token, booster.id, randomUUID()), /лаборатории/);
    assert.equal(new Set(potion.ingredients.map(i => i.id)).size, potion.tier);
    assert.ok([3, 4, 5].includes(potion.tier));
  }
  assert.equal(A.rules.potions.length, 16); assert.equal(A.rules.ingredients.length, 10);
});
