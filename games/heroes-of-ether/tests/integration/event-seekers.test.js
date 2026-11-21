"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  E = require("../../src/server/events/easter-hunt"),
  R = require("../../src/server/rankings/event-leaderboards");
const START = Date.UTC(2026, 9, 28, 10),
  HOUR = 3600000;
function fixture() {
  let time = START;
  const events = new EventManager({ now: () => time }),
    store = new ProfileStore({ now: () => time });
  store.events = events;
  events.apply("test", "start", { eventId: "easter-hunt", revision: 0, requestId: randomUUID() });
  const run = events.data.runs[0],
    auth = store.open(),
    p = () => store.find(auth.token);
  p().wallet.bucks = 1000;
  const act = (input = {}) =>
    E.mutate(store, auth.token, {
      action: "multiplier",
      runId: run.id,
      requestId: randomUUID(),
      ...input,
    });
  let sequence = 0;
  const progress = (type, fields = {}, batchId) =>
    store.applyArenaProgress(
      batchId || "seekers-" + sequence++,
      [{ type, profileId: p().id, ...fields }],
      time,
    );
  return {
    events,
    store,
    run,
    auth,
    p,
    act,
    progress,
    setTime: (at) => (time = at),
    now: () => time,
  };
}
test("paid x3: atomic purchase, retry, no stacking, failed write, insufficient funds and expiry", () => {
  const f = fixture(),
    requestId = randomUUID(),
    before = structuredClone(f.store.data),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => f.act({ requestId }), /disk failure/);
  assert.deepEqual(f.store.data, before);
  f.store.save = save;
  f.act({ requestId });
  assert.equal(f.p().wallet.bucks, 750);
  assert.equal(f.p().easter.runs[f.run.id].multiplierExpiresAt, START + 3 * HOUR);
  assert.equal(f.act({ requestId }).replay, true);
  f.act();
  assert.equal(f.p().wallet.bucks, 750);
  f.progress("lifeStarted", { lifeId: "life" });
  f.progress("easterPickup", { runId: f.run.id, lifeId: "life", eggType: 0 }, "pickup");
  f.progress("easterPickup", { runId: f.run.id, lifeId: "life", eggType: 0 }, "pickup");
  let s = f.p().easter.runs[f.run.id];
  assert.deepEqual(s.eggs, [1, 0, 0, 0]);
  assert.deepEqual(s.found, [1, 0, 0, 0]);
  assert.deepEqual(s.life.eggs, [1, 0, 0, 0]);
  assert.equal(s.bonusEggs, undefined);
  assert.deepEqual(s.life.pendingBonusEggs, [2, 0, 0, 0]);
  f.setTime(START + 3 * HOUR);
  f.progress("easterPickup", { runId: f.run.id, lifeId: "life", eggType: 1 });
  assert.deepEqual(f.p().easter.runs[f.run.id].eggs, [1, 1, 0, 0]);
  f.progress("lifeEnded", { lifeId: "life", reason: "left", durationSeconds: 10800 });
  assert.deepEqual(f.p().easter.runs[f.run.id].eggs, [3, 1, 0, 0]);
  assert.deepEqual(
    f.p().progress.lastLife.eventItems.map((x) => x.count),
    [3, 1, 0, 0],
  );
  f.p().wallet.bucks = 249;
  assert.throws(() => f.act(), /250 эфира/);
  assert.equal(f.p().wallet.bucks, 249);
  f.p().wallet.bucks = 250;
  f.act();
  assert.equal(f.p().wallet.bucks, 0);
  f.setTime(f.run.endsAt);
  assert.throws(() => f.act(), /завершён/);
});
test("actual pickups only, all four kinds, summaries survive event end and reset on another life", () => {
  const f = fixture();
  f.act();
  f.progress("lifeStarted", { lifeId: "one" });
  for (let eggType = 0; eggType < 4; eggType++)
    f.progress("easterPickup", { runId: f.run.id, lifeId: "one", eggType });
  const s = f.p().easter.runs[f.run.id];
  s.exchangedEggs = [1000, 1000, 1000, 1000];
  s.eggs = s.eggs.map((n) => n + 1000);
  assert.equal(R.view(f.store, f.p()).mine.score, 4);
  f.setTime(f.run.endsAt + 1);
  f.progress("lifeEnded", { lifeId: "one", reason: "left", durationSeconds: 60 });
  const items = f.p().progress.lastLife.eventItems;
  assert.deepEqual(
    items.map((i) => i.count),
    [3, 3, 3, 3],
  );
  assert.equal(new Set(items.map((i) => i.itemId)).size, 4);
  assert.ok(items.every((i) => i.image.startsWith("assets/events/easter-hunt/")));
  f.progress("lifeStarted", { lifeId: "two" });
  f.progress("lifeEnded", { lifeId: "two", reason: "burned", durationSeconds: 0 });
  assert.deepEqual(f.p().progress.lastLife.eventItems, []);
  E.validate(f.p());
});

