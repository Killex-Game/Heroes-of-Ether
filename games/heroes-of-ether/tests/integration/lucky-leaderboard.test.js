"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { EventManager } = require("../../src/server/events/event-manager");
const R = require("../../src/server/rankings/event-leaderboards");
const lucky = require("../../src/server/events/lucky-week");
const lite = require("../../src/server/accounts/lite-account");
const roulette = require("../../src/server/roulette/roulette-service");
const rules = require("../../public/shared/roulette-rules");
const START = Date.UTC(2026, 10, 8, 10);
function fixture(pack = "lucky-week") {
  let at = START;
  const store = new ProfileStore({ now: () => at });
  const events = new EventManager({ now: () => at });
  store.events = events;
  const command = (action, extra) => events.apply("test", action, {
    revision: events.data.revision, requestId: randomUUID(), ...extra,
  });
  command("start", { eventId: pack });
  const run = events.active(), auth = store.open();
  return { store, events, run, auth, command, p: () => store.find(auth.token),
    time: value => { at = value; }, now: () => at };
}
test("standalone Lucky Week counts consumed tickets only, including five spins; retry/failure are atomic", () => {
  const f = fixture();
  lite.activate(f.p(), f.events.rouletteConfig({}, f.now()), f.now(), f.run.id);
  assert.equal(R.view(f.store, f.p()).total, 0);
  const act = (action, extra = {}) => roulette.mutate(f.store, f.auth.token, {
    action, rulesVersion: rules.version, requestId: randomUUID(), ...extra,
  }, () => 0);
  act("tickets", { currency: "coins", quantity: 1, eventId: f.run.id });
  assert.equal(R.view(f.store, f.p()).total, 0);
  act("prepare");
  const request = { action: "spin-five", offerId: f.p().roulette.offer.id,
    rulesVersion: rules.version, requestId: randomUUID() };
  const before = structuredClone(f.store.data), write = f.store.writeSnapshot;
  f.store.writeSnapshot = () => { throw Error("test disk failure"); };
  assert.throws(() => roulette.mutate(f.store, f.auth.token, request, () => 0), /disk failure/);
  assert.deepEqual(f.store.data, before);
  f.store.writeSnapshot = write;
  roulette.mutate(f.store, f.auth.token, request, () => 0);
  assert.equal(R.view(f.store, f.p()).mine.score, 5);
  assert.equal(roulette.mutate(f.store, f.auth.token, request).replay, true);
  assert.equal(R.view(f.store, f.p()).mine.score, 5);
  act("prepare");
  act("spin", { offerId: f.p().roulette.offer.id });
  assert.equal(R.view(f.store, f.p()).mine.score, 6);
  f.time(f.run.endsAt);
  assert.equal(R.view(f.store, f.p()), null);
  lucky.spin(f.p(), f.events, { category: "coins", amount: 50 }, f.now());
  assert.equal(f.p().eventAchievements[f.run.id].values.lucky_attempt, 6);
});
test("daily tiers pay fixed greatness/ether once at Moscow midnight; bots and rank 51 get nothing", () => {
  const f = fixture();
  const tokens = [f.auth.token, ...Array.from({ length: 51 }, () => f.store.open().token)];
  const users = tokens.map(token => f.store.find(token));
  for (const [i, p] of users.entries()) {
    p.eventAchievements = { [f.run.id]: { pack: "lucky-week-v1", values: { lucky_attempt: 100 - i }, claimed: {},
      dailySpins: { [R.dayAt(START)]: 100 - i } } };
    p.account = require("../../src/server/accounts/account-benefits").fresh();
    p.account.vipUntil = p.account.premiumUntil = f.run.endsAt + 100000;
  }
  users[51].testBot = true;
  users[51].eventAchievements[f.run.id].values.lucky_attempt = 10000;
  users[0].greatness = 95;
  const initial = structuredClone(f.store.data);
  assert.equal(R.view(f.store, f.p()).title, "Топ счастливчиков");
  assert.equal(R.view(f.store, f.p()).period, "day");
  assert.equal(R.view(f.store, f.p()).total, 51);
  const midnight = R.dayEnd(R.dayAt(START)), key = R.resultKey(f.run.id, R.dayAt(START));
  assert.equal(midnight, Date.UTC(2026, 10, 8, 21));
  assert.equal(R.settle(initial, f.events, midnight - 1), initial);
  const paid = R.settle(initial, f.events, midnight);
  R.validate(paid);
  const result = paid.eventDailyRankingResults[key];
  assert.equal(result.entries.length, 51);
  for (const entry of result.entries) {
    const amount = entry.rank <= 3 ? 10 : entry.rank <= 10 ? 7 : entry.rank <= 50 ? 5 : 0;
    const old = Object.values(initial.profiles).find(p => p.id === entry.id);
    const p = Object.values(paid.profiles).find(p => p.id === entry.id);
    assert.equal(p.greatness - old.greatness, amount);
    assert.equal(p.wallet.bucks - old.wallet.bucks, amount);
    assert.equal(p.wallet.coins, old.wallet.coins);
    assert.equal(p.wallet.crystals, old.wallet.crystals);
  }
  const winner = Object.values(paid.profiles).find(p => p.id === users[0].id);
  assert.equal(winner.honors.claimed, 1, "top prize unlocks earned title");
  assert.equal(R.due(paid, f.events, f.run.endsAt), false);
  assert.equal(R.settle(paid, f.events, f.run.endsAt + 100000), paid);
  const restored = JSON.parse(JSON.stringify(paid));
  R.validate(restored);
  assert.equal(R.settle(restored, f.events, f.run.endsAt + 100000), restored);
  const broken = structuredClone(paid);
  broken.eventDailyRankingResults[key].entries[0].reward.greatness = -1;
  assert.throws(() => R.validate(broken), /Повреждены/);
});
test("early stop keeps the last daily score until midnight; a new run starts empty", () => {
  const f = fixture();
  lucky.spin(f.p(), f.events, { category: "coins", amount: 50 }, f.now());
  f.time(START + 60000);
  f.command("stop", { runId: f.run.id });
  assert.equal(R.view(f.store, f.p()), null);
  assert.equal(R.settle(f.store.data, f.events, f.now()), f.store.data);
  const midnight = R.dayEnd(R.dayAt(START));
  const paid = R.settle(f.store.data, f.events, midnight);
  assert.equal(paid.eventDailyRankingResults[R.resultKey(f.run.id, R.dayAt(START))].endsAt, midnight);
  f.store.data = paid;
  f.command("start", { eventId: "lucky-week" });
  f.time(f.events.scheduled()?.startsAt ?? f.now());
  assert.notEqual(f.events.active().id, f.run.id);
  assert.equal(R.view(f.store, f.p()).total, 0);
  assert.equal(R.settle(paid, f.events, f.now()), paid);
});
test("Easter companion roulette keeps the egg leaderboard and daily prizes", () => {
  const f = fixture("easter-hunt");
  lucky.spin(f.p(), f.events, { category: "coins", amount: 50 }, f.now());
  const board = R.view(f.store, f.p());
  assert.equal(board.title, "Топ искателей");
  assert.equal(board.period, "day");
  assert.equal(board.total, 0);
  const ended = R.settle(f.store.data, f.events, f.run.endsAt);
  assert.equal(ended.eventRankingResults, undefined);
});
test("midnight resets only the top; multiple missed days settle independently without losing achievements", () => {
  const f = fixture(), day = R.dayAt(START), midnight = R.dayEnd(day);
  f.time(midnight - 1);
  for (let i = 0; i < 6; i++) lucky.spin(f.p(), f.events, { category: "coins", amount: 50 }, f.now());
  assert.equal(R.view(f.store, f.p()).mine.score, 6);
  f.time(midnight);
  assert.equal(R.view(f.store, f.p()).total, 0);
  for (let i = 0; i < 4; i++) lucky.spin(f.p(), f.events, { category: "coins", amount: 50 }, f.now());
  assert.equal(R.view(f.store, f.p()).mine.score, 4);
  assert.equal(f.p().eventAchievements[f.run.id].values.lucky_attempt, 10);
  lucky.validate(f.p());
  const base = structuredClone(f.store.data), before = f.p().greatness;
  const settled = R.settle(base, f.events, R.dayEnd(day + 2));
  assert.equal(settled.eventDailyRankingResults[R.resultKey(f.run.id, day)].entries[0].score, 6);
  assert.equal(settled.eventDailyRankingResults[R.resultKey(f.run.id, day + 1)].entries[0].score, 4);
  assert.equal(Object.keys(settled.eventDailyRankingResults).length, 2);
  assert.equal(Object.values(settled.profiles).find(p => p.id === f.p().id).greatness, before + 20);
  assert.equal(R.settle(settled, f.events, R.dayEnd(day + 3)), settled);
});
test("undated legacy totals never become today's tickets or pay again; new dated spins are validated", () => {
  const f = fixture();
  lucky.record(f.p(), f.run, "lucky_attempt", 100);
  const previous = structuredClone(f.p().eventAchievements[f.run.id]);
  assert.equal(R.view(f.store, f.p()).total, 0);
  lucky.spin(f.p(), f.events, { category: "coins", amount: 50 }, f.now());
  assert.equal(R.view(f.store, f.p()).mine.score, 1);
  assert.equal(f.p().eventAchievements[f.run.id].values.lucky_attempt, 101);
  assert.deepEqual(f.p().eventAchievements[f.run.id].claimed, previous.claimed);
  lucky.validate(f.p());
  for (const dailySpins of [[], { invalid: 1 }, { [R.dayAt(START)]: -1 }, { [R.dayAt(START)]: 102 }]) {
    const broken = structuredClone(f.p());
    broken.eventAchievements[f.run.id].dailySpins = dailySpins;
    assert.throws(() => lucky.validate(broken), /дневной счёт/);
  }
});
test("installing the top does not pay archived runs retroactively", () => {
  const f = fixture();
  lucky.spin(f.p(), f.events, { category: "coins", amount: 50 }, f.now());
  const old = structuredClone(f.store.data);
  delete old.eventDailyRankingStartedAt;
  const updated = R.settle(old, f.events, f.run.endsAt + 1);
  assert.equal(updated.eventDailyRankingResults, undefined);
  assert.equal(updated.eventDailyRankingStartedAt, f.run.endsAt + 1);
  assert.equal(R.due(updated, f.events, f.run.endsAt + 1), false);
});
test("migration restores only today's consumed tickets from dated receipts and is idempotent", () => {
  const f = fixture(), midnight = R.dayEnd(R.dayAt(START));
  lite.activate(f.p(), f.events.rouletteConfig({}, f.now()), f.now(), f.run.id);
  const act = (action, extra = {}) => roulette.mutate(f.store, f.auth.token, {
    action, rulesVersion: rules.version, requestId: randomUUID(), ...extra,
  }, () => 0);
  act("prepare");
  act("spin-five", { offerId: f.p().roulette.offer.id });
  f.time(midnight + 1);
  act("prepare");
  act("spin", { offerId: f.p().roulette.offer.id });
  const legacy = structuredClone(f.store.data), key = Object.keys(legacy.profiles)[0];
  delete legacy.luckyDailyRankingStartedAt;
  delete legacy.profiles[key].eventAchievements[f.run.id].dailySpins;
  const migrated = R.settle(legacy, f.events, f.now());
  assert.deepEqual(migrated.profiles[key].eventAchievements[f.run.id].dailySpins, { [R.dayAt(f.now())]: 1 });
  assert.equal(migrated.profiles[key].eventAchievements[f.run.id].values.lucky_attempt, 6);
  assert.equal(migrated.profiles[key].greatness, legacy.profiles[key].greatness);
  assert.deepEqual(migrated.profiles[key].wallet, legacy.profiles[key].wallet);
  lucky.validate(migrated.profiles[key]);
  assert.equal(R.settle(migrated, f.events, f.now()), migrated);
});

