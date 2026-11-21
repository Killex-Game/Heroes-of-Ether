"use strict";
// Synthetic world only. Never reads or changes the live profiles file.
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { freshProgress } = require("../../src/server/progression/experience-progression");
const competition = require("../../src/server/clans/clan-competition-service");
const { validateWorld } = require("../../src/server/clans/clan-service");
const rules = require("../../public/shared/clan-competition-rules");
const crests = require("../../public/shared/clan-crest-rules");
const MARKER = "mongo-capacity-20261110";

function createFixture(at = Date.now()) {
  const store = new ProfileStore({ now: () => at });
  const tokens = [];
  // Open against a tiny fresh store to avoid benchmarking fixture construction.
  for (let i = 0; i < 1280; i++) {
    const fresh = new ProfileStore({ now: () => at });
    const auth = fresh.open();
    const p = fresh.find(auth.token);
    p.name = `Тест ${String(i + 1).padStart(3, "0")}`;
    p.personal.nameSet = true;
    p.personal.introPending = false;
    p.testFixture = MARKER;
    p.level = 1 + ((i * 137) % 500);
    p.progress = freshProgress(p.level);
    Object.assign(store.data.profiles, fresh.data.profiles);
    tokens.push(auth.token);
  }
  const players = Object.values(store.data.profiles);
  for (let i = 0; i < 128; i++) {
    const members = players.slice(i * 10, i * 10 + 10);
    const id = randomUUID();
    const c = {
      id, name: `Испытатели ${i + 1}`, prefix: `T${String(i + 1).padStart(3, "0")}`,
      description: "Изолированный нагрузочный тест", testSeedKey: MARKER,
      emblem: "grove", privacy: "open",
      crest: { frame: crests.frames[0].id, color: crests.colors[i % crests.colors.length].id,
        symbol: crests.symbols[i % crests.symbols.length].id },
      ownerId: members[0].id, members: members.map(p => p.id),
      roles: Object.fromEntries(members.map((p, j) => [p.id, (["head", "manager", "officer"][j] || "member")])),
      xp: 0, treasury: 0, capacity: 15, applications: [], applicationFees: {}, createdAt: at,
    };
    competition.clanState(c).league = 0;
    for (const p of members) p.clanId = id;
    store.data.clans[id] = c;
  }
  competition.advance(store.data, at, n => n - 1);
  validateWorld(store.data);
  competition.validate(store.data);
  return { data: store.data, tokens, summary: { profiles: 1280, clans: 128,
    membersPerClan: 10, initialLeague: "bronze", levels: [1, 500] } };
}

function simulateSeason(fixture) {
  const data = structuredClone(fixture.data);
  const at = Date.parse("2027-01-04T09:00:00+03:00");
  data.competition = null;
  for (const clan of Object.values(data.clans)) delete clan.competition;
  let seed = 314159;
  const random = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
  competition.advance(data, at, random);
  const history = [];
  while (data.competition.week.end < data.competition.season.end) {
    const w = data.competition.week;
    // All competing clans qualify by score. This tests real promotion/demotion
    // and group formation, not how quickly humans will earn those kills.
    for (const group of w.groups) group.clans.forEach((id, i) => {
      const c = data.clans[id], kills = rules.LEAGUES[group.league].threshold + group.clans.length - i;
      w.scores[id] = { kills, members: { [c.ownerId]: { kills, joinedAt: 0 } } };
    });
    const settled = w.end;
    competition.advance(data, settled + 1, random);
    competition.validate(data);
    history.push({ week: history.length + 1, settledAt: new Date(settled).toISOString(),
      leagues: rules.LEAGUES.map((l, i) => ({ id: l.id,
        clans: Object.values(data.clans).filter(c => c.competition.league === i).length })),
      championGroups: data.competition.week.groups.filter(g => g.league === 5).map(g => g.clans.length),
      championsAwarded: Object.values(data.competition.lastWeek).filter(v => v.result === "champion").length,
    });
  }
  return { start: new Date(at).toISOString(), assumption: "All ranked winners meet their league kill threshold; real weekly settlement, with relegation.",
    firstChampionGroupWeek: history.find(h => h.championGroups.length)?.week || null, history };
}
module.exports = { createFixture, simulateSeason, MARKER };
