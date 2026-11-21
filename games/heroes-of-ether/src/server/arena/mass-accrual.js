/* Накопление только за наблюдавшееся время жизни, без оплаты пауз сервера. */
"use strict";
const alchemy = require("./alchemy-effects");
const XP_DENOMINATOR = 90000000,
  KILL_DENOMINATOR = 300000000,
  PAYOUT_INTERVAL_MS = 30000,
  POPULATION_MASS = 30000,
  BASE_XP = 25,
  LARGE_MASS_XP = 50,
  BASE_KILLS = 1,
  LARGE_MASS_KILLS = 2;
// Знаменатели сохраняют совместимость уже записанных дробных остатков.
const accountFactor = (account) =>
  account?.premium ? 3 : account?.vip ? 2 : 1;
function reset(p, now) {
  p.massAccrual = {
    at: now,
    emittedAt: now,
    mass: p.mass,
    factor: accountFactor(p.account),
    xpUnits: 0,
    giftXp: p.giftModifiers?.xp ?? 1,
    potionXpPercent: 100 + Math.round((alchemy.modifiers(p).xp || 0) * 100),
    baseXpUnits: 0,
    killUnits: 0,
    sequence: 0,
  };
}
function sample(p, now, force = false, playerCount = 1) {
  // Завершение жизни сжигает незачисленный пакет, а не выдаёт его досрочно.
  if (force) {
    if (p.massAccrual)
      p.massAccrual.xpUnits = p.massAccrual.baseXpUnits = p.massAccrual.killUnits = 0;
    return null;
  }
  if (p.dead || p.isRemnant || !Number.isFinite(now)) return null;
  if (!p.massAccrual) {
    reset(p, now);
    return null;
  }
  const s = p.massAccrual,
    elapsed = Math.floor(now - s.at),
    mass = Math.min(s.mass, p.mass);
  if (elapsed > 0 && elapsed <= 250) {
    const baseXp = mass >= POPULATION_MASS ? LARGE_MASS_XP : BASE_XP,
      baseKills = mass >= POPULATION_MASS ? LARGE_MASS_KILLS : BASE_KILLS,
      population = mass >= POPULATION_MASS && Number.isFinite(playerCount)
        ? Math.max(0, Math.floor(playerCount)) : 0,
      factor = Math.min(s.factor, accountFactor(p.account)),
      xpTime = elapsed * (XP_DENOMINATOR / PAYOUT_INTERVAL_MS),
      giftXp = s.giftXp ?? 1,
      potionXpPercent = s.potionXpPercent ?? 100;
    // Аккаунт умножает только базу; население своей комнаты добавляется после.
    s.xpUnits += Math.floor((baseXp * factor + population) * xpTime * giftXp * potionXpPercent / 100);
    s.baseXpUnits += Math.floor((baseXp + population) * xpTime * giftXp * potionXpPercent / 100);
    s.killUnits += Math.floor(
      (baseKills * factor + population) * elapsed * (KILL_DENOMINATOR / PAYOUT_INTERVAL_MS),
    );
  }
  s.giftXp = p.giftModifiers?.xp ?? 1;
  s.potionXpPercent = 100 + Math.round((alchemy.modifiers(p).xp || 0) * 100);
  s.at = now;
  s.mass = p.mass;
  s.factor = accountFactor(p.account);
  if (now - s.emittedAt < PAYOUT_INTERVAL_MS) return null;
  s.emittedAt = now;
  if (!s.xpUnits && !s.killUnits) return null;
  const event = {
    type: "massAccrual",
    playerId: p.id,
    lifeId: p.lifeId,
    sequence: ++s.sequence,
    xpUnits: s.xpUnits,
    baseXpUnits: s.baseXpUnits,
    killUnits: s.killUnits,
  };
  s.xpUnits = s.baseXpUnits = s.killUnits = 0;
  return event;
}
module.exports = {
  XP_DENOMINATOR,
  KILL_DENOMINATOR,
  PAYOUT_INTERVAL_MS,
  POPULATION_MASS,
  BASE_XP,
  LARGE_MASS_XP,
  BASE_KILLS,
  LARGE_MASS_KILLS,
  reset,
  sample,
};
