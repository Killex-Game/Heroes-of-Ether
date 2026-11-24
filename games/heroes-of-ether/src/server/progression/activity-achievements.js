/* Достижения за посещения, расходы, клановую активность и время игры. */
"use strict";
const stages = require("./achievement-stages");
let titleAwards;
// Новые цепочки. Не подключённые игровые системы не могут выдавать награды.
const accounts = require("../accounts/account-benefits");
const petRules = require("../../../public/shared/pet-rules");
const accessories = require("../../../public/shared/accessory-catalog");
// Preview-only concepts cannot count as ownership. Their catalogue entries
// are immutable; do not recheck every concept for every arena progress event.
const { ownedAccessoryCount } = require("./owned-accessory-count");
const { LEAGUES } = require("../../../public/shared/clan-competition-rules");
const LEAGUE_IDS = [
  "league_conqueror",
  "league_fighter",
  "victory_march",
  "cup_keeper",
  "champion_dynasty",
];
const COMMON = [10, 30, 50, 100],
  SPEND = [50, 150, 300, 500],
  PURCHASE = [50, 150, 300, 500];
const entry = (id, name, category, unit, thresholds, rewards, description, unavailable = "") =>
  Object.freeze({
    id,
    name,
    category,
    unit,
    thresholds: Object.freeze(thresholds),
    rewards: Object.freeze(rewards),
    description,
    unavailable,
  });
