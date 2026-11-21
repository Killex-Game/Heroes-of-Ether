"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  activity = require("../../src/server/progression/activity-achievements"),
  progression = require("../../src/server/progression/experience-progression");
test("updated greatness scales are public and each new degree awards once without retroactive grants", () => {
  const now = Date.UTC(2026, 9, 23, 12),
    store = new ProfileStore({ now: () => now });
  const common = [
    "pet_nursery",
    "pet_feeder",
    "loving",
    "always_together",
    "top",
    "generous",
    "needed",
    "sociable",
    "for_clan",
    "investment",
    "resident",
    "gamer",
    "jumper",
    "regular",
  ];
  for (const [id, rewards] of [
    ...common.map((id) => [id, [10, 30, 50, 100]]),
    ...["not_stingy", "wealthy", "spendthrift", "miner", "spendthrift_i", "banker", "spendthrift_ii"]
      .map((id) => [id, [50, 150, 300, 500]]),
    ["strong_love", [10, 30, 50, 100]],
    ["valuable", [10, 30, 50, 100]],
    ["pet_trainer", [50, 100, 150, 300]],
    ["pet_master", [250, 500, 1500, 3000]],
    ["pet_exclusive", [250, 500]],
    ["marriage", [100]],
  ]) {
    const user = store.open(),
      p = store.find(user.token),
      def = activity.EXTRA_ACHIEVEMENTS.find((d) => d.id === id);
    assert.deepEqual(
      store.view(p).progress.achievements.find((d) => d.id === id).rewards,
      rewards,
      id,
    );
    let earned = 0;
    for (let tier = 0; tier < rewards.length; tier++) {
      p.activity.values[id] = def.cumulative
        ? def.thresholds[tier]
        : def.thresholds.slice(0, tier + 1).reduce((a, b) => a + b, 0);
      activity.awardExtra(p, now);
      earned += rewards[tier];
      assert.equal(p.greatness, earned, id + " degree " + tier);
      const copy = structuredClone(p);
      activity.awardExtra(p, now);
      assert.deepEqual(p, copy);
    }
    // A previously paid degree stays paid even when a balance reflects the older reward.
    p.greatness = 17;
    const old = structuredClone(p);
    activity.awardExtra(p, now);
    assert.deepEqual(p, old);
  }
  assert.deepEqual(progression.GREATNESS_REWARDS, [10, 30, 50, 100]);
  assert.deepEqual(
    activity.EXTRA_ACHIEVEMENTS.find((d) => d.id === "pet_master").rewards,
    [250, 500, 1500, 3000],
  );
  assert.deepEqual(
    activity.EXTRA_ACHIEVEMENTS.find((d) => d.id === "fan").rewards,
    [30, 50, 150, 300, 1000],
  );
});
