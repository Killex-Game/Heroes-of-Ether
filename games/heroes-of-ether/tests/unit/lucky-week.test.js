"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto");
const { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager");
const lucky = require("../../src/server/events/lucky-week"),
  roulette = require("../../src/server/roulette/roulette-service"),
  rules = require("../../public/shared/roulette-rules");
function fixture(t) {
  const folder = temporary(t, "lucky-week"),
    filePath = path.join(folder, "profiles.json"),
    eventPath = path.join(folder, "events.json");
  let now = Date.UTC(2026, 9, 23, 10),
    store = new ProfileStore({ filePath, now: () => now }),
    manager = new EventManager({ filePath: eventPath, now: () => now });
  store.events = manager;
  const user = store.open(),
    spouse = store.open(),
    p = () => store.find(user.token),
    q = () => store.find(spouse.token);
  const command = (action, extra) =>
    manager.apply("owner", action, {
      requestId: randomUUID(),
      revision: manager.data.revision,
      ...extra,
    });
  const start = () => command("start", { eventId: "lucky-week" });
  const spin = (action, extra = {}, random = () => 0) =>
    roulette.mutate(
      store,
      user.token,
      { requestId: randomUUID(), rulesVersion: rules.version, action, ...extra },
      random,
    );
  const purchase = () =>
    store.confirmMockPurchase(user.token, {
      requestId: randomUUID(),
      productId: "account:lite",
      confirmed: true,
      eventId: manager.active().id,
    });
  const progress = (events) =>
    store.applyArenaProgress(
      randomUUID(),
      events.map((e) => ({ profileId: p().id, ...e })),
      now,
    );
  return {
    folder,
    filePath,
    eventPath,
    get store() {
      return store;
    },
    get manager() {
      return manager;
    },
    user,
    spouse,
    p,
    q,
    start,
    command,
    spin,
    purchase,
    progress,
    time: (n) => (now = n),
    now: () => now,
    restore() {
      manager = new EventManager({ filePath: eventPath, now: () => now });
      store = new ProfileStore({ filePath, now: () => now });
      store.events = manager;
    },
  };
}
test("installed week is prepared but inactive; every tier pays exact fixed greatness once", (t) => {
  const f = fixture(t);
  assert.equal(f.manager.active(), null);
  assert.equal(f.manager.view().prepared[0].manifest.title, "Удачная неделя");
  assert.deepEqual(lucky.view(f.p(), f.manager, f.now()), []);
  f.start();
  const p = f.p(),
    run = f.manager.active();
  p.account = require("../../src/server/accounts/account-benefits").fresh();
  p.account.vipUntil = f.now() + 3600000;
  p.account.premiumUntil = f.now() + 3600000;
  let total = 0;
  for (const d of lucky.achievements) {
    for (let i = 0; i < d.thresholds.length; i++) {
      const before = p.greatness;
      lucky.record(p, run, d.id, d.thresholds[i]);
      assert.equal(p.greatness - before, d.rewards[i]);
      total += d.rewards[i];
      lucky.validate(p);
    }
    lucky.record(p, run, d.id, 1);
  }
  assert.equal(p.greatness, total);
  assert.equal(lucky.view(p, f.manager, f.now()).length, 5);
});
for (const ending of ["expiry", "stop"])
  test(`real Lite and five spins are atomic, replay safe; ${ending} hides only event progress; repeat starts fresh`, (t) => {
    const f = fixture(t);
    f.start();
    const run = f.manager.active();
    f.purchase();
    assert.equal(f.p().eventAchievements[run.id].values.lucky_lite, 1);
    assert.equal(f.p().roulette.tickets, 50);
    f.spin("prepare");
    const order = {
      action: "spin-five",
      offerId: f.p().roulette.offer.id,
      requestId: randomUUID(),
      rulesVersion: rules.version,
    };
    const before = structuredClone(f.p()),
      original = fs.renameSync;
    fs.renameSync = () => {
      throw Error("test disk failure");
    };
    try {
      assert.throws(() => roulette.mutate(f.store, f.user.token, order, () => 0), /disk failure/);
    } finally {
      fs.renameSync = original;
    }
    assert.deepEqual(f.p(), before);
    roulette.mutate(f.store, f.user.token, order, () => 0);
    assert.equal(f.p().eventAchievements[run.id].values.lucky_attempt, 5);
    assert.equal(f.p().eventAchievements[run.id].values.lucky_gold_mine, 5);
    assert.equal(f.p().eventAchievements[run.id].claimed.lucky_gold_mine, 2);
    assert.equal(
      lucky.view(f.p(), f.manager, f.now()).find((a) => a.id === "lucky_gold_mine").value,
      2,
    );
    const saved = structuredClone(f.p());
    assert.equal(roulette.mutate(f.store, f.user.token, order).replay, true);
    assert.deepEqual(f.p(), saved);
    f.restore();
    assert.deepEqual(f.p().eventAchievements, saved.eventAchievements);
    if (ending === "expiry") f.time(run.endsAt);
    else {
      f.time(f.now() + 1000);
      f.command("stop", { runId: run.id });
    }
    assert.deepEqual(lucky.view(f.p(), f.manager, f.now()), []);
    assert.equal(f.p().roulette.tickets, 45);
    assert.equal(f.p().greatness, saved.greatness);
    f.start();
    f.time(f.manager.scheduled()?.startsAt ?? f.now());
    assert.notEqual(f.manager.active().id, run.id);
    assert.ok(lucky.view(f.p(), f.manager, f.now()).every((a) => a.value === 0 && a.claimed === 0));
    f.store.refreshCompetition();
    const beforePurchase = f.p().greatness,
      beforeTickets = f.p().roulette.tickets;
    // При переходе суток первое место по величию приносит ещё 3 билета.
    assert.equal(beforeTickets, 45 + (ending === "expiry" ? 3 : 0));
    f.purchase();
    assert.equal(f.p().roulette.tickets, beforeTickets + 50);
    assert.equal(f.p().greatness, beforePurchase + 250);
    assert.equal(roulette.mutate(f.store, f.user.token, order).replay, true);
    assert.equal(f.p().eventAchievements[f.manager.active().id].values.lucky_attempt, undefined);
  });
test("arsenal counts booster quantities, not slots; non-booster rewards do not count", (t) => {
  const f = fixture(t);
  f.start();
  const p = f.p(),
    run = f.manager.active();
  lucky.spin(p, f.manager, { category: "clan", boosterId: "fire", amount: 10 }, f.now());
  lucky.spin(p, f.manager, { category: "crystals", amount: 15 }, f.now());
  assert.equal(p.eventAchievements[run.id].values.lucky_arsenal, 10);
  assert.equal(p.eventAchievements[run.id].values.lucky_attempt, 2);
});
test("earned spouse level survives interruption before life end, commits once on restore", (t) => {
  const f = fixture(t);
  f.start();
  const run = f.manager.active().id;
  f.p().social = {
    marriage: { partnerId: f.q().id, at: f.now() },
    invitations: [],
    gifts: [],
    inviteReadyAt: 0,
  };
  f.progress([
    { type: "lifeStarted", lifeId: randomUUID() },
    { type: "survivalMinute", minutes: 1000, mass: 10000, spouseOnArena: f.q().id },
  ]);
  f.restore();
  f.store.refreshCompetition();
  assert.equal(f.p().eventAchievements[run].values.lucky_marriage_games, 1);
  f.restore();
  f.store.refreshCompetition();
  assert.equal(f.p().eventAchievements[run].values.lucky_marriage_games, 1);
});
test("marriage game credits only the level gainer, with spouse present when XP target is reached; retries and expiry do not duplicate", (t) => {
  const f = fixture(t);
  f.start();
  const id = f.manager.active().id;
  f.p().social = {
    marriage: { partnerId: f.q().id, at: f.now() },
    invitations: [],
    gifts: [],
    inviteReadyAt: 0,
  };
  f.q().social = {
    marriage: { partnerId: f.p().id, at: f.now() },
    invitations: [],
    gifts: [],
    inviteReadyAt: 0,
  };
  const life = randomUUID();
  f.progress([{ type: "lifeStarted", lifeId: life }]);
  f.progress([{ type: "survivalMinute", minutes: 100, mass: 10000, spouseOnArena: f.q().id }]);
  assert.ok(f.p().progress.session.luckyLevel);
  assert.equal(f.p().eventAchievements, undefined);
  const events = [
      { profileId: f.p().id, type: "lifeEnded", lifeId: life, durationSeconds: 60, reason: "exit" },
    ],
    batch = randomUUID();
  f.store.applyArenaProgress(batch, events, f.now());
  f.store.applyArenaProgress(batch, events, f.now());
  assert.equal(f.p().eventAchievements[id].values.lucky_marriage_games, 1);
  assert.equal(f.q().eventAchievements, undefined);
  const next = randomUUID();
  f.progress([
    { type: "lifeStarted", lifeId: next },
    { type: "survivalMinute", minutes: 1000, mass: 10000 },
    { type: "lifeEnded", lifeId: next, durationSeconds: 60, reason: "exit" },
  ]);
  assert.equal(f.p().eventAchievements[id].values.lucky_marriage_games, 1);
  const last = randomUUID();
  f.progress([
    { type: "lifeStarted", lifeId: last },
    { type: "survivalMinute", minutes: 1000, mass: 10000, spouseOnArena: f.q().id },
  ]);
  f.time(f.manager.active().endsAt);
  f.progress([{ type: "lifeEnded", lifeId: last, durationSeconds: 60, reason: "exit" }]);
  assert.equal(f.p().eventAchievements[id].values.lucky_marriage_games, 1);
});
