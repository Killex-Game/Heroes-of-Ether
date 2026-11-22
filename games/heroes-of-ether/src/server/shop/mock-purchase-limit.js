"use strict";
const { BoosterError } = require("../boosters/booster-catalog");
const { loginRewardDay, loginRewardResetAt } = require("../accounts/account-benefits");
const { mockDailyPurchaseLimit: LIMIT } = require("../../../public/shared/virtual-product-catalog");
const cache = new WeakMap();

// The durable payment journal is the source of truth, including purchases
// before this rule was installed. No counter migration or timer is needed.
function used(profile, at) {
  const entries = profile.transactions?.entries;
  if (!entries) return 0;
  const day = loginRewardDay(at), saved = cache.get(entries);
  if (saved?.day === day) return saved.count;
  const end = loginRewardResetAt(at), start = end - 86400000, seen = new Set();
  for (let index = entries.length - 1; index >= 0; index--) {
    const e = entries[index], payment = e.payment;
    if (e.at < start || e.at >= end || payment?.provider !== "mock" ||
        payment.simulated !== true || payment.status !== "confirmed") continue;
    seen.add(e.requestId || e.id);
    if (seen.size >= LIMIT) break;
  }
  cache.set(entries, { day, count: seen.size });
  return seen.size;
}
function assertAvailable(profile, at) {
  if (used(profile, at) < LIMIT) return;
  throw Object.assign(new BoosterError(`На сегодня использованы все ${LIMIT} тестовых покупок.`, 429), {
    code: "MOCK_DAILY_LIMIT",
    nextPurchaseAt: loginRewardResetAt(at),
    retryAfter: Math.max(1, Math.ceil((loginRewardResetAt(at) - at) / 1000)),
  });
}
module.exports = { used, assertAvailable, LIMIT };
