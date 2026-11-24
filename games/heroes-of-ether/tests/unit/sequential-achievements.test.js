"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp"),
  lucky = require("../../src/server/events/lucky-week"),
  activity = require("../../src/server/progression/activity-achievements"),
  stages = require("../../src/server/progression/achievement-stages");
const now = Date.parse("2026-10-24T12:00:00Z");
const run = {
  id: "sequential-test",
  startsAt: now - 1000,
  endsAt: now + 100000,
  manifest: lucky.manifest,
};
const manager = { data: { runs: [run] } };
test("Золотая жила: 1 + 2 + 3 + 4 + 5 VIP; степени на 1, 3, 6, 10, 15 выигрыше", () => {
  const store = new ProfileStore({ now: () => now }),
    user = store.open(),
    p = store.find(user.token);
  for (let i = 1; i <= 15; i++) {
    lucky.spin(p, manager, { category: "vip", amount: 1 }, now);
    const earned = [1, 3, 6, 10, 15].filter((n) => n <= i).length;
    const view = lucky.view(p, manager, now).find((d) => d.id === "lucky_gold_mine");
    assert.equal(view.claimed, earned, "выигрыш " + i);
    assert.equal(
      p.greatness,
      [50, 100, 150, 300, 500].slice(0, earned).reduce((a, b) => a + b, 0) + (i >= 10 ? 25 : 0),
    );
    if (i < 15) assert.equal(view.value, i - [0, 1, 3, 6, 10][earned]);
    lucky.validate(p);
  }
});
test("Все цепочки по умолчанию расходуют цель; коллекционные исключения сохраняют общий счётчик", () => {
  assert.deepEqual(
    activity.EXTRA_ACHIEVEMENTS.filter((d) => d.exception)
      .map((d) => d.id)
      .sort(),
    ["clan_quest_days", "clan_quest_five", "clan_quest_help", "clan_quest_seasons", "clan_quest_types", "fan", "fashionista", "pet_exclusive", "pet_master", "pet_nursery"],
  );
  const store = new ProfileStore({ now: () => now });
  for (const d of activity.EXTRA_ACHIEVEMENTS.filter((d) => !d.unavailable)) {
    const user = store.open(),
      p = structuredClone(store.find(user.token));
    let total = 0;
    for (let i = 0; i < d.thresholds.length; i++) {
      total = d.exception ? d.thresholds[i] : total + d.thresholds[i];
      p.activity.values[d.id] = total;
      activity.awardExtra(p, now);
      const result = activity.publicExtra(p).find((a) => a.id === d.id);
      assert.equal(result.claimed, i + 1, d.id);
      if (i < d.thresholds.length - 1) assert.equal(result.value, d.exception ? total : 0, d.id);
    }
  }
  const d = { id: "future", exception: true, thresholds: [1, 2] };
  const s = { claimed: { future: 1 }, stageSpent: { future: 0 } };
  assert.equal(stages.current(s, d, 2), 2);
  stages.consume(s, d);
  assert.equal(s.stageSpent.future, 0, "новая пометка Исключение поддерживается общим правилом");
});
test("Миграция сохраняет старые степени, величие и текущий остаток; запись и перезапуск не повторяют награды", (t) => {
  const filePath = path.join(temporary(t, "sequential-migration"), "profiles.json");
  let store = new ProfileStore({ filePath, now: () => now });
  const user = store.open();
  store.transact(user.token, randomUUID(), "seed", (p) => {
    p.pets.games = p.activity.values.pet_trainer = 1200;
    p.activity.claimed.pet_trainer = 2;
    p.activity.stageSpent.pet_trainer = 1000;
    p.eventAchievements = {
      [run.id]: {
        pack: "lucky-week-v1",
        values: { lucky_gold_mine: 2 },
        claimed: { lucky_gold_mine: 2 },
      },
    };
  });
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const old = Object.values(data.profiles)[0];
  delete old.activity.achievementStagesVersion;
  old.activity.stageSpent.pet_trainer = 0;
  const oldGreatness = old.greatness;
  fs.writeFileSync(filePath, JSON.stringify(data));
  store = new ProfileStore({ filePath, now: () => now });
  store.events = manager;
  // Public event metadata is irrelevant to this isolated migration test.
  const p = store.find(user.token);
  assert.equal(p.greatness, oldGreatness);
  assert.equal(p.activity.claimed.pet_trainer, 2);
  assert.equal(activity.publicExtra(p).find((d) => d.id === "pet_trainer").value, 200);
  assert.equal(lucky.view(p, manager, now).find((d) => d.id === "lucky_gold_mine").value, 0);
  delete store.events;
  store.refreshCompetition();
  const committed = fs.readFileSync(filePath, "utf8");
  store = new ProfileStore({ filePath, now: () => now });
  store.refreshCompetition();
  assert.equal(fs.readFileSync(filePath, "utf8"), committed);
  assert.equal(store.find(user.token).greatness, oldGreatness);
  const restored = store.find(user.token);
  lucky.spin(restored, manager, { category: "vip" }, now);
  assert.equal(restored.eventAchievements[run.id].claimed.lucky_gold_mine, 2);
  assert.equal(lucky.view(restored, manager, now).find((d) => d.id === "lucky_gold_mine").value, 1);
});
