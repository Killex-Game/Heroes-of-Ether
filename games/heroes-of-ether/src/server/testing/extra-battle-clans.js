"use strict";
// Explicit offline fixture: prepare everything in memory; never run on server startup.
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
function unchanged(a, b) {
  if (!isDeepStrictEqual(a, b))
    throw Error("Подготовка изменила существующие данные; применение отменено.");
}
const { ProfileStore } = require("../profiles/profile-store");
const { validateWorld } = require("../clans/clan-service");
const competition = require("../clans/clan-competition-service");
const { freshProgress } = require("../progression/experience-progression");
const { MARKER } = require("./arena-test-bots");
const crests = require("../../../public/shared/clan-crest-rules");
const { skins } = require("../../../public/shared/player-identity");
const nicknames = require("../profiles/nickname-rules");
const BATCH = "battle-leagues-20261027";
const NAMES = [
  [
    "Серебряные соколы",
    "Ледяные клинки",
    "Лунные рыцари",
    "Стражи рассвета",
    "Снежные барсы",
    "Вольные ветры",
    "Северное сияние",
    "Белые грифоны",
    "Лазурный дозор",
  ],
  [
    "Янтарная корона",
    "Золотой легион",
    "Пламенные грифоны",
    "Орден солнца",
    "Рубиновые стражи",
    "Песчаные львы",
    "Громовые драконы",
    "Стражи сокровищ",
    "Алая заря",
    "Крылья победы",
  ],
];

