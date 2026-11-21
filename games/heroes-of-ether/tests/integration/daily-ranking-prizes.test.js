"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const daily = require("../../src/server/rankings/daily-leaderboards");
const { EventManager } = require("../../src/server/events/event-manager");
test("Суточные призы: отказ диска, потерянный ответ, перезапуск и награждение офлайн", async (t) => {
  let at = Date.parse("2026-10-21T20:59:00Z");
  const filePath = path.join(temporary(t, "daily-prizes"), "profiles.json");
  const profiles = new ProfileStore({ filePath, now: () => at }),
    user = profiles.open(),
    offline = profiles.open();
  for (const [i, u] of [user, offline].entries())
    profiles.transact(u.token, randomUUID(), "seed", (p) => {
      p.daily = { day: daily.dayAt(at), kills: 20 - i, arenaSeconds: 0, greatness: 0 };
      p.account = require("../../src/server/accounts/account-benefits").fresh();
      p.account.vipUntil = at + 86400000;
      p.account.premiumUntil = at + 86400000;
    });
  const before = structuredClone(profiles.data),
    diskBefore = fs.readFileSync(filePath, "utf8"),
    wallet = { ...profiles.find(user.token).wallet };
  const events = new EventManager({ now: () => at });
  events.apply("owner", "start", {
    requestId: randomUUID(),
    revision: events.data.revision,
    eventId: "lucky-week",
  });
  const app = createGameServer({ profiles, events, autoTick: false, wallNow: () => at });
  await new Promise((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    options = { headers: { Cookie: "sferorumiya_session=" + user.token } };
  const rename = fs.renameSync;
  let fail = true;
  const writer = t.mock.method(fs, "renameSync", (from, to) => {
    if (fail && to === filePath) throw Object.assign(Error("test: disk full"), { code: "ENOSPC" });
    return rename(from, to);
  });
  at = Date.parse("2026-10-21T21:00:00Z");
  const failed = await fetch(url + "/api/profile", options);
  assert.equal(failed.status, 500);
  await failed.text();
  assert.deepEqual(profiles.data, before);
  assert.equal(fs.readFileSync(filePath, "utf8"), diskBefore);
  fail = false;
  const drop = (req, res) => {
    if (req.url !== "/api/profile") return;
    app.httpServer.off("request", drop);
    res.end = function () {
      this.destroy();
      return this;
    };
  };
  app.httpServer.prependListener("request", drop);
  await assert.rejects(fetch(url + "/api/profile", options));
  const p = profiles.find(user.token);
  assert.equal(p.wallet.coins, wallet.coins + 100);
  assert.equal(p.wallet.crystals, wallet.crystals + 10);
  assert.equal(p.greatness, 33);
  assert.equal(profiles.find(offline.token).greatness, 32);
  assert.equal(p.roulette.tickets, 3);
  assert.equal(profiles.find(offline.token).roulette.tickets, 2);
  assert.equal(p.dailyRankingRewards[0].prize.tickets, 3);
  assert.equal(p.dailyRankingRewards.length, 1);
  assert.equal(profiles.find(offline.token).dailyRankingRewards.length, 1);
  const committed = structuredClone(profiles.data);
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url + "/api/profile", options);
    assert.equal(r.status, 200);
    await r.json();
  }
  assert.deepEqual(profiles.data, committed);
  writer.mock.restore();
  await app.close();
  const restored = new ProfileStore({ filePath, now: () => at });
  restored.refreshCompetition();
  assert.equal(restored.find(user.token).greatness, 33);
  assert.equal(restored.find(user.token).roulette.tickets, 3);
  assert.equal(restored.find(offline.token).roulette.tickets, 2);
  assert.equal(restored.view(restored.find(user.token)).dailyRankingRewards.length, 1);
  assert.deepEqual(restored.publicPlayer(p.id).regalia, [
    { id: "kills-1", count: 1, firstDay: daily.dayAt(at) - 1, lastDay: daily.dayAt(at) - 1 },
  ]);
  at += 86400000;
  restored.refreshCompetition();
  assert.equal(restored.find(user.token).greatness, 33);
});

test("Прочтение уведомления: сессия, отказ записи, потерянный ответ, повтор и перезапуск", async (t) => {
  let at = Date.parse("2026-10-21T20:59:00Z");
  const filePath = path.join(temporary(t, "daily-notices"), "profiles.json");
  const profiles = new ProfileStore({ filePath, now: () => at });
  const user = profiles.open(),
    offline = profiles.open();
  for (const [i, u] of [user, offline].entries())
    profiles.transact(u.token, randomUUID(), "seed", (p) => {
      p.daily = { day: daily.dayAt(at), kills: 20 - i, arenaSeconds: 0, greatness: 0 };
    });
  at += 60000;
  profiles.refreshCompetition();
  const app = createGameServer({ profiles, autoTick: false, wallNow: () => at });
  await new Promise((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const url =
    "http://127.0.0.1:" +
    app.httpServer.address().port +
    "/api/profile/daily-ranking-rewards/dismiss";
  const input = {
    requestId: randomUUID(),
    ids: profiles.view(profiles.find(user.token)).dailyRankingRewards.map((n) => n.id),
  };
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "sferorumiya_session=" + user.token },
    body: JSON.stringify(input),
  };
  const unauthorized = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(unauthorized.status, 401);
  await unauthorized.text();
  const before = structuredClone(profiles.data),
    diskBefore = fs.readFileSync(filePath, "utf8");
  const rename = fs.renameSync;
  let fail = true;
  const writer = t.mock.method(fs, "renameSync", (from, to) => {
    if (fail && to === filePath) throw Object.assign(Error("test: disk full"), { code: "ENOSPC" });
    return rename(from, to);
  });
  const failed = await fetch(url, options);
  assert.equal(failed.status, 500);
  await failed.text();
  assert.deepEqual(profiles.data, before);
  assert.equal(fs.readFileSync(filePath, "utf8"), diskBefore);
  fail = false;
  const drop = (req, res) => {
    app.httpServer.off("request", drop);
    res.end = function () {
      this.destroy();
      return this;
    };
  };
  app.httpServer.prependListener("request", drop);
  await assert.rejects(fetch(url, options));
  const committed = structuredClone(profiles.data);
  const retry = await fetch(url, options);
  assert.equal(retry.status, 200);
  const result = await retry.json();
  assert.equal(result.replay, true);
  assert.deepEqual(result.profile.dailyRankingRewards, []);
  assert.deepEqual(profiles.data, committed);
  assert.equal(profiles.find(offline.token).dailyRankingRewards.length, 1);
  writer.mock.restore();
  await app.close();
  const restored = new ProfileStore({ filePath, now: () => at });
  assert.deepEqual(restored.view(restored.find(user.token)).dailyRankingRewards, []);
  assert.deepEqual(restored.find(user.token).wallet, profiles.find(user.token).wallet);
});
