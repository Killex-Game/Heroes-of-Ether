"use strict";
const accounts = require("../accounts/account-benefits");
const lite = require("../accounts/lite-account");
const { BoosterError } = require("../boosters/booster-catalog");

// Общая политика только наградных сундуков. Покупные наборы и акции сюда не входят.
const multiplier = (p, at) => accounts.benefits(p, at).chestMultiplier;
function scale(base, factor) {
  if (![1, 2, 3, 4].includes(factor)) throw new BoosterError("Неверный множитель сундука.");
  const amount = (n) => {
    if (Array.isArray(n)) return n.map(amount);
    if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(n * factor))
      throw new BoosterError("Превышен допустимый размер награды.", 409);
    return n * factor;
  };
  const result = structuredClone(base);
  for (const key of [
    "coins",
    "crystals",
    "bucks",
    "greatness",
    "boosters",
    "boosterCount",
    "common",
    "advanced",
    "rare",
  ])
    if (base[key] !== undefined) result[key] = amount(base[key]);
  if (base.items)
    result.items = Object.fromEntries(Object.entries(base.items).map(([id, n]) => [id, amount(n)]));
  return result;
}
const ticketBonus = (p, config, at) => (config && lite.view(p, config, at).active ? 1 : 0);
function preview(reward, p, config, at, manager, source) {
  const result = structuredClone(reward),
    extra = ticketBonus(p, config, at);
  if (extra) result.tickets = (result.tickets || 0) + extra;
  const tokens = require("../events/black-friday").chestTokenBonus(p, manager, at, source);
  if (tokens) result.fridayTokens = tokens;
  return result;
}
// Вызывать внутри ProfileStore.transact: билет и содержимое фиксируются одной записью.
function opened(p, config, at, manager, source) {
  lite.grantTickets(p, ticketBonus(p, config, at));
  require("../events/black-friday").rewardChest(p, manager, at, source);
}
module.exports = { multiplier, scale, ticketBonus, preview, opened };
