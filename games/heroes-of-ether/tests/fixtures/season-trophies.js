"use strict";
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
function setup({ filePath = null, count = 1, start = "2026-12-31T20:59:00Z" } = {}) {
  let at = Date.parse(start);
  const profiles = new ProfileStore({ filePath, now: () => at }),
    clans = new ClanService(profiles);
  const user = () => {
    const u = profiles.open(),
      p = profiles.find(u.token);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 100000;
    return u;
  };
  const act = (u, action, extra = {}) =>
    clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
  const heads = Array.from({ length: count }, (_, i) => {
    const u = user();
    act(u, "create", { name: "Сезон " + i, prefix: "S" + i, emblem: "astral", privacy: "open" });
    const clanId = profiles.find(u.token).clanId;
    for (let j = 0; j < 9; j++) {
      const member = user(), p = profiles.find(member.token);
      p.clanId = clanId;
      profiles.data.clans[clanId].members.push(p.id);
      profiles.data.clans[clanId].roles[p.id] = "member";
    }
    return u;
  });
  profiles.save(profiles.data, at);
  return {
    profiles,
    clans,
    heads,
    user,
    act,
    now: () => at,
    time: (value) => {
      at = typeof value === "string" ? Date.parse(value) : value;
    },
    p: (u) => profiles.find(u.token),
    c: (u) => profiles.data.clans[profiles.find(u.token).clanId],
  };
}
function recordBattle(f) {
  const at = Math.max(f.now(), f.profiles.data.competition.season.start + 1);
  for (const clan of Object.values(f.profiles.data.clans))
    require('../../src/server/clans/battle-history').append(clan,
      { id: 'opponent-' + clan.id, name: 'Соперник', prefix: 'TEST' }, 1, 0, at);
}
function setupWithBattle(options) { const f = setup(options); recordBattle(f); return f; }
module.exports = { setup, setupWithBattle, recordBattle };
