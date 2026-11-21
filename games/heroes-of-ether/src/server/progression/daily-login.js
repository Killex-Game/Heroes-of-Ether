"use strict";
const { randomInt } = require("node:crypto");
const accounts = require("../accounts/account-benefits");
const { POOLS } = require("./title-chest-rewards");

const rewards = require("../../../public/shared/daily-login-rewards");
function validate(stamp) {
  if (
    stamp !== undefined &&
    (!stamp ||
      !Number.isSafeInteger(stamp.date) ||
      stamp.date < 0 ||
      !Number.isInteger(stamp.day) ||
      stamp.day < 1 ||
      stamp.day > rewards.length)
  )
    throw Error("Повреждены данные ежедневного бонуса.");
}
function due(profile, at) {
  return !profile.loginReward || profile.loginReward.date < accounts.loginRewardDay(at);
}
function preview(profile, at) {
  if (!due(profile, at)) return null;
  const date = accounts.loginRewardDay(at);
  const day =
    profile.loginReward?.date === date - 1 ? (profile.loginReward.day % rewards.length) + 1 : 1;
  const reward = rewards[day - 1];
  return { date, day, reward };
}
function grant(profile, at, roll = randomInt) {
  const pending = preview(profile, at);
  if (!pending) return null;
  const { date, day, reward } = pending;
  const items = {};
  for (const [kind, amount] of Object.entries(reward)) {
    if (kind === "vipHours") {
      profile.account ||= accounts.fresh();
      profile.account.vipUntil = Math.max(at, profile.account.vipUntil) + amount * 3600000;
    } else if (kind === "rare" || kind === "advanced") {
      for (let i = 0; i < amount; i++) {
        const id = POOLS[kind][roll(POOLS[kind].length)];
        items[id] = (items[id] || 0) + 1;
      }
    } else profile.wallet[kind] += amount;
  }
  for (const [id, qty] of Object.entries(items))
    profile.inventory[id] = (profile.inventory[id] || 0) + qty;
  if (
    ![...Object.values(profile.wallet), ...Object.values(profile.inventory)].every(
      Number.isSafeInteger,
    )
  )
    throw Error("Баланс достиг предела.");
  accounts.validate(profile);
  profile.loginReward = { date, day };
  return { day, reward, items };
}
module.exports = { validate, due, preview, grant };
