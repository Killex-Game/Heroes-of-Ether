"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value); for (const child of Object.values(value)) freeze(child);
}
test("passive arena samples retain counters until their hour/day changes, without mutating the prior world", async () => {
  let at = Date.parse("2026-11-03T12:00:00Z");
  const store = new ProfileStore({ now: () => at, incrementalSettlement: true });
  try {
    const auth = store.open(); store.startLife(auth.profile.id, "passive-life");
    const before = store.data, p = store.byId(auth.profile.id), saved = structuredClone(before);
    freeze(before);
    store.applyArenaProgress("sample-1", [
      { type: "massPeak", profileId: p.id, mass: 21 },
      { type: "lifeTime", profileId: p.id, lifeId: "passive-life", durationSeconds: 1 },
    ], at + 1000);
    const after = store.byId(p.id);
    assert.deepEqual(before, saved);
    assert.equal(after.activity.values, p.activity.values);
    assert.equal(after.activity.arenaSeconds, p.activity.arenaSeconds + 1);
    const intermediate = store.data; freeze(intermediate);
    at += 86400000;
    store.applyArenaProgress("sample-2", [
      { type: "lifeTime", profileId: p.id, lifeId: "passive-life", durationSeconds: 3600 },
    ], at);
    const later = store.byId(p.id);
    assert.equal(later.activity.values.gamer, 1);
    assert.equal(later.activity.values.fan, 1);
    assert.equal(after.activity.values.gamer, 0);
    assert.equal(after.activity.values.fan, 0);
    assert.notEqual(later.activity.values, after.activity.values);
  } finally { await store.close(); }
});
