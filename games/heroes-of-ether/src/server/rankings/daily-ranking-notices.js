/* Уведомление сохраняется вместе с призом, прочтение не выдаёт награду повторно. */
"use strict";
const rules = require("../../../public/shared/daily-ranking-rules");
const { BoosterError } = require("../boosters/booster-catalog");
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const noticeId = (day, medalId) => `${day}:${medalId}`;
function view(profile) {
  if (profile.dailyRankingRewards !== undefined)
    return structuredClone(profile.dailyRankingRewards);
  // Старым игрокам показываем последний подтверждённый итог по сохранённым
  // регалиям. Это только уведомление: кошелёк и количество регалий не меняются.
  const entries = Object.entries(profile.regalia || {});
  const latest = Math.max(-1, ...entries.map(([, medal]) => medal.lastDay));
  return entries
    .filter(([, medal]) => medal.lastDay === latest)
    .map(([medalId]) => {
      const medal = rules.medals.find((m) => m.id === medalId);
      return { id: noticeId(latest, medalId), day: latest, medalId, prize: { ...medal.prize } };
    });
}
function record(profile, day, medalId, prize) {
  profile.dailyRankingRewards = view(profile);
  const id = noticeId(day, medalId);
  if (!profile.dailyRankingRewards.some((n) => n.id === id))
    profile.dailyRankingRewards.push({ id, day, medalId, prize: { ...prize } });
}
function dismiss(profile, ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > rules.boards.length ||
    ids.some((id) => typeof id !== "string" || !/^\d+:/.test(id) ||
      !rules.medals.some(m => m.id === id.slice(id.indexOf(":") + 1)))
  )
    throw new BoosterError("Неверное уведомление о награде топа.");
  profile.dailyRankingRewards = view(profile).filter((n) => !ids.includes(n.id));
}
function validate(profile) {
  const list = profile.dailyRankingRewards;
  if (list === undefined) return;
  if (
    !Array.isArray(list) ||
    list.some(
      (n) =>
        !n ||
        !integer(n.day) ||
        !rules.medals.some((m) => m.id === n.medalId) ||
        n.id !== noticeId(n.day, n.medalId) ||
        !n.prize ||
        ![n.prize.coins, n.prize.crystals, n.prize.greatness].every(integer) ||
        (n.prize.tickets !== undefined && !integer(n.prize.tickets)),
    ) ||
    new Set(list.map((n) => n.id)).size !== list.length
  )
    throw Error("Повреждены уведомления о наградах топа. Сохранение не перезаписано.");
}
module.exports = { view, record, dismiss, validate };
