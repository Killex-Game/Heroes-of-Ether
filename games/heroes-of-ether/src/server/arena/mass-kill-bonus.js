/* Бонус за накопленную массу и учёт порогов за вход на арену. */
"use strict";
const TIERS = Object.freeze([
  [5000, 2],
  [10000, 4],
  [20000, 6],
  [40000, 8],
  [80000, 10],
  [160000, 20],
]);
const reward = (mass) => TIERS.findLast(([threshold]) => mass > threshold)?.[1] || 0;
function reset(p) {
  p.massBonus = { since: null, min: 0, sequence: 0 };
}
function sample(p, now) {
  const s = p.massBonus;
  if (p.dead || p.mass <= 5000) {
    s.since = null;
    s.min = 0;
    return null;
  }
  if (s.since === null) {
    s.since = now;
    s.min = p.mass;
    return null;
  }
  s.min = Math.min(s.min, p.mass);
  if (now - s.since < 60000) return null;
  // Один серверный интервал: остановка сервера не доказывает удержание массы.
  const kills = reward(s.min);
  s.since = now;
  s.min = p.mass;
  s.sequence++;
  return { type: "massBonus", playerId: p.id, lifeId: p.lifeId, sequence: s.sequence, kills };
}
module.exports = { TIERS, reward, reset, sample };
