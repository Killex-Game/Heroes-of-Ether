"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { applyEvent, validateProgress } = require("../../src/server/progression/experience-progression");
const activity = require("../../src/server/progression/activity-achievements");
const { awardTitles, validateHonors } = require("../../src/server/progression/title-chest-rewards");
const epoch = Date.parse("2026-11-03T20:59:59Z");
function profile() {
  const store = new ProfileStore({ now: () => epoch });
  const auth = store.open();
  return structuredClone(store.find(auth.token));
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}
function settle(p, event, at, optimized) {
  const current = applyEvent(p, event, at) === true;
  activity.refreshCalendar(p, at, false, optimized && current);
  awardTitles(p, at);
  validateProgress(p);
  activity.validateActivity(p);
  validateHonors(p);
}

test("Arena settlement retains every reward across age, account expiry, replay and life boundaries", () => {
  for (const kind of ["none", "vip", "premium", "both"]) {
    const actual = profile();
    actual.account = { vipUntil: ["vip", "both"].includes(kind) ? epoch + 1000 : 0,
      premiumUntil: ["premium", "both"].includes(kind) ? epoch + 3000 : 0 };
    actual.activity.registeredAt = epoch - 15 * activity.DAY + 500;
    actual.progress.boosterUses = 99;
    const expected = structuredClone(actual);
    const events = [
      [0, { type: "lifeStarted", lifeId: "life" }],
      [50, { type: "boosterUsed", mass: 1000 }],
      [500, { type: "massPeak", mass: 25000 }],
      [1000, { type: "massPeak", mass: 50000 }],
      [2000, { type: "lifeTime", lifeId: "life", durationSeconds: 2 }],
      [3000, { type: "massPeak", mass: 100000 }],
      [4000, { type: "absorbed", victimProfileId: "other", lifeId: "victim-life", gain: 1000 }],
      [4500, { type: "absorbed", victimProfileId: "other", lifeId: "victim-life", gain: 1000 }],
      [5000, { type: "lifeStarted", lifeId: "life" }],
      [6000, { type: "lifeEnded", lifeId: "life", durationSeconds: 6, reason: "left" }],
      [6500, { type: "lifeEnded", lifeId: "life", durationSeconds: 6, reason: "left" }],
    ];
    for (const [offset, event] of events) {
      settle(actual, event, epoch + offset, true);
      settle(expected, event, epoch + offset, false);
      assert.deepEqual(actual, expected, kind + " / " + event.type);
    }
    assert.equal(actual.activity.claimed.fan, 1);
    assert.equal(actual.progress.boosterUses, 100);
    assert.equal(actual.progress.claimed.boosters, 1);
    assert.equal(actual.progress.absorbedMass, 1000, "duplicate victim is still suppressed");
  }
});

test("Early-returned events still settle newly due calendar rewards", () => {
  const p = profile();
  p.activity.registeredAt = epoch - 15 * activity.DAY;
  applyEvent(p, { type: "lifeStarted", lifeId: "same" }, epoch - 1);
  const before = p.greatness;
  settle(p, { type: "lifeStarted", lifeId: "same" }, epoch, true);
  assert.equal(p.greatness, before + 30);
  assert.equal(p.activity.claimed.fan, 1);
});

test("Title awards preserve published honors, prepared chests and legacy dates", () => {
  const p = profile();
  const old = freeze(p.honors);
  awardTitles(p, epoch);
  assert.strictEqual(p.honors, old, "unchanged honors do not need a draft");
  p.greatness = 5000;
  awardTitles(p, epoch);
  assert.notStrictEqual(p.honors, old);
  assert.equal(old.claimed, 0);
  assert.equal(p.honors.claimed, 2);
  assert.ok(Object.values(p.honors.medals).every(at => at === epoch));
  validateHonors(p);
  const legacy = structuredClone(p.honors);
  delete legacy.medals;
  delete legacy.notified;
  p.honors = freeze(legacy);
  awardTitles(p, epoch + 1);
  assert.equal(p.honors.notified, 2);
  assert.ok(Object.values(p.honors.medals).every(at => at === null));
  assert.equal(legacy.medals, undefined);
  validateHonors(p);
});
