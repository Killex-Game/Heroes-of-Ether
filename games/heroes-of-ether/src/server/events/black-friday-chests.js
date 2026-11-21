"use strict";
const { randomUUID } = require("node:crypto");
const treasury = require("../progression/treasury-capacity");
const bonuses = require("../progression/chest-bonuses");
const accounts = require("../accounts/account-benefits");
const { BOOSTERS, BoosterError } = require("../boosters/booster-catalog");
const integer = n => Number.isSafeInteger(n) && n >= 0;
const COINS = 250, CRYSTALS = 50, BOOSTER_COUNT = 15, ETHER = 5, ETHER_CHANCE = 5;
const tiers = { common: "обычных", advanced: "улучшенных", rare: "редких", clan: "клановых" };
const pools = Object.fromEntries(Object.keys(tiers).map(tier => [tier,
  [...BOOSTERS.values()].filter(b => b.tier === tier && b.ready).map(b => b.id)]));
const vipChance = (p, runId) => p.blackFriday?.runs?.[runId]?.couponAt != null ? 4 : 2;
function contents(p, runId, at, manager, reward = null) {
  const factor = reward?.multiplier || bonuses.multiplier(p, at);
  const lines = [`${COINS * factor} монет`, `${CRYSTALS * factor} кристаллов`];
  // A previously revealed chest keeps its original contents, including old draws.
  if (!reward || reward.version === 2) {
    for (const name of Object.values(tiers)) lines.push(`${BOOSTER_COUNT * factor} ${name} бустеров`);
    lines.push(`${ETHER * factor} эфира: ${ETHER_CHANCE}%`);
  }
  lines.push(`VIP на 1 час: ${reward?.chance || vipChance(p, runId)}%`);
  const tokens = require("./black-friday").chestTokenBonus(p, manager, at, "friday");
  if (tokens) lines.push(`${tokens} жетонов`);
  return lines.join("\n");
}
function grant(p, runId, at) {
  p.blackFriday ||= { runs: {} };
  const rows = (p.blackFriday.chests ||= []);
  const c = { id: "friday-" + randomUUID(), runId, at, receivedAt: at, stored: false };
  rows.push(c);
  treasury.queue(p, c, at);
  treasury.fill(p, at);
}
function act(p, input, at, random) {
  treasury.fill(p, at);
  const c = p.blackFriday?.chests?.find(c => c.id === input.id && c.runId === input.runId);
  if (!c?.stored) throw new BoosterError("Сундук не найден в Сокровищнице.", 409);
  // Seal odds, currencies and the random draw before showing any loot.
  // Coupon ownership is tied to the chest's event and survives that event's end.
  if (!c.reward) {
    const chance = vipChance(p, c.runId);
    const multiplier = bonuses.multiplier(p, at);
    const vipMs = random(100) < chance ? 3600000 : 0;
    const bucks = random(100) < ETHER_CHANCE ? ETHER * multiplier : 0;
    const items = {};
    for (const pool of Object.values(pools)) {
      for (let i = 0; i < BOOSTER_COUNT; i++) {
        const id = pool[random(pool.length)];
        items[id] = (items[id] || 0) + multiplier;
      }
    }
    c.reward = { version: 2, multiplier, chance, coins: COINS * multiplier,
      crystals: CRYSTALS * multiplier, vipMs, bucks, items };
  }
  if (input.action === "prepare") return;
  for (const key of ["coins", "crystals", "bucks"]) {
    const value = p.wallet[key] + (c.reward[key] || 0);
    if (!integer(value)) throw new BoosterError("Достигнут предел валюты.", 409);
    p.wallet[key] = value;
  }
  for (const [id, count] of Object.entries(c.reward.items || {})) {
    const value = (p.inventory[id] || 0) + count;
    if (!integer(value)) throw new BoosterError("Достигнут предел бустеров.", 409);
    p.inventory[id] = value;
  }
  if (c.reward.vipMs) {
    p.account ||= accounts.fresh();
    p.account.vipUntil = Math.max(at, p.account.vipUntil || 0) + c.reward.vipMs;
    if (!integer(p.account.vipUntil)) throw new BoosterError("Достигнут предел срока VIP.", 409);
  }
  p.blackFriday.chests = p.blackFriday.chests.filter(row => row.id !== c.id);
  treasury.fill(p, at);
}
function view(p, config, at, manager) {
  return (p.blackFriday?.chests || []).map(c => ({
    id: c.id, runId: c.runId, stored: c.stored, expiresAt: c.expiresAt,
    contents: contents(p, c.runId, at, manager, c.reward),
    reward: c.reward ? bonuses.preview({ items: {}, ...c.reward, id: c.id }, p, config, at, manager, "friday") : null,
  }));
}
function validate(p) {
  if (p.blackFriday?.chests === undefined) return;
  const rows = p.blackFriday.chests;
  if (!Array.isArray(rows) || new Set(rows.map(c => c?.id)).size !== rows.length)
    throw Error("Повреждены сундуки Чёрной пятницы.");
  for (const c of rows) {
    const r = c.reward;
    if (!c || typeof c.id !== "string" || !/^friday-[a-f0-9-]{36}$/.test(c.id) ||
        !Object.hasOwn(p.blackFriday.runs, c.runId) || !integer(c.at) || !integer(c.receivedAt) ||
        typeof c.stored !== "boolean" || !treasury.validStorage(c) ||
        (r && (![1, 2, 3, 4].includes(r.multiplier) || ![2, 4].includes(r.chance) ||
        r.coins !== COINS * r.multiplier || r.crystals !== CRYSTALS * r.multiplier ||
        ![0, 3600000].includes(r.vipMs))))
      throw Error("Повреждена награда сундука Чёрной пятницы.");
    if (r) {
      if (r.version === undefined) {
        if (r.bucks !== undefined || r.items !== undefined)
          throw Error("Повреждена прежняя награда сундука Чёрной пятницы.");
      } else {
        const totals = Object.fromEntries(Object.keys(tiers).map(tier => [tier, 0]));
        if (r.version !== 2 || ![0, ETHER * r.multiplier].includes(r.bucks) ||
            !r.items || typeof r.items !== "object" || Array.isArray(r.items))
          throw Error("Повреждён состав сундука Чёрной пятницы.");
        for (const [id, count] of Object.entries(r.items)) {
          const tier = BOOSTERS.get(id)?.tier;
          if (!Object.hasOwn(totals, tier) || !integer(count) || !count || count % r.multiplier)
            throw Error("Повреждены бустеры сундука Чёрной пятницы.");
          totals[tier] += count;
        }
        if (Object.values(totals).some(count => count !== BOOSTER_COUNT * r.multiplier))
          throw Error("Неверное количество бустеров сундука Чёрной пятницы.");
      }
    }
  }
}
module.exports = { grant, act, view, validate, contents };
