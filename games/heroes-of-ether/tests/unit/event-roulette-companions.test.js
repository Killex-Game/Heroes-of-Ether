"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture"),
  activities = require("../../src/server/events/event-activities"),
  lucky = require("../../src/server/events/lucky-week"),
  roulette = require("../../src/server/roulette/roulette-service"),
  rules = require("../../public/shared/roulette-rules");

test("roulette companions resolve saved and future manifests without enabling unrequested Lite", () => {
  for (const contentPack of ["black-friday-v1", "core-v1"]) {
    const source = { contentPack, features: { roulette: true, lite: false }, description: "Старое описание" },
      before = structuredClone(source);
    assert.equal(activities.includes(source, "lucky-week-v1"), true);
    const result = activities.describe(source);
    assert.equal(result.linkedEvents[0].contentPack, "lucky-week-v1");
    assert.equal(result.features.lite, false);
    assert.equal(result.description, contentPack === "black-friday-v1"
      ? require("../../src/server/events/black-friday").manifest.description
      : source.description);
    assert.deepEqual(source, before);
  }
  assert.equal(
    activities.includes({ contentPack: "core-v1", features: {} }, "lucky-week-v1"),
    false,
  );
  assert.equal(activities.describe(lucky.manifest).linkedEvents.length, 0);
  assert.equal(
    activities.describe({ contentPack: "easter-hunt-v1", features: {} }).features.lite,
    true,
  );
});

test("Black Friday exposes both achievement sets and counts real Roulette/Lite operations once", () => {
  const f = fixture();
  assert.equal(lucky.view(f.p(), f.manager, f.now()).length, 5);
  assert.equal(f.view().achievements.length, 13);
  f.store.confirmMockPurchase(f.user.token, {
    requestId: randomUUID(),
    productId: "account:lite",
    confirmed: true,
    eventId: f.run.id,
  });
  assert.equal(f.p().eventAchievements[f.run.id].values.lucky_lite, 1);
  roulette.mutate(
    f.store,
    f.user.token,
    { action: "prepare", requestId: randomUUID(), rulesVersion: rules.version },
    () => 0,
  );
  const order = {
    action: "spin-five",
    offerId: f.p().roulette.offer.id,
    requestId: randomUUID(),
    rulesVersion: rules.version,
  };
  roulette.mutate(f.store, f.user.token, order, () => 0);
  assert.equal(f.p().eventAchievements[f.run.id].values.lucky_attempt, 5);
  assert.equal(f.p().eventAchievements[f.run.id].values.lucky_gold_mine, 5);
  const saved = structuredClone(f.p());
  assert.equal(roulette.mutate(f.store, f.user.token, order).replay, true);
  assert.deepEqual(f.p(), saved);
  f.time(f.run.endsAt);
  assert.deepEqual(lucky.view(f.p(), f.manager, f.now()), []);
  assert.equal(f.view().active, false);
  assert.deepEqual(f.p(), saved);
});

test("Alchemy stays standalone for old saved manifests without replacing the launch or losing rewards", () => {
  const f = fixture();
  f.command("stop", { runId: f.run.id });
  f.command("start", { eventId: "ether-alchemy" });
  const run = f.manager.active();
  // Reproduce the already running manifest from before the corrected rules.
  run.manifest.features = { roulette: true, lite: true };
  f.p().roulette.tickets += 20; f.p().roulette.earned += 20;
  f.p().eventAchievements = { [run.id]: { pack: "lucky-week-v1", values: { lucky_attempt: 4 }, claimed: {} } };
  const original = structuredClone(f.manager.data), saved = structuredClone(f.p());
  const publicEvent = f.manager.publicView();
  assert.equal(publicEvent.runId, run.id);
  assert.equal(publicEvent.features.roulette, false);
  assert.equal(publicEvent.features.lite, false);
  assert.deepEqual(publicEvent.linkedEvents, []);
  assert.deepEqual(lucky.view(f.p(), f.manager, f.now()), []);
  const view = f.store.view(f.p());
  assert.equal(view.alchemy.active, true);
  assert.equal(view.roulette.available, false); assert.equal(view.roulette.lite.available, false);
  assert.throws(() => f.store.confirmMockPurchase(f.user.token, { requestId: randomUUID(), productId: "account:lite", confirmed: true, eventId: run.id }), /недоступ|заверш|событи|закончил/i);
  assert.throws(() => roulette.mutate(f.store, f.user.token, { action: "prepare", requestId: randomUUID(), rulesVersion: rules.version }, () => 0), /недоступ|заверш|событи|закончил/i);
  lucky.spin(f.p(), f.manager, {category:"coins",amount:50}, f.now());
  assert.deepEqual(f.p(), saved); assert.deepEqual(f.manager.data, original);
  f.command("stop", { runId: run.id });
  assert.deepEqual(f.manager.rouletteConfig({}).events, []);
  assert.deepEqual(lucky.view(f.p(), f.manager, f.now()), []);
  assert.deepEqual(f.p(), saved);
  f.command("start", { eventId: "lucky-week" });
  assert.equal(f.store.view(f.p()).roulette.available, true);
  assert.equal(f.p().roulette.tickets, saved.roulette.tickets);
  assert.deepEqual(f.p().eventAchievements, saved.eventAchievements);
});
