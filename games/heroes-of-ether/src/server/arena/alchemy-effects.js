"use strict";
const rules = require("../../../public/shared/alchemy-rules");
const { BOOSTER_RULES } = require("../boosters/booster-catalog");
const gifts = require("../profiles/gift-effects");
const accessories = require("../../../public/shared/accessory-catalog");
const neutral = Object.freeze({});
function modifiers(p) {
  if (!p?.potion) return neutral;
  const factor = Math.max(1, accessories.bonus(p.outfit, "potionFactor"));
  if (!p.potion.modifiers || p.potion.accessoryFactor !== factor) {
    p.potion.modifiers = rules.combine(rules.activeIds(p.potion), factor);
    p.potion.accessoryFactor = factor;
  }
  return p.potion.modifiers;
}
function prepare(p, booster, now, allowPulse = true) {
  const mods = modifiers(p);
  const pulse = !!(allowPulse && mods.pulseMs && p.potion.readyAt <= now &&
    booster.kind !== "sponge" && booster.kind !== "potion");
  if (mods === neutral || booster.kind === "potion") return { booster, pulse: false };
  const pulseFactor = pulse ? (mods.pulseFactor || 2) : 1;
  let result = pulse ? gifts.adjust(booster, pulseFactor) : booster;
  const change = () => { if (result === booster) result = { ...booster }; return result; };
  if (booster.kind === "mass" && mods.mass) change().amount *= 1 + mods.mass;
  if (mods.positiveDuration && ["speed", "shield", "easter_growth", "vortex", "cake"].includes(booster.kind))
    change().durationMs = Math.floor(result.durationMs * (1 + mods.positiveDuration));
  if (booster.flightMs) {
    change().flightSpeed = (booster.flightSpeed || BOOSTER_RULES.FLIGHT_SPEED) * pulseFactor * (1 + (mods.projectileSpeed || 0));
    // Keep lifetime and travel consistent even for boosters without an explicit range.
    const range = (booster.maxDistance || (booster.flightSpeed || BOOSTER_RULES.FLIGHT_SPEED) * booster.flightMs / 1000) * pulseFactor * (1 + (mods.range || 0));
    result.maxDistance = range;
    result.flightMs = range / result.flightSpeed * 1000;
  }
  if (pulse && booster.kind === "pull") change().alchemyPullFactor = pulseFactor;
  if (pulse && booster.kind === "fire") change().alchemyFireFactor = pulseFactor;
  return { booster: result, pulse, potionId: p.potion?.id };
}
function commit(p, prepared, now) {
  if (prepared.pulse && p.potion?.id === prepared.potionId)
    p.potion.readyAt = now + modifiers(p).pulseMs;
}
function incoming(p, booster) {
  const reduction = modifiers(p).negativeDuration;
  if (!reduction || !booster.durationMs || ["cake", "vortex", "shield", "speed"].includes(booster.kind)) return booster;
  return { ...booster, durationMs: Math.max(1, Math.floor(booster.durationMs * (1 - reduction))) };
}
function food(p, raw, base) {
  const bonus = modifiers(p).food;
  if (!bonus) return base;
  const units = raw * Math.round(bonus * 100) + (p.alchemyFoodRemainder || 0);
  p.alchemyFoodRemainder = units % 100;
  return base + Math.floor(units / 100);
}
module.exports = { modifiers, prepare, commit, incoming, food };
