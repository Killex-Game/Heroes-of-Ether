"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { setup } = require("../fixtures/season-trophies"),
  { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server");
test("Достижения кубков: отказ записи, потеря HTTP-ответа, повтор и восстановление не удваивают величие", async (t) => {
  const filePath = path.join(temporary(t, "league-cup-atomic"), "profiles.json"),
    f = setup({ filePath }),
    u = f.heads[0],
    offline = f.user();
  f.act(offline, "apply", { clanId: f.c(u).id });
  f.c(u).competition.league = 5;
  f.profiles.save(f.profiles.data);
  const before = structuredClone(f.profiles.data),
    disk = fs.readFileSync(filePath, "utf8");
  const app = createGameServer({
    profiles: f.profiles,
    clans: f.clans,
    autoTick: false,
    wallNow: f.now,
  });
  await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    options = { headers: { Cookie: "sferorumiya_session=" + u.token } };
  const rename = fs.renameSync;
  let fail = true;
  const writer = t.mock.method(fs, "renameSync", (from, to) => {
    if (fail && to === filePath) throw Object.assign(Error("test disk full"), { code: "ENOSPC" });
    return rename(from, to);
  });
  f.time(f.profiles.data.competition.season.end);
  const failed = await fetch(url + "/api/profile", options);
  assert.equal(failed.status, 500);
  await failed.text();
  assert.deepEqual(f.profiles.data, before);
  assert.equal(fs.readFileSync(filePath, "utf8"), disk);
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
  const committed = structuredClone(f.profiles.data);
  for (const who of [u, offline]) {
    const p = f.p(who);
    assert.equal(p.activity.claimed.cup_keeper, 1);
    assert.equal(p.activity.claimed.champion_dynasty, 1);
    assert.equal(p.activity.values.champion_dynasty, 1);
    assert.equal(p.activity.stageSpent.champion_dynasty, 1);
  }
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url + "/api/profile", options);
    assert.equal(r.status, 200);
    await r.json();
  }
  assert.deepEqual(f.profiles.data, committed);
  writer.mock.restore();
  await app.close();
  const restored = new ProfileStore({ filePath, now: f.now });
  restored.refreshCompetition();
  for (const who of [u, offline]) {
    assert.equal(restored.find(who.token).greatness, f.p(who).greatness);
    assert.deepEqual(restored.find(who.token).activity, f.p(who).activity);
  }
});
test("Достижения лиг: переполнение величия откатывает кубок, кошельки и все степени", () => {
  const f = setup(),
    u = f.heads[0],
    idle = f.user();
  f.act(idle, "apply", { clanId: f.c(u).id });
  f.c(u).competition.league = 5;
  f.profiles.save(f.profiles.data);
  f.p(idle).greatness = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(f.profiles.data);
  f.time(f.profiles.data.competition.season.end);
  assert.throws(() => f.profiles.refreshCompetition(), /счётчик|Превышен/);
  assert.deepEqual(f.profiles.data, before);
});
