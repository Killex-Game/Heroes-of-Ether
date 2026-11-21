"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { selectChecks } = require("../../scripts/testing/event-checks.cjs");
const { packs } = require("../../src/server/events/event-packs");
test("each installed event pack has an explicit functional suite and browser scenarios", () => {
  for (const id of Object.keys(packs)) {
    const selected = selectChecks(id);
    assert.ok(selected.files.includes("tests/unit/event-lifecycle-cache.test.js"));
    assert.ok(selected.files.includes("tests/unit/event-roulette-companions.test.js"));
    assert.ok(selected.browser.length > 0);
  }
  const friday = selectChecks("black-friday-v1").files;
  for (const file of ["black-friday-recovery", "black-friday-economy", "black-friday-chest-tokens", "friday-roulette"])
    assert.ok(friday.includes(`tests/integration/${file}.test.js`));
});
test("adding a pack without its regression checks fails the release check", () => {
  assert.throws(() => selectChecks("all", { ...packs, "future-v1": {} }), /future-v1/);
  assert.throws(() => selectChecks("missing-v1"), /Unknown event/);
});
test("event achievement degrees have complete, unique, nonnegative reward definitions", () => {
  for (const pack of Object.values(packs)) {
    const ids = new Set();
    for (const a of pack.achievements) {
      assert.ok(!ids.has(a.id), `${pack.id}: duplicate ${a.id}`);
      ids.add(a.id);
      assert.ok(a.name && a.description, a.id);
      assert.ok(a.thresholds.length > 0, a.id);
      assert.equal(a.thresholds.length, a.rewards.length, a.id);
      assert.ok(a.thresholds.every(n => Number.isSafeInteger(n) && n > 0), a.id);
      assert.ok(a.rewards.every(n => Number.isSafeInteger(n) && n >= 0), a.id);
    }
  }
});
