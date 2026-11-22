"use strict";
const catalog = require("../../../public/shared/accessory-catalog");
const petRules = require("../../../public/shared/pet-rules");
const gifts = require("../profiles/gift-effects");
const positiveKinds = new Set(["mass", "speed", "shield", "easter_growth", "cake", "sponge", "vortex"]);
function outgoing(p, booster) {
  const positive = positiveKinds.has(booster.kind) || (booster.kind === "pull" && booster.pullTarget === "self");
  const factor = 1 + catalog.bonus(p.outfit, positive ? "positive" : "attack") / 100;
  const result = gifts.adjust(booster, factor);
  if (factor !== 1 && booster.kind === "pull")
    return { ...result, accessoryPullFactor: factor };
  return result;
}
function incoming(p, booster) {
  if (positiveKinds.has(booster.kind)) return booster;
  const factor = Math.max(0, 1 - catalog.bonus(p.outfit, "negativeReduction") / 100);
  const result = gifts.adjust(booster, factor);
  return factor !== 1 && booster.kind === "pull"
    ? { ...result, accessoryPullFactor: (result.accessoryPullFactor || 1) * factor } : result;
}
function start(arena, p, now) {
  if (p.accessoryLife === p.lifeId) return;
  p.accessoryLife = p.lifeId;
  p.accessoryMassAt = now;
  p.accessoryMassElapsed = 0;
  const mass = catalog.bonus(p.outfit, "spawnMass");
  if (mass) arena.gainMass(p, mass, undefined, now);
}
function tick(arena, p, now) {
  if (p.dead || p.isRemnant || p.accessoryLife !== p.lifeId) return;
  const elapsed = now - p.accessoryMassAt;
  p.accessoryMassAt = now;
  // Only observed live time counts; a stalled or suspended process cannot pay minutes in bulk.
  if (elapsed <= 0 || elapsed > 250) return;
  p.accessoryMassElapsed += elapsed;
  if (p.accessoryMassElapsed < 60000) return;
  p.accessoryMassElapsed -= 60000;
  const mass = catalog.bonus(p.outfit, "minuteMass");
  if (mass) require("../pets/arena-pets").gainMassEvenly(arena, p, mass, now);
}
function speed(p, now) {
  return (
    catalog.bonus(p.outfit, "speed") / 100 +
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
module.exports = { speed, shieldBroken, petReserve, advancePet, outgoing, incoming, start, tick };
