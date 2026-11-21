"use strict";
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../src/server/profiles/profile-store");
const { ClanService } = require("../src/server/clans/clan-service");
const { xpForLevel } = require("../src/server/progression/experience-progression");
module.exports = function fixture({ previewRoles = false } = {}) {
  let at = Date.parse("2026-11-09T04:59:00Z");
  const profiles = new ProfileStore({ now: () => at }), clans = new ClanService(profiles);
  const user = (name, gender = "unspecified") => {
    const u = profiles.open(), p = profiles.find(u.token);
    Object.assign(p, { name, level: 12 });
    p.progress.xp = xpForLevel(12); p.wallet.coins = 10000;
    Object.assign(p.personal, { introPending: false, gender });
    return u;
  };
  const act = (u, action, extra = {}) => clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
  const heads = [];
  for (let i = 0; i < 10; i++) {
    const u = user("Глава " + i, i === 0 ? "female" : "male");
    act(u, "create", { name: "Звёздные стражи " + i, prefix: "V" + i, privacy: "open", emblem: "astral" });
    heads.push(u);
  }
  const own = profiles.find(heads[0].token).clanId;
  const member = user("Участница", "female");
  act(member, "apply", { clanId: own });
  act(heads[0], "role", { clanId: own, memberId: member.profile.id, role: "officer" });
  const unknown = user("Странник"); act(unknown, "apply", { clanId: own });
  if (previewRoles) for (const head of heads.slice(1)) {
    const clanId = profiles.find(head.token).clanId;
    for (const [role, name] of [["manager", "Управляющий"], ["officer", "Офицер"]]) {
      const u = user(name);
      act(u, "apply", { clanId });
      act(head, "role", { clanId, memberId: u.profile.id, role });
    }
  }
  for (const clanId of Object.keys(profiles.data.clans)) {
    while (profiles.data.clans[clanId].members.length < 10) {
      const u = user("Тестовый участник " + profiles.data.clans[clanId].members.length);
      const p = profiles.find(u.token);
      p.clanId = clanId;
      profiles.data.clans[clanId].members.push(p.id);
      profiles.data.clans[clanId].roles[p.id] = "member";
    }
  }
  at = Date.parse("2026-11-09T05:01:00Z"); profiles.refreshCompetition(at);
  const battle = clans.preview(heads[0].token, own).competition.battle;
  const opponent = battle.opponent.id;
  const outsider = user("Гость");
  return { profiles, clans, heads, own, opponent, member, unknown, outsider, act, at };
};