test("daily payout and receipt survive journal recovery together, including a failed write", async t => {
  const f = fixture();
  lucky.spin(f.p(), f.events, { category: "coins", amount: 50 }, f.now());
  const filePath = require("node:path").join(require("../temp").temporary(t, "lucky-payout"), "profiles.json");
  const { recover } = require("../../src/server/profiles/profile-journal");
  const store = new ProfileStore({ filePath, journal: true, now: f.now });
  try {
    store.events = f.events;
    store.save(structuredClone(f.store.data));
    const before = structuredClone(store.data), id = f.p().id;
    f.time(R.dayEnd(R.dayAt(START)));
    const key = R.resultKey(f.run.id, R.dayAt(START));
    const failure = t.mock.method(store.journal, "commit", () => { throw Error("payout disk failure"); });
    assert.throws(() => store.refreshCompetition(), /payout disk failure/);
    assert.deepEqual(store.data, before);
    assert.equal(recover(filePath).data.eventDailyRankingResults?.[key], undefined);
    failure.mock.restore();
    store.refreshCompetition();
    const saved = recover(filePath).data;
    const winner = Object.values(saved.profiles).find(p => p.id === id);
    assert.equal(saved.luckyRankingStartedAt, before.luckyRankingStartedAt);
    assert.equal(winner.greatness, f.p().greatness + 10);
    assert.equal(winner.wallet.bucks, f.p().wallet.bucks + 10);
    assert.equal(saved.eventDailyRankingResults[key].entries[0].reward.greatness, 10);
  } finally { await store.close(); }
  const restored = new ProfileStore({ filePath, journal: true, now: f.now });
  try {
    restored.events = f.events;
    const before = structuredClone(restored.byId(f.p().id));
    restored.refreshCompetition();
    assert.equal(restored.byId(f.p().id).greatness, before.greatness);
    assert.deepEqual(restored.byId(f.p().id).wallet, before.wallet);
    assert.equal(R.due(restored.data, f.events, f.now()), false);
  } finally { await restored.close(); }
});
