"use strict";
// Explicit offline maintenance only. Never imported by login, the arena, or a timer.
const assert = require("node:assert/strict");
const { MARKER, assignBotGender } = require("./bot-identity");
const { CLAN_RULES, validateWorld } = require("../clans/clan-service");
const history = require("../clans/member-history");
const { REVISION } = require("../profiles/profile-journal");
const system = { id: "system:bot-membership-repair", name: "Система" };

function prepare(data, at) {
  assert(Number.isSafeInteger(at) && at >= 0);
  validateWorld(data);
  const next = structuredClone(data), profiles = Object.values(next.profiles), byId = new Map(profiles.map(p => [p.id, p]));
  const departing = new Set(profiles.filter(p => p.testBot === MARKER && p.clanId && p.level < CLAN_RULES.minLevel).map(p => p.id));
  const changedClans = new Set(), changes = [];
  for (const p of profiles) {
    if (p.testBot !== MARKER) continue;
    const beforeGender = p.personal.gender, assignedGender = assignBotGender(p), clanId = p.clanId;
    if (departing.has(p.id)) {
      const clan = next.clans[clanId];
      assert(clan?.members.includes(p.id), "Inconsistent bot membership");
      if (clan.ownerId === p.id) {
        const successors = clan.members.filter(id => !departing.has(id) && byId.get(id)?.level >= CLAN_RULES.minLevel);
        successors.sort((a,b) => Number(byId.get(b).testBot === MARKER)-Number(byId.get(a).testBot === MARKER) ||
          ({manager:2,officer:1}[clan.roles[b]] || 0)-({manager:2,officer:1}[clan.roles[a]] || 0) || a.localeCompare(b));
        assert(successors.length, "Cannot remove a clan head without an eligible successor");
        const target = byId.get(successors[0]), fromRole = clan.roles[target.id] || "member";
        clan.ownerId = target.id; clan.roles[target.id] = "head";
        history.append(clan, "transfer", system, target, at, fromRole, "head");
      }
      history.append(clan, "kicked", system, p, at, clan.roles[p.id] || "member", null);
      clan.members = clan.members.filter(id => id !== p.id); delete clan.roles[p.id];
      if (clan.competition) {
        delete clan.competition.joined?.[p.id]; delete clan.competition.recruits?.[p.id];
      }
      const board = clan.dailyQuests?.board;
      if (board && !board.settledAt) delete board.eligible[p.id];
      p.clanId = null;
      // Same membership fields as an ordinary leave, without running unrelated
      // calendar payouts during an offline data correction.
      p.activity.clanId = null; p.activity.clanSince = null;
      p.activity.values.resident = 0;
      if (p.activity.stageSpent) p.activity.stageSpent.resident = 0;
      if (p.progress.session) p.progress.session.activityClan = null;
      changedClans.add(clanId);
    }
    if (assignedGender || departing.has(p.id)) {
      p.revision++;
      changes.push({ id: p.id, name: p.name, level: p.level, genderBefore: beforeGender, gender: p.personal.gender,
        assignedGender, leftClan: departing.has(p.id) ? clanId : null });
    }
  }
  validateWorld(next);
  assertOnlyRepair(data, next);
  return { data: next, changes, summary: { assignedGenders: changes.filter(p => p.assignedGender).length,
    removedUnderlevelMembers: departing.size, affectedClans: changedClans.size } };
}

function assertOnlyRepair(before, after) {
  const copy = structuredClone(after), affected = new Set();
  for (const [key,p] of Object.entries(before.profiles)) {
    const q = copy.profiles[key];
    if (p.testBot !== MARKER) { assert.deepEqual(q,p,"Human profiles must not change"); continue; }
    const left = p.clanId && p.level < CLAN_RULES.minLevel;
    assert(["male","female"].includes(q.personal.gender));
    assert.equal(q.testIdentityVersion,1);
    const changed = p.testIdentityVersion !== q.testIdentityVersion || p.personal.gender !== q.personal.gender || left;
    assert.equal(q.revision,p.revision+Number(!!changed));
    q.personal.gender=p.personal.gender; q.revision=p.revision;
    if (p.testIdentityVersion === undefined) delete q.testIdentityVersion; else q.testIdentityVersion=p.testIdentityVersion;
    if (left) {
      assert.equal(q.clanId,null); affected.add(p.clanId); q.clanId=p.clanId;
      q.activity.clanId=p.activity.clanId; q.activity.clanSince=p.activity.clanSince;
      q.activity.values.resident=p.activity.values.resident;
      if (q.activity.stageSpent) q.activity.stageSpent.resident=p.activity.stageSpent.resident;
      if (q.progress.session) q.progress.session.activityClan=p.progress.session.activityClan;
    }
  }
  for (const id of affected) {
    const p=before.clans[id],q=copy.clans[id];
    for (const field of ["members","roles","ownerId","memberHistory"]) {
      if (p[field] === undefined) delete q[field]; else q[field]=structuredClone(p[field]);
    }
    if (p.competition) {
      q.competition.joined=structuredClone(p.competition.joined);
      q.competition.recruits=structuredClone(p.competition.recruits);
    }
    if (p.dailyQuests?.board && !p.dailyQuests.board.settledAt)
      q.dailyQuests.board.eligible=structuredClone(p.dailyQuests.board.eligible);
  }
  if (Object.hasOwn(before,REVISION)) copy[REVISION]=before[REVISION]; else delete copy[REVISION];
  assert.deepEqual(copy,before,"Only bot gender, membership metadata and corresponding clan membership may change");
}
module.exports = { prepare, assertOnlyRepair };
