/* Полный наблюдавшийся 30-секундный такт, масса и статус на момент выплаты. */
"use strict";
const alchemy = require("./alchemy-effects");
// Старые знаменатели нужны для воспроизведения уже записанных событий и остатков.
const XP_DENOMINATOR = 90000000, KILL_DENOMINATOR = 300000000,
  PAYOUT_INTERVAL_MS = 30000;
const roundRatio = (units, denominator) =>
  Math.floor(units / denominator) + (units % denominator > denominator / 2 ? 1 : 0);
function reset(p, now) {
  p.massAccrual = { at: now, observedMs: 0, sequence: 0,
    xpUnits: 0, baseXpUnits: 0, killUnits: 0 };
}
function sample(p, now, force = false, playerCount = 1) {
  if (force) {
    if (p.massAccrual) Object.assign(p.massAccrual,
      { observedMs: 0, xpUnits: 0, baseXpUnits: 0, killUnits: 0 });
    return null;
  }
  if (p.dead || p.isRemnant || !Number.isFinite(now)) return null;
  if (!p.massAccrual) { reset(p, now); return null; }
  const s = p.massAccrual, elapsed = now - s.at;
  if (elapsed <= 0) return null;
  s.at = now;
  // Долгая пауза не даёт догоняющих наград. Незавершённое активное время сохраняется.
  if (elapsed > 250) return null;
  s.observedMs += elapsed;
  if (s.observedMs < PAYOUT_INTERVAL_MS) return null;
  s.observedMs -= PAYOUT_INTERVAL_MS;
  const mass = Number.isFinite(p.mass) ? Math.max(0, p.mass) : 0,
    population = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0,
    xpFactor = p.account?.vip ? 3 : 1,
    killFactor = p.account?.premium ? 2 : 1,
    xpEffects = (p.giftModifiers?.xp ?? 1) * (1 + (alchemy.modifiers(p).xp || 0)),
    baseXpUnits = Math.round(mass * (XP_DENOMINATOR / 1000) * xpEffects);
  return { type: "massAccrual", ruleVersion: 4, playerId: p.id, lifeId: p.lifeId,
    sequence: ++s.sequence, xpUnits: baseXpUnits, baseXpUnits, xpMultiplier: xpFactor,
    killUnits: Math.round((mass * (KILL_DENOMINATOR / 10000) + population * KILL_DENOMINATOR) * killFactor) };
}
module.exports = { XP_DENOMINATOR, KILL_DENOMINATOR, PAYOUT_INTERVAL_MS, roundRatio, reset, sample };
