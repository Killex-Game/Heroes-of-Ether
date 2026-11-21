"use strict";
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../profiles/profile-store");
const { freshProgress } = require("../progression/experience-progression");
const { validateWorld } = require("../clans/clan-service");
const competition = require("../clans/clan-competition-service");
const crests = require("../../../public/shared/clan-crest-rules");
const { skins } = require("../../../public/shared/player-identity");
const { MARKER } = require("./arena-test-bots");
const { prepareBattlePopulation } = require("./battle-population");
const SEED = "bronze-population-20261110";

// Explicit offline fixture. Never invoked by normal login or a simulation tick.
function prepareBronzePopulation(data, at = Date.now(), count = 128) {
  let next = structuredClone(data);
  const sessions = [];
  const existing = Object.values(next.clans).filter(c => c.testSeedKey === SEED);
  const prefixes = new Set(Object.values(next.clans).map(c => c.prefix.toUpperCase()));
  let serial = 1;
  for (let i = existing.length; i < count; i++) {
    let prefix;
    do { prefix = "B" + String(serial++).padStart(3, "0"); } while (prefixes.has(prefix));
    prefixes.add(prefix);
    const id = randomUUID(), members = [];
    for (let j = 0; j < 4; j++) {
      const fresh = new ProfileStore({ now: () => at }), auth = fresh.open();
      const p = fresh.find(auth.token), n = i * 4 + j;
      p.name = `Бот ${prefix} ${["Искра", "Ветер", "Луч", "Гром"][j]}`;
      p.personal.nameSet = true;
      p.personal.introPending = false;
      p.testBot = MARKER;
      require("./bot-identity").assignBotGender(p);
      p.testSeedKey = SEED;
      p.level = 12 + ((n * 137) % 489);
      p.progress = freshProgress(p.level);
      p.skinId = skins[n % skins.length].id;
      p.wallet = { coins: 2000, crystals: 100, bucks: 20 };
      p.clanId = id;
      members.push(p.id);
      Object.assign(next.profiles, fresh.data.profiles);
      sessions.push({ id: p.id, token: auth.token });
    }
    const c = { id, name: `Бронзовый союз ${i + 1}`, prefix,
      description: "Тестовый клан. Путь от бронзы до чемпионской лиги.",
      testOnly: MARKER, testSeedKey: SEED, emblem: "grove", privacy: "open",
      crest: { frame: crests.frames[0].id, color: crests.colors[i % crests.colors.length].id,
        symbol: crests.symbols[i % crests.symbols.length].id },
      ownerId: members[0], members,
      roles: Object.fromEntries(members.map((p, j) => [p, ["head", "manager", "officer", "member"][j]])),
      xp: 0, treasury: 0, capacity: 15, applications: [], applicationFees: {}, createdAt: at };
    competition.clanState(c).league = 0;
    next.clans[id] = c;
  }
  const filled = prepareBattlePopulation(next, at);
  next = filled.data; sessions.push(...filled.sessions);
  // A schedule with real participants/results must never be reset by seeding.
  if (!next.competition?.week?.groups?.length && !next.competition?.day?.pairs?.length && next.competition) {
    next.competition.week = null;
    next.competition.day = null;
    next.competition.lastScheduledDay = null;
  }
  if (sessions.length) competition.advance(next, at, n => n - 1);
  validateWorld(next);
  competition.validate(next);
  return { data: next, sessions, summary: { addedBots: sessions.length,
    addedClans: count - existing.length, bots: Object.values(next.profiles).filter(p => p.testBot === MARKER).length,
    clans: Object.values(next.clans).filter(c => c.testSeedKey === SEED).length, initialLeague: "bronze" } };
}
module.exports = { prepareBronzePopulation, SEED };
