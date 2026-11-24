"use strict";
const definitions = Object.freeze([
  ["clan_quest_help", "Первое плечо", "заданий", [1, 10, 50, 150, 500], "Внести личный вклад в выполненные клановые задания."],
  ["clan_quest_five", "Пять из пяти", "дней", [1, 3, 10, 25, 50], "Внести личный вклад во все пять выполненных заданий дня."],
  ["clan_quest_days", "Опора клана", "дней", [3, 10, 30, 60, 120], "Вносить вклад в клановые задания в разные дни. Дни не обязаны идти подряд."],
  ["clan_quest_types", "Мастер поручений", "видов заданий", [3, 5, 10, 15, 18], "Внести вклад в выполненные задания разных видов."],
  ["clan_quest_seasons", "Сезонный герой", "сезонов", [1, 2, 3, 5, 10], "Получить награды за сезоны клановых заданий."],
].map(([id, name, unit, thresholds, description]) => Object.freeze({
  id, name, unit, description, category: "clan", thresholds: Object.freeze(thresholds),
  rewards: Object.freeze([25, 50, 100, 200, 400]), cumulative: true, exception: true, fixedReward: true, unavailable: "",
})));
const fresh = () => ({ version: 1, lastDay: null, types: [] });
function migrate(p) {
  const a = p.activity;
  if (!a || p.clanQuestAchievements !== undefined) return false;
  const present = definitions.filter(d => a.values[d.id] !== undefined || a.claimed[d.id] !== undefined);
  if (present.length && (present.length !== definitions.length ||
      definitions.some(d => a.values[d.id] !== 0 || a.claimed[d.id] !== 0 || (a.stageSpent?.[d.id] || 0) !== 0)))
    throw Error("Incomplete clan quest achievements");
  p.clanQuestAchievements = fresh();
  for (const d of definitions) {
    a.values[d.id] = 0; a.claimed[d.id] = 0;
    if (a.stageSpent) a.stageSpent[d.id] = 0;
  }
  // Existing medals prove seasonal rewards; earlier per-objective participation
  // was not retained and must never be inferred from a shared clan payout.
  a.values.clan_quest_seasons = new Set((p.clanQuestMedals || []).map(m => m.seasonId)).size;
  return true;
}
function validate(p) {
  const s = p.clanQuestAchievements;
  if (s === undefined) return;
  if (!s || s.version !== 1 || (s.lastDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(s.lastDay)) ||
      !Array.isArray(s.types) || s.types.length > 64 || new Set(s.types).size !== s.types.length ||
      s.types.some(v => typeof v !== "string" || !/^[a-zA-Z]+$/.test(v)))
    throw Error("Invalid clan quest achievements");
}
function daily(p, board) {
  if (!p.activity) return;
  migrate(p);
  const prior = p.clanQuestAchievements, contribution = board.contributors[p.id];
  if (!contribution || (prior.lastDay && prior.lastDay >= board.day)) return;
  const completed = board.quests.filter(q => q.completedAt !== null && contribution.questIds?.includes(q.id));
  const types = [...new Set([...prior.types, ...completed.map(q => q.metric)])].sort();
  const values = p.activity.values;
  p.activity.values = { ...values,
    clan_quest_help: values.clan_quest_help + completed.length,
    clan_quest_five: values.clan_quest_five + Number(completed.length === 5),
    clan_quest_days: values.clan_quest_days + 1,
    clan_quest_types: types.length,
  };
  p.clanQuestAchievements = { ...prior, lastDay: board.day, types };
  require("./activity-achievements").awardExtra(p, board.end);
}
function season(p, at) {
  if (!p.activity) return;
  migrate(p);
  p.activity.values = { ...p.activity.values,
    clan_quest_seasons: new Set((p.clanQuestMedals || []).map(m => m.seasonId)).size };
  require("./activity-achievements").awardExtra(p, at);
}
module.exports = { definitions, fresh, migrate, validate, daily, season };
