"use strict";
const { gifts } = require("./gift-catalog");
const effects = gifts.filter((g) => g.stat),
  cache = new WeakMap();
const neutral = Object.freeze({ xp: 1, speed: 1, outgoing: 1, incoming: 1, until: Infinity });
function modifiers(profile, at) {
  if (!profile?.social?.giftEffects) return neutral;
  const saved = profile.social.giftEffects,
    cached = cache.get(profile);
  if (cached && cached.saved === saved && at >= cached.at && at < cached.value.until)
    return cached.value;
  const value = { ...neutral };
  for (const gift of effects) {
    const until = saved[gift.id] || 0;
    if (until > at) {
      value[gift.stat] += gift.percent / 100;
      value.until = Math.min(value.until, until);
    }
  }
  cache.set(profile, { saved, at, value });
  return value;
}
function arena(player, key) {
  return player?.giftModifiers?.[key] ?? 1;
}
function adjust(booster, factor) {
  if (factor === 1) return booster;
  const result = { ...booster, effectFactor: (booster.effectFactor || 1) * factor };
  for (const key of ["durationMs", "heldMs", "amount", "pushDistance"])
    if (Number.isFinite(result[key])) result[key] = Math.max(1, Math.floor(result[key] * factor));
  if (Number.isFinite(result.fireFraction)) result.fireFraction *= factor;
  for (const key of ["fraction", "splitLimitDamage", "growthFraction", "speedBonus"])
    if (Number.isFinite(result[key])) result[key] *= factor;
  if (Number.isFinite(result.multiplier))
    result.multiplier = Math.max(0, 1 + (result.multiplier - 1) * factor);
  return result;
}
module.exports = { modifiers, arena, adjust, neutral };
