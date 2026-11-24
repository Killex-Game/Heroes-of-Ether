/* Сроки VIP/Premium, множители наград и ежедневные бонусы. */
"use strict";
const WEEK = 7 * 86400000;
const { accountLoginRewards } = require("../../../public/shared/virtual-product-catalog");
const loginRewardDay = (at) => Math.floor((at + 3 * 3600000) / 86400000);
const loginRewardResetAt = (at) => (loginRewardDay(at) + 1) * 86400000 - 3 * 3600000;
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
function benefits(p, at = Date.now()) {
  const vip = (p.account?.vipUntil || 0) > at,
    premium = (p.account?.premiumUntil || 0) > at;
  return {
    vip,
    premium,
    startMass: (vip ? 50 : 0) + (premium ? 100 : 0) || 20,
    xpPercent: vip ? 100 : 0,
    absorptionXpMultiplier: vip ? 2 : 1,
    greatnessMultiplier: premium ? 2 : 1,
    chestMultiplier: vip ? 2 : 1,
    weeklyRewardMultiplier: vip ? 2 : 1,
    slotBonus: vip || premium ? 3 : 0,
    turboMs: vip ? 120000 : 0,
    clanChestGreatnessBonus: (vip ? 5 : 0) + (premium ? 10 : 0),
  };
}
function validate(p) {
  if (p.account === undefined) return;
  const a = p.account;
  if (
    !a ||
    Array.isArray(a) ||
    ![a.vipUntil, a.premiumUntil, a.dailyAmount].every(integer) ||
    !(a.dailyDay === null || integer(a.dailyDay)) ||
    a.dailyAmount > 30
  )
    throw Error("Повреждены сроки VIP/Premium.");
  if (a.currencyClaims !== undefined) {
    const claims = a.currencyClaims;
    if (
      !claims ||
      typeof claims !== "object" ||
      Array.isArray(claims) ||
      Object.keys(claims).some((kind) => !Object.hasOwn(accountLoginRewards, kind))
    )
      throw Error("Повреждены ежедневные бонусы статуса.");
    for (const [kind, currencies] of Object.entries(claims)) {
      if (
        !currencies ||
        typeof currencies !== "object" ||
        Array.isArray(currencies) ||
        Object.entries(currencies).some(
          ([currency, day]) => !Object.hasOwn(accountLoginRewards[kind], currency) || !integer(day),
        )
      )
        throw Error("Повреждены ежедневные бонусы статуса.");
    }
  }
}
function fresh() {
  // Старые отметки входа сохраняются для совместимости; величие за вход больше не выдаётся.
  return { vipUntil: 0, premiumUntil: 0, dailyDay: null, dailyAmount: 0 };
}
function publicAccount(p, at = Date.now()) {
  const today = loginRewardDay(at);
  return {
    ...benefits(p, at),
    vipUntil: p.account?.vipUntil || 0,
    premiumUntil: p.account?.premiumUntil || 0,
    currencyBonusResetAt: loginRewardResetAt(at),
    currencyBonuses: Object.fromEntries(
      Object.entries(accountLoginRewards).map(([kind, rewards]) => [
        kind,
        Object.fromEntries(
          Object.entries(rewards).map(([currency, amount]) => [
            currency,
            { amount, claimed: (p.account?.currencyClaims?.[kind]?.[currency] ?? -1) >= today },
          ]),
        ),
      ]),
    ),
  };
}
module.exports = { WEEK, benefits, validate, fresh, publicAccount, loginRewardDay, loginRewardResetAt };
