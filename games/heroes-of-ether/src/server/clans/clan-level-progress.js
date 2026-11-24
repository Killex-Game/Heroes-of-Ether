/* Расчёт уровня клана и прогресса до следующего уровня. */
"use strict";
const LEVEL_COSTS = Object.freeze([
  30000, 100000, 300000, 500000, 750000, 1000000, 1500000, 2000000, 2500000, 3000000,
  4000000, 5000000, 7500000, 10000000,
]);
function clanProgress(xp) {
  if (!Number.isSafeInteger(xp) || xp < 0) throw Error("Неверный опыт клана.");
  let level = 1,
    rest = xp;
  for (const cost of LEVEL_COSTS) {
    if (rest < cost) return { level, totalXp: xp, levelXp: rest, nextLevelXp: cost };
    rest -= cost;
    level++;
  }
  return { level, totalXp: xp, levelXp: rest, nextLevelXp: null };
}
const CAPACITY_BANDS = Object.freeze(
  [
    [1, 15],
    [2, 20],
    [3, 30],
    [4, 40],
    [15, 50],
  ].map(Object.freeze),
);
function clanCapacity(xp = 0) {
  const { level } = clanProgress(xp);
  return CAPACITY_BANDS.find(([last]) => level <= last)[1];
}
module.exports = { clanProgress, clanCapacity, CAPACITY_BANDS, LEVEL_COSTS };
