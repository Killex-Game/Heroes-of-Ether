"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");

const { findRunAt } = require("./event-run-lookup");
const stages = require("../progression/achievement-stages");
const entry = (id, name, unit, thresholds, rewards, description) => ({
  id,
  name,
  unit,
  thresholds,
  rewards,
  description,
  category: "event",
  exception: false,
  cumulative: false,
  available: true,
});
const achievements = [
  entry(
    "lucky_attempt",
    "Хорошая попытка",
    "вращений",
    [10, 50, 100, 200, 300],
    [25, 50, 75, 100, 150],
    "Крутить рулетку.",
  ),
  entry(
    "lucky_gold_mine",
    "Золотая жила",
    "выигрышей VIP",
    [1, 2, 3, 4, 5],
    [50, 100, 150, 300, 500],
    "Выиграть VIP в рулетке.",
  ),
  entry("lucky_lite", "Lite", "покупок", [1], [250], "Купить Lite."),
  entry(
    "lucky_arsenal",
    "Арсенал",
    "бустеров",
    [300, 500, 1000, 1500, 2000],
    [15, 30, 45, 70, 100],
    "Выиграть бустеры в рулетке.",
  ),
  entry(
    "lucky_marriage_games",
    "Брачные игры",
    "игр",
    [10, 25, 50, 100, 300],
    [10, 30, 50, 100, 250],
    "Получить новый уровень на одной арене с супругом. При расторжении брака прогресс текущей степени сбрасывается.",
  ),
];
const manifest = {
  schemaVersion: 1,
  id: "lucky-week",
  title: "Удачная неделя",
  description:
    "Рулетка, Lite подписка и достижения ждут вас. Полученные призы и неиспользованные билеты сохраняются после события.",
  durationMinutes: 10080,
  contentPack: "lucky-week-v1",
  features: { roulette: true, lite: true },
};
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
function add(a, b) {
  if (!integer(a) || !integer(b) || !integer(a + b)) throw Error("Неверный счётчик события.");
  return a + b;
}
function runAt(manager, at) {
  return findRunAt(manager, at, manifest.contentPack);
}
function record(p, run, id, amount) {
  if (!run || !amount) return;
  const d = achievements.find((d) => d.id === id);
  if (!d) throw Error("Неизвестное достижение события.");
  const all = (p.eventAchievements ||= {});
  const state = (all[run.id] ||= { pack: "lucky-week-v1", values: {}, claimed: {} });
  stages.ensure(state, achievements, (d) => state.values[d.id] || 0);
  state.values[id] = add(state.values[id] || 0, amount);
  let claimed = state.claimed[id] || 0;
  while (
    claimed < d.thresholds.length &&
    stages.current(state, d, state.values[id]) >= d.thresholds[claimed]
  ) {
    // These are the event's advertised fixed rewards, independent of account status.
    stages.consume(state, d);
    p.greatness = add(p.greatness, d.rewards[claimed++]);
    state.claimed[id] = claimed;
  }
  state.claimed[id] = claimed;
}
function spin(p, manager, reward, at) {
  const run = runAt(manager, at);
  record(p, run, "lucky_attempt", 1);
  if (run) {
    // An actual consumed ticket belongs to its Moscow calendar day. Keep the
    // cumulative achievement separate, including after the daily top resets.
    const state = p.eventAchievements[run.id],
      day = Math.floor((at + 10800000) / 86400000),
      daily = (state.dailySpins ||= {});
    daily[day] = add(daily[day] || 0, 1);
  }
  if (reward.category === "vip") record(p, run, "lucky_gold_mine", 1);
  if (reward.boosterId) record(p, run, "lucky_arsenal", reward.amount);
}
function arena(p, manager, event, before, previousLevel, at) {
  const session = p.progress.session;
  // Store the condition at the moment the level's XP is earned, not at a later reconnect.
  if (
    session &&
    before < p.progress.arenaXpTarget &&
    p.progress.xp + session.xp >= p.progress.arenaXpTarget
  ) {
    const run = runAt(manager, at);
    if (run && p.social?.marriage?.partnerId === event.spouseOnArena)
      session.luckyLevel = { runId: run.id, at };
  }
  if (p.level > previousLevel && event.luckyLevel) {
    const mark = event.luckyLevel,
      run = runAt(manager, mark.at);
    if (run?.id === mark.runId && runAt(manager, at)?.id === run.id)
      record(p, run, "lucky_marriage_games", p.level - previousLevel);
    delete p.progress.lastLife.pendingEventLevel;
  }
}
const needsRecovery = p => !!p.progress.lastLife?.pendingEventLevel;
const recoveryKeys = (world, cache) => cache
  ? cache.matchingProfiles("luckyRecovery", world.profiles, needsRecovery)
  : Object.keys(world.profiles).filter(key => needsRecovery(world.profiles[key]));