function prepareExtraBattleClans(data, at) {
  const work = new ProfileStore({ now: () => at });
  work.data = structuredClone(data);
  const fresh = new ProfileStore({ now: () => at });
  const next = structuredClone(data),
    added = [];
  const prefixes = new Set(Object.values(data.clans).map((c) => c.prefix.toUpperCase()));
  const names = new Set(Object.values(data.clans).map((c) => c.name.toLowerCase()));
  const existingSeeds = new Set(Object.values(data.clans).map((c) => c.testSeedKey));
  for (const [band, titles] of NAMES.entries()) {
    const league = band + 1;
    for (const [index, title] of titles.entries()) {
      const key = `${BATCH}:${league}:${index}`;
      if (existingSeeds.has(key)) continue;
      let serial = 1,
        prefix;
      do {
        prefix = (league === 1 ? "S" : "G") + String(serial++).padStart(2, "0");
      } while (prefixes.has(prefix));
      if (prefix.length > 4) throw Error("Нет свободного префикса для тестового клана.");
      prefixes.add(prefix);
      let name = title,
        suffix = 2;
      while (names.has(name.toLowerCase())) name = title + " " + suffix++;
      names.add(name.toLowerCase());
      const id = randomUUID(),
        members = [];
      for (let j = 0; j < 10; j++) {
        const opened = fresh.open(),
          p = fresh.find(opened.token);
        p.name = nicknames.available(
          [...Object.values(data.profiles), ...Object.values(fresh.data.profiles)],
          `Бот ${prefix} ${["Искра", "Ветер", "Луч", "Гром", "Роса", "Кедр", "Заря", "Волна", "Снег", "Лист"][j]}`,
          p.id,
        );
        p.testBot = MARKER;
        require("./bot-identity").assignBotGender(p);
        p.level = (league === 1 ? 20 : 35) + (index % 5);
        p.progress = freshProgress(p.level);
        p.skinId = skins[(index * 4 + j + band * 7) % skins.length].id;
        members.push(p.id);
      }
      const clan = {
        id,
        name,
        prefix,
        testOnly: MARKER,
        testSeedKey: key,
        description: "Тестовый клан с ботами для клановых битв.",
        emblem: index % 2 ? "grove" : "astral",
        privacy: "open",
        crest: {
          frame: crests.frames[index % crests.frames.length].id,
          color: crests.colors[(index + band * 8) % crests.colors.length].id,
          symbol: crests.symbols[(index + band * 5) % crests.symbols.length].id,
        },
        ownerId: members[0],
        members,
        roles: Object.fromEntries(
          members.map((member, j) => [member, (["head", "manager", "officer"][j] || "member")]),
        ),
        xp: league === 1 ? 60000 : 190000,
        treasury: 0,
        capacity: league === 1 ? 15 : 20,
        applications: [],
        applicationFees: {},
        createdAt: at,
      };
      competition.clanState(clan).league = league;
      next.clans[id] = clan;
      added.push(clan);
    }
  }
  // ProfileStore.open replaces the in-memory graph, so assign clan IDs last.
  for (const clan of added) for (const id of clan.members) fresh.byId(id).clanId = clan.id;
  Object.assign(next.profiles, fresh.data.profiles);
  if (added.length) work.save(next, at);

  const scheduled = structuredClone(work.data),
    state = scheduled.competition;
  if (!state?.week) throw Error("Сначала подготовьте обычное расписание клановых битв.");
  const batchClans = Object.values(scheduled.clans).filter((c) =>
    c.testSeedKey?.startsWith(BATCH + ":"),
  );
  const assigned = new Set(state.week.groups.flatMap((g) => g.clans));
  const addedGroups = [];
  for (const league of [1, 2]) {
    const waiting = Object.values(scheduled.clans)
      .filter((c) => c.competition.league === league && c.members.length >= 10 && !assigned.has(c.id))
      .map((c) => c.id);
    for (const size of competition.groupSizes(waiting.length)) {
      const group = {
        id: state.week.id + "-extra-" + randomUUID(),
        league,
        clans: waiting.splice(0, size),
      };
      state.week.groups.push(group);
      addedGroups.push(group);
    }
  }
  const day = state.day;
  let addedPairs = 0;
  if (day && day.start <= at && at < day.end) {
    const paired = new Set(day.pairs.flatMap((p) => [p.a, p.b]));
    for (const group of addedGroups) {
      for (let i = 0; i + 1 < group.clans.length; i += 2) {
        const a = group.clans[i],
          b = group.clans[i + 1];
        if (paired.has(a) || paired.has(b)) throw Error("Клан уже участвует в битве.");
        day.pairs.push({ a, b });
        for (const id of [a, b]) {
          const clan = scheduled.clans[id];
          day.rosters[id] = clan.members.filter((member) => competition.eligible(clan, member, at));
          paired.add(id);
        }
        addedPairs++;
      }
    }
    // New test teams are an initial roster, not recruits to an existing battle.
    for (const clan of added) {
      const c = scheduled.clans[clan.id];
      c.competition.recruits = {};
      if (paired.has(c.id)) day.rosters[c.id] = [...c.members];
    }
  }
  if (added.length || addedGroups.length) work.save(scheduled, at);
  validateWorld(work.data);
  competition.validate(work.data);
  // This setup may add opponents to a waiting clan, but must not change its assets/results.
  for (const [key, profile] of Object.entries(data.profiles))
    unchanged(work.data.profiles[key], profile);
  for (const [id, clan] of Object.entries(data.clans)) unchanged(work.data.clans[id], clan);
  if (data.competition?.day) {
    unchanged(
      work.data.competition.day.pairs.slice(0, data.competition.day.pairs.length),
      data.competition.day.pairs,
    );
    unchanged(work.data.competition.day.scores, data.competition.day.scores);
  }
  unchanged(work.data.competition.week.scores, data.competition.week.scores);
  return {
    data: work.data,
    summary: {
      addedClans: added.length,
      addedBots: added.reduce((n, c) => n + c.members.length, 0),
      addedGroups: addedGroups.length,
      addedPairs,
      clans: batchClans.map((c) => ({
        name: c.name,
        prefix: c.prefix,
        league: c.competition.league,
        members: c.members.length,
      })),
    },
  };
}
module.exports = { prepareExtraBattleClans, BATCH };