const PET_ACHIEVEMENTS = [
  entry(
    "pet_nursery",
    "Питомник",
    "pets",
    "питомцев",
    [1, 2, 3, 4],
    COMMON,
    "Собрать коллекцию питомцев.",
  ),
  entry(
    "pet_master",
    "Лучший Хозяин",
    "pets",
    "питомцев",
    [1, 2, 3, 4],
    [250, 500, 1500, 3000],
    "Развивать питомцев",
  ),
  entry(
    "pet_trainer",
    "Дрессировщик",
    "pets",
    "игр",
    [500, 1000, 2500, 5000],
    [50, 100, 150, 300],
    "Играть с питомцами на арене.",
  ),
  entry(
    "pet_feeder",
    "Кормилец",
    "pets",
    "кормлений",
    [10, 50, 100, 250],
    COMMON,
    "Покормить питомцев",
  ),
  entry(
    "pet_exclusive",
    "Эксклюзив",
    "pets",
    "питомцев",
    [1, 2],
    [250, 500],
    "Приобрести питомцев за эфир.",
  ),
  ...petRules.pets.map((pet) =>
    entry(
      `pet_level_${pet.id}`,
      pet.name,
      "pets",
      "повышений уровня",
      [1, 1, 1, 1, 1],
      [50, 250, 500, 750, 1000],
      `Повысить уровень питомца «${pet.name}».`,
    ),
  ),
].map((d) => {
  const exception = ["pet_nursery", "pet_master", "pet_exclusive"].includes(d.id);
  return Object.freeze({ ...d, exception, cumulative: exception });
});
const EXTRA_ACHIEVEMENTS = Object.freeze([
  ...require("./clan-quest-achievements").definitions,
  Object.freeze({
    ...entry(
      "fashionista",
      "Модник",
      "collection",
      "аксессуаров",
      [5, 10, 15, 20, 25],
      [10, 30, 50, 100, 250],
      "Собрать аксессуаров",
    ),
    cumulative: true,
    exception: true,
  }),
  ...PET_ACHIEVEMENTS,
  entry(
    "league_conqueror",
    "Покоритель лиг",
    "league",
    "лиг",
    [6],
    [1000],
    "Побывать во всех лигах вместе с кланом.",
  ),
  entry(
    "league_fighter",
    "Боец лиги",
    "league",
    "зачётных киллов",
    [1000, 5000, 15000, 50000, 100000],
    [10, 50, 100, 150, 300],
    "Поглощать соперников в клановых битвах.",
  ),
  entry(
    "victory_march",
    "Победный марш",
    "league",
    "победных битв",
    [3, 10, 30, 100, 200],
    [10, 50, 100, 150, 300],
    "Побеждать в клане",
  ),
  entry(
    "cup_keeper",
    "Хранитель кубков",
    "league",
    "сезонных наград",
    [1, 2, 3, 5, 10],
    [100, 500, 1000, 1500, 3000],
    "Получать сезонную награду вместе с кланом.",
  ),
  entry(
    "champion_dynasty",
    "Династия чемпионов",
    "league",
    "Чемпионский кубок",
    [1, 1, 1, 1, 1],
    [3000, 3000, 3000, 3000, 3000],
    "Получать награду Чемпионского кубка вместе с кланом.",
  ),
  entry(
    "vip",
    "VIP",
    "status",
    "недель",
    [1, 3, 5, 10],
    [100, 150, 300, 500],
    "Активировать VIP.",
  ),
  entry(
    "premium",
    "Premium",
    "status",
    "недель",
    [1, 3, 5, 10],
    [150, 300, 500, 1000],
    "Активировать Premium.",
  ),
  entry(
    "strong_love",
    "Крепкая любовь",
    "social",
    "дней",
    [30, 60, 120, 240],
    [10, 30, 50, 100],
    "Быть в браке с одним игроком. При расторжении брака прогресс текущей степени сбрасывается.",
  ),
  entry(
    "loving",
    "Любящие",
    "social",
    "подарков",
    [10, 30, 50, 100],
    COMMON,
    "Сделать подарки мужу или жене. При расторжении брака прогресс текущей степени сбрасывается.",
  ),
  entry(
    "always_together",
    "Всегда вместе",
    "social",
    "дней",
    [7, 14, 21, 30],
    COMMON,
    "Быть в одном клане с мужем или женой. При расторжении брака прогресс текущей степени сбрасывается.",
  ),
  entry(
    "valuable",
    "Ценные",
    "social",
    "усилителей",
    [10, 30, 50, 100],
    [10, 30, 50, 100],
    "Подарить мужу или жене усилители. При расторжении брака прогресс текущей степени сбрасывается.",
  ),
  entry("marriage", "Брак", "social", "браков", [1], [100], "Заключить брак"),
  entry(
    "wealthy",
    "Богач",
    "economy",
    "монет",
    [10000, 50000, 100000, 250000],
    PURCHASE,
    "Купить монеты.",
  ),
  entry(
    "spendthrift",
    "Транжира",
    "economy",
    "монет",
    [15000, 50000, 150000, 300000],
    SPEND,
    "Потратить монеты.",
  ),
  entry(
    "miner",
    "Шахтер",
    "economy",
    "кристаллов",
    [1000, 3000, 5000, 10000],
    PURCHASE,
    "Купить кристаллы.",
  ),
  entry(
    "spendthrift_i",
    "Транжира I",
    "economy",
    "кристаллов",
    [1000, 5000, 10000, 15000],
    SPEND,
    "Потратить кристаллы.",
  ),
  entry(
    "banker",
    "Банкир",
    "economy",
    "эфира",
    [1000, 3000, 5000, 10000],
    PURCHASE,
    "Купить эфир.",
  ),
  entry(
    "spendthrift_ii",
    "Транжира II",
    "economy",
    "эфира",
    [3000, 5000, 10000, 15000],
    SPEND,
    "Потратить эфир.",
  ),
  entry(
    "top",
    "Топ",
    "arena",
    "раз",
    [1, 3, 5, 10],
    COMMON,
    "Попасть на 1-3 место любой категории по суточному итогу рейтинга",
  ),
  entry(
    "generous",
    "Щедрый",
    "social",
    "подарков",
    [5, 30, 50, 100],
    COMMON,
    "Подарить подарки другим игрокам.",
  ),
  entry(
    "needed",
    "Нужный",
    "social",
    "подарков",
    [5, 30, 50, 100],
    COMMON,
    "Получать подарки от других игроков.",
  ),
  entry(
    "sociable",
    "Общительный",
    "social",
    "сообщений",
    [5, 30, 50, 100],
    COMMON,
    "Написать сообщения в любой чат",
  ),
  entry(
    "for_clan",
    "За клан",
    "clan",
    "жизней",
    [5, 30, 50, 100],
    COMMON,
    "Завершить игру на арене длительностью от минуты, состоя в одном клане от начала до конца игры.",
  ),
  entry(
    "investment",
    "Капиталовложение",
    "clan",
    "взносов",
    [5, 10, 30, 50],
    COMMON,
    "Сделать взносы в казну клана. (Количество взносов)",
  ),
  entry(
    "not_stingy",
    "Не жалко",
    "clan",
    "эфира",
    [10, 100, 1000, 10000],
    [50, 150, 300, 500],
    "Внести эфир в казну клана. (Сумма взноса)",
  ),
  entry(
    "resident",
    "Постоялец",
    "clan",
    "дней",
    [7, 30, 180, 365],
    COMMON,
    "Непрерывно состоять в одном клане.",
  ),
  entry(
    "gamer",
    "Игроман",
    "loyalty",
    "часов",
    [24, 168, 336, 744],
    COMMON,
    "Провести указанное число часов живым игроком на арене.",
  ),
  entry(
    "jumper",
    "Прыгун",
    "arena",
    "соперников",
    [10, 50, 100, 500],
    COMMON,
    "Поглощать соперников частью шара, выпущенной разделением по пробелу, пока действует её разгон.",
  ),
  entry(
    "regular",
    "Завсегдатай",
    "loyalty",
    "дней",
    [7, 14, 21, 30],
    COMMON,
    "Заходить в игру каждый день подряд.",
  ),
  Object.freeze({
    ...entry(
      "fan",
      "Фанат",
      "loyalty",
      "дней",
      [15, 30, 90, 180, 365],
      [30, 50, 150, 300, 1000],
      "Оставаться вместе с нами",
    ),
    cumulative: true,
    exception: true,
  }),
]);
// The catalog is fixed. Build lookup tables once, instead of sorting/filtering
// targets and allocating arrays for every profile in every persisted arena tick.
const validationTargets = new Map(
  EXTRA_ACHIEVEMENTS.map((d) => [d.id, [...d.thresholds].sort((a, b) => a - b)]),
);
// Keep the same catalogue order, with one shape for the hot award scan. UI
// definitions have optional presentation fields that are irrelevant here.
const awardDefinitions = EXTRA_ACHIEVEMENTS.filter(d => !d.unavailable).map(d => ({
  id: d.id, targets: d.thresholds, rewards: d.rewards, cumulative: d.exception === true, fixedReward: d.fixedReward,
}));
const leagueSpent = LEAGUE_IDS.map((id) => {
  const d = EXTRA_ACHIEVEMENTS.find((d) => d.id === id),
    totals = [0];
  for (const target of d.thresholds) totals.push(totals.at(-1) + target);
  return { id, totals };
});
const DAY = 86400000,
  integer = (n) => Number.isSafeInteger(n) && n >= 0;