const recoveryDue = (world, manager, cache) =>
  !!manager && (cache ? recoveryKeys(world, cache).size > 0
    : Object.values(world.profiles).some(needsRecovery));
function recover(world, manager, at, cache) {
  if (!manager) return world;
  const keys = [...recoveryKeys(world, cache)];
  if (!keys.length) return world;
  const next = { ...world, profiles: { ...world.profiles } };
  for (const key of keys) {
    const original = world.profiles[key];
    const mark = original.progress.lastLife?.pendingEventLevel;
    if (!mark) continue;
    const p = copyProfile(original),
      run = runAt(manager, mark.at);
    if (run?.id === mark.runId && runAt(manager, at)?.id === run.id)
      record(p, run, "lucky_marriage_games", p.progress.lastLife.levelReward.levels);
    delete p.progress.lastLife.pendingEventLevel;
    require("../progression/title-chest-rewards").awardTitles(p, at);
    validate(p);
    p.revision++;
    next.profiles[key] = p;
  }
  require("../profiles/immutable-table-delta").remember(next.profiles,world.profiles,keys);
  return next;
}
function view(p, manager, at) {
  const run = runAt(manager, at);
  if (!run) return [];
  const state = p.eventAchievements?.[run.id];
  return achievements.map((d) => ({
    ...d,
    eventRunId: run.id,
    description: `Удачная неделя. ${d.description}`,
    value: state ? stages.current(state, d, state.values[d.id] || 0) : 0,
    claimed: state?.claimed[d.id] || 0,
  }));
}
function validate(p) {
  if (p.eventAchievements === undefined) return;
  if (
    !p.eventAchievements ||
    Array.isArray(p.eventAchievements) ||
    typeof p.eventAchievements !== "object"
  )
    throw Error("Повреждены достижения событий.");
  for (const [id, s] of Object.entries(p.eventAchievements)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || s?.pack !== "lucky-week-v1" || !s.values || !s.claimed)
      throw Error("Повреждён запуск достижений.");
    for (const key of new Set([...Object.keys(s.values), ...Object.keys(s.claimed)])) {
      const d = achievements.find((d) => d.id === key),
        value = s.values[key],
        claimed = s.claimed[key];
      if (
        !d ||
        !integer(value) ||
        !integer(claimed) ||
        claimed > d.thresholds.filter((n) => n <= value).length
      )
        throw Error("Повреждена выдача событийных наград.");
    }
    stages.validate(s, achievements, (d) => s.values[d.id] || 0);
    if (s.dailySpins !== undefined) {
      if (!s.dailySpins || Array.isArray(s.dailySpins) || typeof s.dailySpins !== "object" ||
          Object.entries(s.dailySpins).some(([day, count]) =>
            !/^(0|[1-9]\d{0,7})$/.test(day) || !integer(count)) ||
          Object.values(s.dailySpins).reduce((sum, n) => sum + n, 0) > (s.values.lucky_attempt || 0))
        throw Error("Повреждён дневной счёт билетов.");
    }
  }
}
function migrate(p) {
  let changed = false;
  for (const state of Object.values(p.eventAchievements || {})) {
    if (state.stageSpent !== undefined) continue;
    stages.ensure(state, achievements, (d) => state.values[d.id] || 0);
    changed = true;
  }
  return changed;
}
module.exports = {
  achievements,
  manifest,
  runAt,
  record,
  spin,
  arena,
  view,
  validate,
  migrate,
  recoveryDue,
  recover,
};
