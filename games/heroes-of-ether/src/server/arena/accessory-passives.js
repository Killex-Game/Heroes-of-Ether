"use strict";
const catalog = require("../../../public/shared/accessory-catalog");
const petRules = require("../../../public/shared/pet-rules");
function speed(p, now) {
  return (
    Math.min(
      8,
      (p.mass < 5000 ? catalog.bonus(p.outfit, "lightSpeed") : 0) +
        (p.accessoryFeedUntil > now ? catalog.bonus(p.outfit, "feedSpeed") : 0) +
        (p.accessoryShieldUntil > now ? catalog.bonus(p.outfit, "shieldSpeed") : 0),
    ) / 100
  );
}
function shieldBroken(p, now, attackerId) {
  if (
    attackerId === p.id ||
    !catalog.bonus(p.outfit, "shieldSpeed") ||
    (p.accessoryShieldReadyAt || 0) > now
  )
    return;
  p.accessoryShieldUntil = now + 3000;
  p.accessoryShieldReadyAt = now + 20000;
}
function petReserve(vitality, outfit) {
  return Math.floor((vitality * catalog.bonus(outfit, "petTime")) / 100);
}
// Отдельный запас жизни: не записывается в постоянную живучесть и не усиливает корм.
function advancePet(state, capacity, from, to, life) {
  const used = Math.min(Math.max(0, to - from), life.accessoryPetMs || 0);
  life.accessoryPetMs = Math.max(0, (life.accessoryPetMs || 0) - used);
  return used + petRules.advance(state, capacity, from + used, to, true);
}
module.exports = { speed, shieldBroken, petReserve, advancePet };
