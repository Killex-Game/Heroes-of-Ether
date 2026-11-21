"use strict";
const { groupForLevel } = require("../../../public/shared/arena-names");
// Shared by simulation and quest eligibility: one authoritative mass limit.
const massLimitForLevel = (level) =>
  level <= 25 ? 5000 : level <= 120 ? 18000 : level <= 500 ? 24000 : 30000;
function totalMassLimitForLevel(level) {
  const current = Number.isSafeInteger(level) && level > 0 ? level : 1;
  return massLimitForLevel(current) * groupForLevel(current).maxParts;
}
module.exports = { massLimitForLevel, totalMassLimitForLevel };
