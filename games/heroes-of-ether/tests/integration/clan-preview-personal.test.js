"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const { once } = require("node:events"), { randomUUID } = require("node:crypto");
const fixture = require("../clan-preview-fixture.cjs");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { temporary } = require("../temp");
test("Чужой клан: публичный состав и битва, без прав и приватных данных", async (t) => {
  const f = fixture(), { profiles, clans, outsider, own } = f;
  const app = createGameServer({ profiles, arena: new Arena({ etherCount: 0 }), autoTick: false, testBots: { enabled: false } });
  app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const headers = { Cookie: "sferorumiya_session=" + outsider.token };
  const response = await fetch(url + "/api/clans/view?clanId=" + own, { headers });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.clan.id, own); assert.equal(result.clan.members.length, 10);
  assert.equal(result.competition.battle.opponent.id, f.opponent);
  for (const key of ["treasury", "permissions", "applications", "applicationFees", "memberHistory"])
    assert.equal(Object.hasOwn(result.clan, key), false, key);
  for (const member of result.clan.members)
    for (const key of ["wallet", "inventory", "personal", "receipts", "canKick", "canTransfer", "assignableRoles"])
      assert.equal(Object.hasOwn(member, key), false, key);
  assert.equal(result.competition.personal, undefined);
  assert.equal((await fetch(url + "/api/clans/chat?clanId=" + own, { headers })).status, 403);
  for (const action of ["kick", "role", "transfer"])
    assert.throws(() => f.act(outsider, action, { clanId: own, memberId: f.member.profile.id, role: "manager" }));
  assert.equal((await fetch(url + "/api/clans/view?clanId=" + own)).status, 401);
  for (const id of ["missing", "__proto__", "constructor"])
    assert.equal((await fetch(url + "/api/clans/view?clanId=" + id, { headers })).status, 404);
  const before = structuredClone(profiles.data);
  clans.preview(outsider.token, own); clans.preview(outsider.token, f.opponent);
  assert.deepEqual(profiles.data, before, "read-only projection");
  const historyHeaders = { Cookie: "sferorumiya_session=" + f.heads[0].token };
  const history = await (await fetch(url + "/api/clans/chat?clanId=" + own, { headers: historyHeaders })).json();
  const role = history.memberHistory.entries.find(r => r.action === "role");
  assert.equal(role.actor.gender, "female"); assert.equal(role.target.gender, "female");
  profiles.find(f.heads[0].token).personal.gender = "male";
  const changed = await (await fetch(url + "/api/clans/chat?clanId=" + own, { headers: historyHeaders })).json();
  assert.equal(changed.memberHistory.entries.find(r => r.action === "role").actor.gender, "male");
  assert.equal(profiles.data.clans[own].memberHistory.find(r => r.action === "role").actor.gender, undefined);
});
test("Первый вход: явное сохранение даже прежнего ника завершает регистрацию один раз", (t) => {
  const filePath = path.join(temporary(t, "personal-intro"), "profiles.json");
  const p = new ProfileStore({ filePath }), u = p.open();
  assert.equal(u.profile.personal.introPending, true);
  const raw = p.find(u.token), wallet = { ...raw.wallet };
  p.setPersonal(u.token, { name: raw.name, expectedName: raw.name, gender: "unspecified", vkUrl: "", requestId: randomUUID() });
  const restored = new ProfileStore({ filePath });
  assert.equal(restored.open(u.token).profile.personal.introPending, false);
  assert.equal(restored.open(u.token).profile.personal.renameCost, 10);
  assert.ok(restored.find(u.token).personal.firstNameSetAt);
  assert.deepEqual(restored.find(u.token).wallet, wallet);
  delete restored.find(u.token).personal;
  assert.equal(restored.view(restored.find(u.token)).personal.introPending, false, "legacy profile is not new");
});
test("Чужой клан: все накопленные медали и кубки, без смешивания с наградами зрителя", () => {
  const f = fixture(), clan = f.profiles.data.clans[f.opponent];
  const trophies = [
    { seasonId: "2025-4", number: 4, league: 1, awardedAt: Date.parse("2025-12-31T18:00:00Z"), year: 2025 },
    { seasonId: "2026-1", number: 1, league: 1, awardedAt: Date.parse("2026-03-31T18:00:00Z"), year: 2026 },
    { seasonId: "2026-2", number: 2, league: 5, awardedAt: Date.parse("2026-06-30T18:00:00Z"), year: 2026 },
  ];
  clan.competition.medals = { bronze: 3, silver: 2, champions: 1 };
  clan.competition.trophies = structuredClone(trophies);
  const before = structuredClone(f.profiles.data);
  const result = f.clans.preview(f.heads[0].token, f.opponent).competition;
  assert.deepEqual(result.medals, clan.competition.medals);
  assert.deepEqual(result.trophies, trophies);
  assert.equal(result.personal, undefined);
  assert.equal(result.trophyBenefits, undefined);
  result.medals.bronze = 99;
  result.trophies[0].league = 5;
  assert.deepEqual(f.profiles.data, before, "projection does not change history");
  const own = f.clans.preview(f.heads[0].token, f.own).competition;
  assert.deepEqual(own.medals, {});
  assert.deepEqual(own.trophies, []);
  // The same all-time history is public outside the battle season, in quest mode.
  f.profiles.data.clanQuests = { version: 1, revision: 0, nextAt: f.at + 3600000, seasons: [] };
  const quests = f.clans.preview(f.heads[0].token, f.opponent).competition;
  assert.equal(quests.mode, "quests");
  assert.deepEqual(quests.medals, clan.competition.medals);
  assert.deepEqual(quests.trophies, trophies);
});
