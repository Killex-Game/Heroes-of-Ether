"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { EventManager } = require("../../src/server/events/event-manager");
const { createProfileBatch, sealProfileBatch } = require("../../src/server/profiles/profile-batch");
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function fixture(t, eventId) {
  const at = Date.parse("2026-11-15T12:00:00Z"), store = new ProfileStore({ now: () => at });
  t.after(() => store.close());
  store.events = new EventManager({ now: () => at });
  if (eventId) store.events.apply("test", "start", {
    eventId, requestId: "inventory-event-fixture", revision: 0,
  });
  const user = store.open();
  store.startLife(user.profile.id, "inventory-life");
  const p = store.find(user.token);
  p.inventory.candy = 4;
  p.greatness = 99;
  const base = freeze(store.data), saved = structuredClone(base);
  return { store, user, at, p, base, saved,
    event: item => ({ profileId: p.id, lifeId: "inventory-life", ...item }) };
}
for (const eventId of [null, "black-friday", "easter-hunt"]) {
  test(`arena progress and life settlement preserve inventory across ${eventId || "ordinary play"}`, t => {
    const f = fixture(t, eventId), events = [
      f.event({ type: "massPeak", mass: 30000 }),
      f.event({ type: "questSample", food: 200, rank: 1 }),
      f.event({ type: "boosterUsed", mass: 2000 }),
      f.event({ type: "absorbed", victimProfileId: "other", victimDefeated: true, gain: 200 }),
      ...(eventId === "easter-hunt" ? [f.event({ type: "easterPickup", eggType: 0, runId: f.store.events.active().id })] : []),
      f.event({ type: "lifeEnded", durationSeconds: 90, reason: "absorbed" }),
    ];
    const result = f.store.arenaProgressDraft(f.base, "inventory-progress", events, f.at + 90000);
    assert.ok(result);
    const p = f.store.find(f.user.token, result.next);
    assert.deepEqual(p.inventory, f.p.inventory);
    assert.equal(p.progress.session, null);
    assert.ok(p.progress.absorptionKills > 0);
    if (eventId === "easter-hunt") assert.equal(p.easter.runs[f.store.events.active().id].found[0], 1);
    assert.deepEqual(f.base, f.saved);
    assert.equal(f.store.arenaProgressDraft(result.next, "inventory-progress", events, f.at + 90000), null);
  });
}
test("a cast after shared progress owns its inventory; failure/replay cannot alter prior snapshots", t => {
  const f = fixture(t), event = f.event({ type: "massPeak", mass: 4000 });
  const earned = f.store.arenaProgressDraft(f.base, "before-cast", [event], f.at).next;
  const saved = structuredClone(earned);
  freeze(earned);
  const batch = createProfileBatch(earned), requestId = "inventory-isolation-cast";
  const cast = validate => f.store.consume(f.user.token, "candy", requestId, "inventory-cast", validate, true, batch);
  assert.throws(() => cast(() => { throw Error("invalid target"); }), /invalid target/);
  assert.equal(batch.next, earned);
  assert.equal(cast(() => ({ mass: 4000 })).replay, false);
  assert.equal(f.store.find(f.user.token, batch.next).inventory.candy, 3);
  assert.equal(cast(() => { throw Error("replay must not apply"); }).replay, true);
  sealProfileBatch(batch);
  assert.deepEqual(earned, saved);
  assert.deepEqual(f.base, f.saved);
  assert.equal(f.store.find(f.user.token, earned).inventory.candy, 4);
});