test("exit bonus is atomic, settles once after expiry, and recovered disconnect keeps its entitlement", (t) => {
  const f = fixture(),
    { temporary } = require("../temp");
  f.act();
  f.progress("lifeStarted", { lifeId: "disconnect" });
  f.progress("easterPickup", { lifeId: "disconnect", runId: f.run.id, eggType: 2 });
  const filePath = path.join(temporary(t, "exit-bonus"), "profiles.json");
  f.store.filePath = filePath;
  f.store.save(f.store.data);
  const before = structuredClone(f.store.data),
    save = f.store.save;
  f.store.save = () => {
    throw Error("exit write failed");
  };
  assert.throws(
    () =>
      f.progress(
        "lifeEnded",
        { lifeId: "disconnect", reason: "left", durationSeconds: 2 },
        "exit-bonus",
      ),
    /exit write failed/,
  );
  assert.deepEqual(f.store.data, before);
  f.store.save = save;
  f.setTime(START + 4 * HOUR);
  const restored = new ProfileStore({ filePath, now: f.now });
  restored.events = f.events;
  const p = restored.find(f.auth.token);
  assert.equal(p.progress.session, null);
  assert.deepEqual(p.easter.runs[f.run.id].eggs, [0, 0, 3, 0]);
  assert.deepEqual(
    p.progress.lastLife.eventItems.map((x) => x.count),
    [0, 0, 3, 0],
  );
  restored.save(restored.data);
  const reloaded = new ProfileStore({ filePath, now: f.now });
  reloaded.events = f.events;
  reloaded.applyArenaProgress(
    "exit-retry",
    [
      {
        profileId: p.id,
        type: "lifeEnded",
        lifeId: "disconnect",
        durationSeconds: 2,
        reason: "left",
      },
    ],
    f.now(),
  );
  assert.deepEqual(reloaded.find(f.auth.token).easter.runs[f.run.id].eggs, [0, 0, 3, 0]);
  assert.deepEqual(reloaded.find(f.auth.token).easter.runs[f.run.id].found, [0, 0, 1, 0]);
  E.validate(reloaded.find(f.auth.token));
});

