"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { setup } = require("../fixtures/season-trophies"),
  { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server");
test("Сезон: атомарный отказ записи, потерянный HTTP-ответ, повтор и восстановление из сохранения", async (t) => {
  const filePath = path.join(temporary(t, "season-trophies"), "profiles.json"),
    f = setup({ filePath }),
    head = f.heads[0],
    offline = f.user();
  f.act(offline, "apply", { clanId: f.c(head).id });
  f.c(head).competition.league = 2;
  f.profiles.save(f.profiles.data);
  const before = structuredClone(f.profiles.data),
    disk = fs.readFileSync(filePath, "utf8"),
    wallet = { ...f.p(head).wallet },
    idleWallet = { ...f.p(offline).wallet };
  const app = createGameServer({
    profiles: f.profiles,
    clans: f.clans,
    autoTick: false,
    wallNow: f.now,
  });
  await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    options = { headers: { Cookie: "sferorumiya_session=" + head.token } };
  const rename = fs.renameSync;
  let fail = true;
  const writer = t.mock.method(fs, "renameSync", (from, to) => {
    if (fail && to === filePath) throw Object.assign(Error("test disk full"), { code: "ENOSPC" });
    return rename(from, to);
  });
  f.time("2026-12-31T21:00:00Z");
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
  for (const [u, w] of [
    [head, wallet],
    [offline, idleWallet],
  ])
    assert.deepEqual(restored.find(u.token).wallet, {
      coins: w.coins + 3500,
      crystals: w.crystals + 350,
      bucks: w.bucks + 500,
    });
  const clan = restored.data.clans[f.c(head).id];
  assert.equal(clan.competition.trophies.length, 1);
  assert.equal(clan.competition.trophies[0].league, 2);
  assert.equal(restored.view(restored.find(offline.token)).seasonBenefits.discount, 6);
  for (const u of [head, offline]) {
    assert.deepEqual(restored.find(u.token).seasonTrophies, clan.competition.trophies);
    const response = restored.publicPlayer(restored.find(u.token).id);
    assert.deepEqual(response.seasonTrophies, clan.competition.trophies);
  }
});