const sum = (a, b) => {
  if (!integer(a) || !integer(b) || !integer(a + b)) throw Error("Неверный счётчик достижения.");
  return a + b;
};
const localDay = (at) => Math.floor((at + 5 * 3600000) / DAY);
function freshActivity(at, clanId = null, registeredAt = at) {
  return {
    registeredAt,
    achievementStagesVersion: 2,
    trackedAt: at,
    values: Object.fromEntries(EXTRA_ACHIEVEMENTS.map((a) => [a.id, 0])),
    stageSpent: Object.fromEntries(EXTRA_ACHIEVEMENTS.map((a) => [a.id, 0])),
    claimed: Object.fromEntries(EXTRA_ACHIEVEMENTS.map((a) => [a.id, 0])),
    arenaSeconds: 0,
    lastVisitDay: null,
    streak: 0,
    clanId,
    clanSince: clanId ? at : null,
    clanLives: {},
    leagueVisits: [],
  };
}
// Version 10 saves predate these chains. Add only new fields; keep all earned progress.
function migrateLeagues(p) {
  const a = p.activity;
  const present = LEAGUE_IDS.some(
    (id) =>
      a.values[id] !== undefined || a.claimed[id] !== undefined || a.stageSpent?.[id] !== undefined,
  );
  if (present || a.leagueVisits !== undefined) return;
  for (const id of LEAGUE_IDS) {
    a.values[id] = 0;
    a.claimed[id] = 0;
    if (a.stageSpent !== undefined) a.stageSpent[id] = 0;
  }
  a.leagueVisits = [];
}
function migratePets(p) {
  for (const d of PET_ACHIEVEMENTS) {
    p.activity.values[d.id] = 0;
    p.activity.claimed[d.id] = 0;
    if (p.activity.stageSpent) p.activity.stageSpent[d.id] = 0;
  }
}
function migrateAccessories(p) {
  const a = p.activity,
    id = "fashionista";
  if (!a?.values || !a.claimed) return false;
  if (
    Object.hasOwn(a.values, id) ||
    Object.hasOwn(a.claimed, id) ||
    (a.stageSpent && Object.hasOwn(a.stageSpent, id))
  )
    return false;
  a.values[id] = accessories.items.reduce(
    (n, item) => n + Number(accessories.isOwned(p, item.id)),
    0,
  );
  a.claimed[id] = 0;
  if (a.stageSpent) a.stageSpent[id] = 0;
  return true;
}
// Existing pet levels are earned progress. Initialize the new chains only when
// all their fields are absent; partial/corrupt records must still fail validation.
function migratePetLevels(p) {
  const definitions = PET_ACHIEVEMENTS.filter((d) => d.id.startsWith("pet_level_")),
    a = p.activity;
  if (!a?.values || !a.claimed) return false;
  if (
    definitions.some(
      (d) =>
        Object.hasOwn(a.values, d.id) ||
        Object.hasOwn(a.claimed, d.id) ||
        (a.stageSpent && Object.hasOwn(a.stageSpent, d.id)),
    )
  )
    return false;
  for (const pet of petRules.pets) {
    const id = `pet_level_${pet.id}`;
    a.values[id] = petRules.level(p.pets.owned[pet.id]?.games || 0);
    a.claimed[id] = 0;
    if (a.stageSpent) a.stageSpent[id] = 0;
  }
  return true;
}
// These modules depend on this module too. Resolve after initialization, once.
let socialCalendarValidation, luckyWeekValidation;
function validateActivity(p, previous) {
  const a = p.activity;
  // Only the arena's reconciled copy-on-write draft may provide a previously
  // validated immutable profile. Other callers retain the full validation.
  // Reusing a counter record does not exempt the changed session/scalar fields.
  const prior = previous && previous !== p ? previous.activity : null;
  const sameCounters = !!prior && a?.values === prior.values && a?.claimed === prior.claimed &&
    a?.stageSpent === prior.stageSpent;
  if (a?.achievementStagesVersion !== undefined && a.achievementStagesVersion !== 2)
    throw Error("Неизвестная версия степеней достижений.");
  if (a?.marriageProgressVersion !== undefined && a.marriageProgressVersion !== 1)
    throw Error("Неизвестная версия прогресса брака.");
  (socialCalendarValidation ||= require("./social-calendar").validate)(p);
  if (!prior || p.clanQuestAchievements !== previous.clanQuestAchievements)
    require('./clan-quest-achievements').validate(p);
  if (!prior || p.eventAchievements !== previous.eventAchievements)
    (luckyWeekValidation ||= require("../events/lucky-week").validate)(p);
  if (a?.chatAccepted !== undefined && !integer(a.chatAccepted))
    throw Error("Повреждён счётчик чата.");
  if (
    !a ||
    ![a.registeredAt, a.trackedAt, a.arenaSeconds, a.streak].every(integer) ||
    !a.values ||
    Array.isArray(a.values) ||
    !a.claimed ||
    Array.isArray(a.claimed) ||
    !a.clanLives ||
    Array.isArray(a.clanLives) ||
    typeof a.clanLives !== "object" ||
    ((!prior || a.clanLives !== prior.clanLives) && !Object.values(a.clanLives).every(integer)) ||
    (a.lastVisitDay !== null && !integer(a.lastVisitDay)) ||
    (a.clanId !== null && typeof a.clanId !== "string") ||
    (a.clanId === null ? a.clanSince !== null : !integer(a.clanSince)) ||
    (!sameCounters && EXTRA_ACHIEVEMENTS.some(
      (d) =>
        !integer(a.values[d.id]) ||
        !integer(a.claimed[d.id]) ||
        a.claimed[d.id] > d.thresholds.length ||
        (!!d.unavailable && (a.values[d.id] !== 0 || a.claimed[d.id] !== 0)) ||
        (d.id !== "regular" &&
          d.id !== "resident" &&
          a.claimed[d.id] > 0 &&
          a.values[d.id] < validationTargets.get(d.id)[a.claimed[d.id] - 1]),
    ))
  )
    throw Error("Повреждены новые достижения. Сохранение не перезаписано.");
  if (!sameCounters) stages.validate(a, EXTRA_ACHIEVEMENTS, (d) => a.values[d.id]);
  if (
    !Array.isArray(a.leagueVisits) ||
    ((!prior || a.leagueVisits !== prior.leagueVisits) &&
      (new Set(a.leagueVisits).size !== a.leagueVisits.length ||
        a.leagueVisits.some((id) => !LEAGUES.some((l) => l.id === id)))) ||
    a.values.league_conqueror !== a.leagueVisits.length ||
    (!sameCounters && leagueSpent.some(({ id, totals }) => {
      const spent = totals[a.claimed[id]];
      return spent > a.values[id] || (a.stageSpent !== undefined && a.stageSpent[id] !== spent);
    }))
  )
    throw Error("Повреждены достижения лиг. Сохранение не перезаписано.");
  if (
    p.progress.session &&
    ((p.progress.session.activitySeconds !== undefined &&
      !integer(p.progress.session.activitySeconds)) ||
      (p.progress.session.activityClan !== undefined &&
        p.progress.session.activityClan !== null &&
        typeof p.progress.session.activityClan !== "string"))
  )
    throw Error("Повреждён учёт времени жизни.");
}
// Called only for committed server competition events, within the same draft as its rewards.
function leagueEvent(p, event, amount, at) {
  if (!p.activity) return;
  const a = p.activity;
  if (event === "league") {
    const league = LEAGUES[amount];
    if (!league || !Number.isInteger(amount)) throw Error("Неизвестная лига достижения.");
    if (a.leagueVisits.includes(league.id)) return;
    a.leagueVisits.push(league.id);
    a.values.league_conqueror = a.leagueVisits.length;
  } else if (event === "cup") {
    if (!Number.isInteger(amount) || !LEAGUES[amount]) throw Error("Неизвестная лига кубка.");
    a.values.cup_keeper = sum(a.values.cup_keeper, 1);
    if (amount === LEAGUES.length - 1)
      a.values.champion_dynasty = sum(a.values.champion_dynasty, 1);
  } else {
    const id = { kills: "league_fighter", victory: "victory_march" }[event];
    if (!id || !integer(amount) || amount < 1 || (event === "victory" && amount !== 1))
      throw Error("Неверное событие достижения лиг.");
    a.values[id] = sum(a.values[id], amount);
  }
  awardExtra(p, at);
  (titleAwards ||= require("./title-chest-rewards").awardTitles)(p, at);
  p.revision = sum(p.revision, 1);
}
function migrateStageRules(p) {
  const a = p.activity;
  if (!a || a.achievementStagesVersion === 2) return false;
  const spent = stages.ensure(a, EXTRA_ACHIEVEMENTS, (d) => a.values[d.id]);
  for (const id of ["pet_trainer", "pet_feeder"]) {
    const d = EXTRA_ACHIEVEMENTS.find((d) => d.id === id),
      claimed = a.claimed[id] || 0;
    spent[id] = Math.min(a.values[id], claimed ? d.thresholds[claimed - 1] : 0);
  }
  a.achievementStagesVersion = 2;
  return true;
}
// Passive arena samples normally leave these counters unchanged. Preserve
// their published record until a real counter changes; unknown fields survive.
function setPassiveValue(activity, key, value) {
  if (activity.values[key] !== value) activity.values = { ...activity.values, [key]: value };
}
// Only a PRIVATE batch containing audited copy-on-write sample events may
// reuse its own completed scan. Every new batch starts with a full scan;
// ordinary mutations and batches containing any other event never opt in.
// Weak keys add no persisted fields and do not retain finished profiles.
const passiveBatchAwards = new WeakMap();
function beginPassiveArenaBatch(p) {
  if (p.activity?.achievementStagesVersion === 2) passiveBatchAwards.set(p.activity, null);
}
function endPassiveArenaBatch(p) {
  if (p.activity) passiveBatchAwards.delete(p.activity);
}
function awardExtra(p, at = Date.now()) {
  const a = p.activity;
  if (!a) return;
  setPassiveValue(a, "fashionista", Math.max(a.values.fashionista || 0, ownedAccessoryCount(p)));
  migrateStageRules(p);
  stages.ensure(a, EXTRA_ACHIEVEMENTS, (d) => a.values[d.id]);
  const prior = passiveBatchAwards.get(a);
  if (prior && prior.values === a.values && prior.claimed === a.claimed && prior.spent === a.stageSpent)
    return;
  let copiedClaims = false;
  const values = a.values;
  let claimed = a.claimed, spent = a.stageSpent;
  for (const d of awardDefinitions) {
    const id = d.id, targets = d.targets, total = values[id];
    let degree = claimed[id];
    while (degree < targets.length &&
      (d.cumulative ? total : Math.max(0, total -
        (spent?.[id] ?? (degree ? targets[degree - 1] : 0)))) >= targets[degree]) {
      if (!copiedClaims) {
        claimed = a.claimed = { ...claimed };
        spent = a.stageSpent = { ...spent };
        copiedClaims = true;
      }
      if (!d.cumulative) spent[id] += targets[degree];
      p.greatness = sum(p.greatness, d.rewards[degree] * (d.fixedReward ? 1 : accounts.benefits(p, at).greatnessMultiplier));
      claimed[id] = ++degree;
    }
  }
  if (passiveBatchAwards.has(a))
    passiveBatchAwards.set(a, { values: a.values, claimed: a.claimed, spent: a.stageSpent });
}
function refreshCalendar(p, at, visit = false, awardsCurrent = false) {
  if (!integer(at)) throw Error("Неверное серверное время.");
  const a = p.activity;
  if (!a) return;
  const fan = a.values.fan, resident = a.values.resident;
  migrateStageRules(p);
  stages.ensure(a, EXTRA_ACHIEVEMENTS, (d) => a.values[d.id]);
  setPassiveValue(a, "fan", Math.max(a.values.fan, Math.floor(Math.max(0, at - a.registeredAt) / DAY)));
  if (a.clanId === p.clanId && a.clanSince !== null)
    setPassiveValue(a, "resident", Math.max(
      a.values.resident,
      Math.floor(Math.max(0, at - a.clanSince) / DAY),
    ));
  if (visit) {
    const day = localDay(at);
    if (a.lastVisitDay === null || day > a.lastVisitDay) {
      if (a.lastVisitDay === null || day > a.lastVisitDay + 1) stages.reset(a, "regular");
      a.streak = a.lastVisitDay !== null && day === a.lastVisitDay + 1 ? sum(a.streak, 1) : 1;
      a.lastVisitDay = day;
      a.values.regular = a.streak;
    }
  }
  // Arena applyEvent has just settled every achievement on this same draft.
  // Only the two age counters can change here without a visit. Early-returned
  // events and all other callers still take the full settlement path.
  if (!awardsCurrent || visit || a.values.fan !== fan || a.values.resident !== resident)
    awardExtra(p, at);
}
function changeClan(p, nextId, at) {
  const a = p.activity;
  if (!a) return;
  refreshCalendar(p, at);
  a.clanId = nextId;
  a.clanSince = nextId ? at : null;
  a.values.resident = 0;
  stages.reset(a, "resident");
  // Смена членства посреди жизни не превращает её в полную жизнь за новый клан.
  if (p.progress.session) p.progress.session.activityClan = null;
}
function spend(p, currency, amount, at = Date.now()) {
  const id = { coins: "spendthrift", crystals: "spendthrift_i", bucks: "spendthrift_ii" }[currency];
  if (!id) throw Error("Неизвестная валюта достижения.");
  p.activity.values[id] = sum(p.activity.values[id], amount);
  awardExtra(p, at);
}
function deposit(p, amount, at = Date.now()) {
  spend(p, "bucks", amount, at);
  p.activity.values.investment = sum(p.activity.values.investment, 1);
  p.activity.values.not_stingy = sum(p.activity.values.not_stingy, amount);
  awardExtra(p, at);
}
function lifeTime(p, lifeId, seconds, at = Date.now()) {
  const s = p.progress.session,
    a = p.activity;
  if (!a || !s || s.id !== lifeId) return;
  if (!integer(seconds)) throw Error("Неверное время жизни.");
  const previous = s.activitySeconds || 0;
  if (seconds > previous) {
    a.arenaSeconds = sum(a.arenaSeconds, seconds - previous);
    s.activitySeconds = seconds;
    setPassiveValue(a, "gamer", Math.floor(a.arenaSeconds / 3600));
  }
  awardExtra(p, at);
  return true;
}
function finishActivityLife(p, event, at = Date.now()) {
  const s = p.progress.session,
    a = p.activity;
  if (!a || !s || s.id !== event.lifeId) return;
  lifeTime(p, event.lifeId, event.durationSeconds, at);
  if (
    event.reason !== "recovered" &&
    event.durationSeconds >= 60 &&
    s.activityClan &&
    s.activityClan === p.clanId
  ) {
    a.clanLives = { ...a.clanLives, [s.activityClan]: sum(a.clanLives[s.activityClan] || 0, 1) };
    a.values.for_clan = Math.max(a.values.for_clan, a.clanLives[s.activityClan]);
    awardExtra(p, at);
  }
}
function publicExtra(p) {
  return EXTRA_ACHIEVEMENTS.map((d) => ({
    ...d,
    available: !d.unavailable,
    value: p.activity ? stages.current(p.activity, d, p.activity.values[d.id]) : 0,
    claimed: p.activity?.claimed[d.id] || 0,
  }));
}
module.exports = {
  beginPassiveArenaBatch,
  endPassiveArenaBatch,
  EXTRA_ACHIEVEMENTS,
  DAY,
  localDay,
  freshActivity,
  migrateLeagues,
  migratePets,
  migrateAccessories,
  migratePetLevels,
  migrateStageRules,
  leagueEvent,
  validateActivity,
  awardExtra,
  refreshCalendar,
  changeClan,
  spend,
  deposit,
  lifeTime,
  finishActivityLife,
  publicExtra,
};
