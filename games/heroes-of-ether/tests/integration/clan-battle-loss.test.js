"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const { createGameServer } = require("../../src/server/game-server");
const { xpForLevel } = require("../../src/server/progression/experience-progression");

test("Штраф за битву: отказ записи откатывает итоги, потеря ответа и перезапуск не повторяют списание", async (t) => {
  let at = Date.parse("2026-10-19T04:59:00Z");
  const filePath = path.join(temporary(t, "battle-loss"), "profiles.json");
  const profiles = new ProfileStore({ filePath, now: () => at }),
    clans = new ClanService(profiles),
    heads = [];
  for (let i = 0; i < 10; i++) {
    const user = profiles.open(),
      p = profiles.find(user.token);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 10000;
    clans.mutate(user.token, {
      action: "create",
      requestId: randomUUID(),
      name: "Проверка " + i,
      prefix: "L" + i,
      emblem: "astral",
      privacy: "open",
    });
    heads.push(user);
  }
  for (const c of Object.values(profiles.data.clans)) {
    for (let i=1;i<10;i++) {
      const u=profiles.open(), p=profiles.find(u.token);
      p.level=12; p.progress.xp=xpForLevel(12); p.wallet.coins=100;
      clans.mutate(u.token,{action:"apply",clanId:c.id,requestId:randomUUID()});
    }
  }
  at = Date.parse("2026-10-19T05:00:00Z");
  profiles.refreshCompetition();
  const pair = profiles.data.competition.day.pairs[0];
  const loser = heads.find((u) => profiles.find(u.token).clanId === pair.a);
  const winner = heads.find((u) => profiles.find(u.token).clanId === pair.b);
  profiles.find(loser.token).greatness = 20;
  const winProfile = profiles.find(winner.token);
  profiles.startLife(winProfile.id, randomUUID());
  profiles.applyArenaProgress(
    randomUUID(),
    [{ type: "absorbed", profileId: winProfile.id, victimProfileId: randomUUID(), gain: 1 }],
    at,
  );
  // Both clans participated, but the winner has two kills. Settlement must
  // atomically apply the loss penalty and the fixed reward to the loser.
  const day = profiles.data.competition.day;
  day.scores[pair.b].kills = 2;
  day.scores[pair.a] = {
    kills: 1,
    members: {
      [loser.profile.id]: {
        kills: 1,
        joinedAt: profiles.data.clans[pair.a].competition.joined[loser.profile.id] || 0,
      },
    },
  };
  const loserWallet = structuredClone(profiles.find(loser.token).wallet);
  const before = structuredClone(profiles.data),
    diskBefore = fs.readFileSync(filePath, "utf8");
  const app = createGameServer({ profiles, clans, autoTick: false, wallNow: () => at });
  await new Promise((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  const options = { headers: { Cookie: "sferorumiya_session=" + loser.token } };
  const originalRename = fs.renameSync;
  let failWrite = true;
  const writer = t.mock.method(fs, "renameSync", (from, to) => {
    if (failWrite && to === filePath)
      throw Object.assign(new Error("test: disk full"), { code: "ENOSPC" });
    return originalRename(from, to);
  });
  at = Date.parse("2026-10-19T21:00:00Z");
  const failed = await fetch(url + "/api/profile", options);
  assert.equal(failed.status, 500);
  await failed.json();
  assert.deepEqual(profiles.data, before);
  assert.equal(fs.readFileSync(filePath, "utf8"), diskBefore);
  failWrite = false;
  // Drop the response after the server commits: the reconnect must not repeat settlement.
  const dropResponse = (req, res) => {
    if (req.url !== "/api/profile") return;
    app.httpServer.off("request", dropResponse);
    res.end = function () {
      this.destroy();
      return this;
    };
  };
  app.httpServer.prependListener("request", dropResponse);
  await assert.rejects(fetch(url + "/api/profile", options));
  assert.equal(profiles.find(loser.token).greatness, 15);
  assert.deepEqual(profiles.find(loser.token).wallet, {
    coins: loserWallet.coins + 100,
    crystals: loserWallet.crystals + 10,
    bucks: loserWallet.bucks,
  });
  const revision = profiles.find(loser.token).revision;
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url + "/api/profile", options);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.greatness, 15);
    assert.equal(profiles.find(loser.token).revision, revision);
  }
  writer.mock.restore();
  await app.close();
  const restored = new ProfileStore({ filePath, now: () => at });
  restored.refreshCompetition();
  assert.equal(restored.find(loser.token).greatness, 15);
  assert.deepEqual(restored.find(loser.token).wallet, profiles.find(loser.token).wallet);
  assert.equal(restored.data.competition.day, null);
  assert.equal(restored.data.clans[pair.b].competition.wins, 1);
  assert.deepEqual(
    restored.find(loser.token).honors,
    Object.values(before.profiles).find((p) => p.id === loser.profile.id).honors,
  );
});