test("kill exit grants pending bonus; later life and old immediate bonuses are not multiplied again", () => {
  const f = fixture();
  f.act();
  f.progress("lifeStarted", { lifeId: "old" });
  f.progress("easterPickup", { lifeId: "old", runId: f.run.id, eggType: 0 });
  const s = f.p().easter.runs[f.run.id];
  // A balance from the previous release was already tripled at pickup.
  s.eggs[0] = 3;
  s.bonusEggs = [2, 0, 0, 0];
  s.life.eggs[0] = 3;
  delete s.life.pendingBonusEggs;
  f.progress("lifeEnded", { lifeId: "old", reason: "eaten", durationSeconds: 1 });
  assert.deepEqual(f.p().easter.runs[f.run.id].eggs, [3, 0, 0, 0]);
  f.progress("lifeStarted", { lifeId: "new" });
  f.progress("easterPickup", { lifeId: "new", runId: f.run.id, eggType: 1 });
  f.progress("lifeEnded", { lifeId: "new", reason: "eaten", durationSeconds: 1 }, "death");
  f.progress("lifeEnded", { lifeId: "new", reason: "eaten", durationSeconds: 1 }, "death");
  assert.deepEqual(f.p().easter.runs[f.run.id].eggs, [3, 3, 0, 0]);
  assert.deepEqual(
    f.p().progress.lastLife.eventItems.map((x) => x.count),
    [0, 3, 0, 0],
  );
  E.validate(f.p());
});
test("event top: prize boundaries, fixed rewards with VIP/Premium, bots excluded and only one payout", () => {
  const f = fixture(),
    ids = [],
    before = new Map();
  for (let index = 0; index < 101; index++) {
    const auth = index === 0 ? f.auth : f.store.open(),
      p = f.store.find(auth.token);
    E.progress(p, f.events, { type: "easterPickup", runId: f.run.id, eggType: 0 }, START);
    p.easter.runs[f.run.id].found[0] = 101 - index;
    p.easter.runs[f.run.id].dailyFound[R.dayAt(START)] = 101 - index;
    p.greatness = 0;
    p.account = {
      ...p.account,
      vipUntil: START + 30 * 86400000,
      premiumUntil: START + 30 * 86400000,
    };
    ids.push(p.id);
    before.set(p.id, { wallet: { ...p.wallet }, tickets: p.roulette.tickets });
  }
  const bot = f.store.find(f.store.open().token);
  bot.testBot = true;
  E.progress(bot, f.events, { type: "easterPickup", runId: f.run.id, eggType: 0 }, START);
  bot.easter.runs[f.run.id].found[0] = 100000;
  bot.easter.runs[f.run.id].dailyFound[R.dayAt(START)] = 100000;
  assert.equal(R.view(f.store, f.p()).total, 101);
  assert.equal(R.view(f.store, f.p(), 999).page, 20);
  f.setTime(R.dayEnd(R.dayAt(START)));
  f.store.refreshCompetition();
  for (const [rank, coins, crystals, bucks, tickets] of [
    [1, 500, 30, 50, 10],
    [5, 500, 30, 50, 10],
    [6, 250, 15, 25, 5],
    [20, 250, 15, 25, 5],
    [21, 150, 10, 10, 3],
    [100, 150, 10, 10, 3],
    [101, 0, 0, 0, 0],
  ]) {
    const p = f.store.byId(ids[rank - 1]),
      old = before.get(p.id);
    assert.equal(p.wallet.coins - old.wallet.coins, coins, "coins rank " + rank);
    assert.equal(p.wallet.crystals - old.wallet.crystals, crystals);
    assert.equal(p.wallet.bucks - old.wallet.bucks, bucks);
    assert.equal(p.roulette.tickets - old.tickets, tickets);
  }
  const once = structuredClone(f.store.data);
  f.store.refreshCompetition();
  f.store.save(f.store.data);
  assert.deepEqual(f.store.data.eventDailyRankingResults, once.eventDailyRankingResults);
  assert.deepEqual(
    f.store.byId(ids[0]).wallet,
    once.profiles[Object.keys(once.profiles)[0]].wallet,
  );
  R.validate(f.store.data);
});
test("settlement retries a disk failure, restores after restart, keeps separate event runs", (t) => {
  const f = fixture(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "seekers-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "profiles.json");
  f.progress("lifeStarted", { lifeId: "durable" });
  f.progress("easterPickup", { runId: f.run.id, lifeId: "durable", eggType: 2 });
  f.progress("lifeEnded", { lifeId: "durable", durationSeconds: 1, reason: "left" });
  f.store.filePath = filePath;
  f.store.save(f.store.data);
  const before = structuredClone(f.store.data),
    rename = fs.renameSync;
  f.setTime(f.run.endsAt + HOUR);
  fs.renameSync = () => {
    throw Error("rename failure");
  };
  try {
    assert.throws(() => f.store.refreshCompetition(), /rename failure/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(f.store.data, before);
  const restored = new ProfileStore({ filePath, now: f.now });
  restored.events = f.events;
  restored.refreshCompetition();
  const result = restored.data.eventDailyRankingResults[R.resultKey(f.run.id, R.dayAt(START))];
  assert.equal(result.entries[0].reward.bucks, 50);
  const wallet = { ...restored.byId(f.p().id).wallet };
  const again = new ProfileStore({ filePath, now: f.now });
  again.events = f.events;
  again.refreshCompetition();
  assert.deepEqual(again.byId(f.p().id).wallet, wallet);
  f.events.apply("test", "start", {
    eventId: "easter-hunt",
    revision: f.events.data.revision,
    requestId: randomUUID(),
  });
  const nextRun = f.events.data.runs.at(-1);
  assert.notEqual(nextRun.id, f.run.id);
  assert.equal(R.view(again, again.byId(f.p().id)).mine, null);
  assert.equal(E.view(again.byId(f.p().id), f.events, f.now()).multiplier.active, false);
});
test("uncommitted pickups delay settlement; pre-install history pay nothing", () => {
  const f = fixture();
  f.progress("easterPickup", { runId: f.run.id, eggType: 0 });
  f.store.eventRankingReady = () => false;
  f.setTime(f.run.endsAt);
  f.store.save(f.store.data);
  assert.equal(f.store.data.eventDailyRankingResults, undefined);
  f.store.eventRankingReady = () => true;
  f.store.refreshCompetition();
  assert.ok(f.store.data.eventDailyRankingResults[R.resultKey(f.run.id, R.dayAt(START))]);
  const fresh = new ProfileStore({ now: f.now });
  fresh.events = f.events;
  fresh.refreshCompetition();
  assert.equal(fresh.data.eventDailyRankingResults, undefined);
});
test("HTTP multiplier: authenticated lobby only, authoritative price and concurrent retries", async (t) => {
  const f = fixture(),
    { createGameServer } = require("../../src/server/game-server"),
    { once } = require("node:events");
  const app = createGameServer({
    profiles: f.store,
    events: f.events,
    autoTick: false,
    testBots: { enabled: false },
    wallNow: f.now,
  });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  const requestId = randomUUID(),
    body = { action: "multiplier", runId: f.run.id, requestId, price: 0, multiplier: 999 };
  const post = (value, cookie = "sferorumiya_session=" + f.auth.token) =>
    fetch(url + "/api/easter/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(value),
    });
  assert.equal((await post(body, "")).status, 401);
  const responses = await Promise.all([post(body), post(body)]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const data = await Promise.all(responses.map((r) => r.json()));
  assert.equal(data.filter((d) => d.replay).length, 1);
  assert.equal(f.p().wallet.bucks, 750);
  assert.equal(f.p().easter.runs[f.run.id].multiplierExpiresAt, START + 3 * HOUR);
  assert.equal((await post({ ...body, runId: "forged", requestId: randomUUID() })).status, 409);
  const unknown = await post({ ...body, action: "give-eggs", requestId: randomUUID() });
  assert.equal(unknown.status, 400);
});
test("ties are deterministic; cancelling a future event never creates a reward", () => {
  const f = fixture(),
    other = f.store.find(f.store.open().token);
  for (const p of [f.p(), other])
    E.progress(p, f.events, { type: "easterPickup", runId: f.run.id, eggType: 0 }, START);
  assert.deepEqual(
    R.leaders(f.store.data, f.run, R.dayAt(START)).map((r) => r.id),
    [f.p().id, other.id].sort((a, b) => a.localeCompare(b)),
  );
  const cancelled = structuredClone(f.run);
  cancelled.id = "cancelled-future";
  cancelled.startsAt = f.run.endsAt + HOUR;
  cancelled.endsAt = cancelled.startsAt + HOUR;
  cancelled.stoppedAt = f.run.endsAt;
  f.events.data.runs.push(cancelled);
  f.setTime(cancelled.endsAt + 1);
  f.store.refreshCompetition();
  assert.equal(f.store.data.eventDailyRankingResults[cancelled.id], undefined);
});

test("daily seekers reset at Moscow midnight; same life and x3 give one score per pickup each day", () => {
  const f = fixture(),
    day = R.dayAt(START),
    midnight = R.dayEnd(day);
  f.setTime(midnight - 60000);
  f.act();
  f.progress("lifeStarted", { lifeId: "across-midnight" });
  f.setTime(midnight - 1);
  f.progress(
    "easterPickup",
    { lifeId: "across-midnight", runId: f.run.id, eggType: 0 },
    "before-midnight",
  );
  assert.equal(R.view(f.store, f.p()).mine.score, 1);
  const bucks = f.p().wallet.bucks;
  f.setTime(midnight);
  f.store.refreshCompetition();
  assert.equal(f.p().wallet.bucks, bucks + 50);
  assert.equal(R.view(f.store, f.p()).mine, null);
  assert.equal(R.view(f.store, f.p()).day, day + 1);
  f.progress("easterPickup", { lifeId: "across-midnight", runId: f.run.id, eggType: 1 });
  assert.equal(R.view(f.store, f.p()).mine.score, 1);
  assert.deepEqual(f.p().easter.runs[f.run.id].life.eggs, [1, 1, 0, 0]);
  f.setTime(midnight + 86400000);
  f.store.refreshCompetition();
  assert.equal(f.p().wallet.bucks, bucks + 100);
  assert.equal(Object.keys(f.store.data.eventDailyRankingResults).length, 2);
  assert.equal(R.view(f.store, f.p()).mine, null);
});

test("last event day pays at midnight; pending pre-midnight pickup is included before payout", () => {
  const f = fixture(),
    day = R.dayAt(START),
    midnight = R.dayEnd(day);
  f.run.stoppedAt = START + HOUR;
  f.progress("easterPickup", { runId: f.run.id, eggType: 0 });
  f.setTime(START + HOUR);
  f.store.refreshCompetition();
  assert.equal(f.store.data.eventDailyRankingResults, undefined);
  f.store.eventRankingReady = () => false;
  f.setTime(midnight);
  f.store.applyArenaProgress(
    "late-pickup",
    [{ type: "easterPickup", profileId: f.p().id, runId: f.run.id, eggType: 1 }],
    START + HOUR - 1,
  );
  assert.equal(f.store.data.eventDailyRankingResults, undefined);
  f.store.eventRankingReady = () => true;
  f.store.refreshCompetition();
  assert.equal(R.view(f.store, f.p()), null, "ended event is not available in the top tab");
  const result = f.store.data.eventDailyRankingResults[R.resultKey(f.run.id, day)];
  const mine = result.entries.find((e) => e.id === f.p().id);
  assert.equal(result.settledAt, midnight);
  assert.equal(mine.score, 2);
  assert.equal(mine.reward.bucks, 50);
});

test("old undated totals do not become today's score; multiple overdue days settle once after downtime", () => {
  const f = fixture(),
    day = R.dayAt(START);
  f.progress("easterPickup", { runId: f.run.id, eggType: 0 });
  const state = f.p().easter.runs[f.run.id];
  state.found = [100, 200, 300, 400];
  delete state.dailyFound;
  assert.equal(R.view(f.store, f.p()).mine, null);
  for (let d = 0; d < 3; d++) {
    E.progress(
      f.p(),
      f.events,
      { type: "easterPickup", runId: f.run.id, eggType: d },
      START + d * 86400000,
    );
  }
  const bucks = f.p().wallet.bucks;
  f.setTime(R.dayEnd(day + 2));
  f.store.refreshCompetition();
  assert.equal(f.p().wallet.bucks, bucks + 150);
  assert.equal(Object.keys(f.store.data.eventDailyRankingResults).length, 3);
  f.store.refreshCompetition();
  assert.equal(f.p().wallet.bucks, bucks + 150);
  E.validate(f.p());
  R.validate(f.store.data);
});
