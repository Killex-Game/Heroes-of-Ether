/* Титулы, величие и содержимое сундуков за титулы. */
"use strict";
const { BoosterError } = require("../boosters/booster-catalog");
const accounts = require("../accounts/account-benefits");
const { randomInt } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const RARITY_SHARES = Object.freeze({
  novice: { common: 100 },
  experienced: { common: 50, advanced: 50 },
  expert: { common: 30, advanced: 70 },
  sage: { common: 10, advanced: 40, rare: 50 },
  master: { advanced: 30, rare: 40, clan: 30 },
  pro: { advanced: 10, rare: 40, clan: 50 },
  prince: { advanced: 5, rare: 30, clan: 65 },
  king: { rare: 30, clan: 70 },
  emperor: { advanced: 1, rare: 29, clan: 70 },
  boss: { clan: 100 },
});
const RARITY_NAMES = {
  common: "Обычные",
  advanced: "Улучшенные",
  rare: "Редкие",
  clan: "Клановые",
};
// Баланс 21.10.2026: пороги по величию; Мудрец — IV степень, Мастер — V.
// Последние три числа — монеты, кристаллы и эфир без множителя аккаунта.
const TITLES = Object.freeze(
  [
    ["novice", "Новичок", 100, 1, 50, 500, 50, 5],
    ["experienced", "Опытный", 5000, 5, 125, 2500, 125, 125],
    ["expert", "Знаток", 25000, 10, 250, 5000, 250, 250],
    ["sage", "Мудрец", 100000, 50, 1250, 7500, 500, 375],
    ["master", "Мастер", 250000, 100, 2500, 15000, 1250, 500],
    ["pro", "Профи", 500000, 250, 3750, 25000, 2500, 500],
    ["prince", "Принц", 750000, 500, 3750, 37500, 3750, 1250],
    ["king", "Король", 1000000, 500, 7500, 50000, 5000, 2500],
    ["emperor", "Император", 1500000, 500, 12500, 125000, 12500, 5000],
    ["boss", "Герой", 2000000, 1000, 250000, 250000, 25000, 10000],
  ].map(([id, name, threshold, reward, boosters, coins, crystals, bucks], i) =>
    Object.freeze({
      id,
      name,
      chestName:
        "Сундук " +
        [
          "Новичка",
          "Опытного",
          "Знатока",
          "Мудреца",
          "Мастера",
          "Профи",
          "Принца",
          "Короля",
          "Императора",
          "героя",
        ][i],
      degree: i + 1,
      threshold,
      reward: 0,
      boosters,
      coins,
      crystals,
      bucks,
      contents: Object.entries(RARITY_SHARES[id])
        .map(([tier, percent]) => `${RARITY_NAMES[tier]} ${percent}%`)
        .join(", "),
      reason: "",
    }),
  ),
);
const NOVICE_ITEMS = Object.freeze({ ice_cream: 40, candy: 40, colorful_shield: 20 });
// Валюта уже подготовленных наград v1–v4 не зависит от нового каталога.
const PREVIOUS_CURRENCIES = Object.freeze({
  novice: [1000, 100, 10],
  experienced: [5000, 250, 250],
  expert: [10000, 500, 500],
  sage: [15000, 1000, 750],
  master: [30000, 2500, 1000],
  pro: [50000, 5000, 1000],
  prince: [75000, 7500, 2500],
  king: [100000, 10000, 5000],
  emperor: [250000, 25000, 10000],
  boss: [500000, 50000, 20000],
});
// Уже показанные награды старых версий сохраняют свой состав после смены баланса.
const PREVIOUS_BOOSTER_TOTALS = Object.freeze({
  2: Object.freeze({
    novice: 100,
    experienced: 500,
    expert: 1000,
    sage: 2500,
    master: 5000,
    pro: 7500,
    prince: 7500,
    king: 10000,
    emperor: 25000,
    boss: 500000,
  }),
  3: Object.freeze({
    novice: 200,
    experienced: 500,
    expert: 1000,
    sage: 5000,
    master: 10000,
    pro: 15000,
    prince: 15000,
    king: 30000,
    emperor: 50000,
    boss: 1000000,
  }),
});
// Фиксированные списки: появление нового товара не меняет сохранённые награды.
const POOLS = Object.freeze({
  common: ["freeze", "colorful_shield", "hook", "ice_cream", "candy", "rocket", "glove"],
  advanced: ["web", "sphere", "poison", "donut", "speed", "mine", "lock"],
  rare: ["harpoon", "axe", "stone", "meat", "knuckles", "golden_shield", "mega_poison", "sponge"],
  clan: ["fire", "cake", "warheads", "vortex", "awl", "clan_shield", "fire_sword"],
});
function distribute(total, ids) {
  return Object.fromEntries(
    ids.map((id, i) => [id, Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0)]),
  );
}
function mixed(total, tiers) {
  return Object.assign(
    {},
    ...tiers.map((tier, i) =>
      distribute(
        Math.floor(total / tiers.length) + (i < total % tiers.length ? 1 : 0),
        POOLS[tier],
      ),
    ),
  );
}
// Только для совместимости: уже подготовленные награды не пересчитываются.
const LEGACY_CHEST_ITEMS = Object.freeze({
  novice: NOVICE_ITEMS,
  experienced: distribute(500, POOLS.clan),
  expert: mixed(1000, ["common", "advanced", "rare", "clan"]),
  sage: mixed(2500, ["common", "advanced", "rare", "clan"]),
  master: mixed(5000, ["common", "advanced", "rare", "clan"]),
  pro: { ...mixed(3000, ["common", "advanced", "rare"]), ...distribute(4500, POOLS.clan) },
});
const ACCOUNT_DAYS = Object.freeze({
  experienced: { vip: 3 },
  expert: { premium: 3 },
  sage: { vip: 7 },
  master: { premium: 7 },
  pro: { vip: 30 },
  prince: { premium: 30 },
  king: { premium: 30 },
  emperor: { vip: 30, premium: 30 },
  boss: { vip: 90, premium: 90 },
});
function rarityTotals(title) {
  const quotas = Object.entries(title.rarityShares || RARITY_SHARES[title.id]).map(
    ([tier, percent], index) => {
      const exact = (title.boosters * percent) / 100;
      return { tier, index, count: Math.floor(exact), fraction: exact % 1 };
    },
  );
  // Дробные доли округляем по наибольшему остатку, сохраняя общее число предметов.
  const remainder = title.boosters - quotas.reduce((total, quota) => total + quota.count, 0);
  const order = [...quotas].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) order[i].count++;
  return Object.fromEntries(quotas.map(({ tier, count }) => [tier, count]));
}
function randomItems(title, random = randomInt) {
  const items = {};
  for (const [tier, total] of Object.entries(rarityTotals(title))) {
    const ids = [...POOLS[tier]];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = random(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    // Несколько разных видов каждой редкости; минимум один каждого выбранного.
    const count = 2 + random(Math.min(ids.length, total) - 1),
      selected = ids.slice(0, count);
    const weights = selected.map(() => 1 + random(1000)),
      weightSum = weights.reduce((a, b) => a + b, 0);
    const shares = weights.map((w) => ((total - count) * w) / weightSum),
      amounts = shares.map((n) => 1 + Math.floor(n));
    let remainder = total - amounts.reduce((a, b) => a + b, 0);
    const order = shares
      .map((n, i) => ({ i, fraction: n % 1 }))
      .sort((a, b) => b.fraction - a.fraction);
    for (let i = 0; i < remainder; i++) amounts[order[i].i]++;
    selected.forEach((id, i) => {
      items[id] = amounts[i];
    });
  }
  return items;
}
function validRandomItems(title, items, multiplier) {
  if (!items || typeof items !== "object" || Array.isArray(items)) return false;
  const totals = {};
  for (const [id, count] of Object.entries(items)) {
    const tier = Object.keys(POOLS).find((t) => POOLS[t].includes(id));
    if (!tier || !integer(count) || count === 0 || count % multiplier !== 0) return false;
    totals[tier] = (totals[tier] || 0) + count;
  }
  return isDeepStrictEqual(
    totals,
    Object.fromEntries(
      Object.entries(rarityTotals(title)).map(([tier, total]) => [tier, total * multiplier]),
    ),
  );
}
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
function sum(a, b) {
  if (!integer(a) || !integer(b) || !integer(a + b))
    throw new BoosterError("Награда превышает допустимый баланс. Сундук сохранён.", 409);
  return a + b;
}
const freshHonors = () => ({ claimed: 0, notified: 0, chests: {}, medals: {} });
function awardTitles(p, at = Date.now()) {
  const current = p.honors;
  const missingMedal = TITLES.some((title) =>
    !Object.hasOwn(current.medals || {}, title.id) &&
    (title.degree <= current.claimed || Object.hasOwn(current.deferredChests || {}, title.id)),
  );
  if (current.medals && current.notified !== undefined && !missingMedal &&
      (current.claimed >= TITLES.length || p.greatness < TITLES[current.claimed].threshold)) return;
  // Arena drafts share already published honors. Clone only when a title or
  // legacy medal actually changes; pending chest contents remain read-only.
  p.honors = {
    ...current,
    chests: { ...current.chests },
    medals: { ...current.medals },
    ...(current.deferredChests ? { deferredChests: { ...current.deferredChests } } : {}),
  };
  rememberTitleMedals(p);
  // Исторические титулы не показываем заново после установки обновления.
  p.honors.notified ??= p.honors.claimed;
  while (p.honors.claimed < TITLES.length && p.greatness >= TITLES[p.honors.claimed].threshold) {
    const title = TITLES[p.honors.claimed];
    const previous = p.honors.deferredChests?.[title.id];
    // Титул открывает сундук, медаль и рамку; величие повторно не выдаётся.
    if (!Object.hasOwn(p.honors.medals, title.id)) p.honors.medals[title.id] = at;
    p.honors.chests[title.id] = previous || "closed";
    if (previous) {
      delete p.honors.deferredChests[title.id];
      if (!Object.keys(p.honors.deferredChests).length) delete p.honors.deferredChests;
    }
    p.honors.claimed++;
  }
  // New title accessories count as real ownership in this same transaction.
  // Settle them here so arena/lobby paths and retries observe identical awards.
  if (p.honors.claimed !== current.claimed) {
    require("./activity-achievements").awardExtra(p, at);
    if (p.honors.claimed < TITLES.length && p.greatness >= TITLES[p.honors.claimed].threshold)
      awardTitles(p, at);
  }
  // A newly earned title enters storage in this same durable transaction.
  // Arena drafts can still share the other chest collections with readers.
  require("./treasury-capacity").fillDetached(p, at);
}
// Однократный переход старых профилей на новые пороги. История открытий
// предотвращает повторную выдачу наград при повторном достижении титула.
function rebalanceTitles(p) {
  validateHonors(p);
  rememberTitleMedals(p);
  const h = p.honors,
    claimed = Math.min(h.claimed, TITLES.filter((t) => p.greatness >= t.threshold).length);
  for (const title of TITLES.slice(claimed, h.claimed)) {
    (h.deferredChests ||= {})[title.id] = h.chests[title.id];
    delete h.chests[title.id];
    if (h.storage) delete h.storage[title.id];
  }
  h.claimed = claimed;
  if (h.pending && !Object.hasOwn(h.chests, h.pending.id)) delete h.pending;
}
function validateHonors(p) {
  const h = p.honors;
  if (
    !integer(p.wallet.bucks) ||
    !h ||
    !integer(h.claimed) ||
    h.claimed > TITLES.length ||
    (h.notified !== undefined && (!integer(h.notified) || h.notified > TITLES.length)) ||
    !h.chests ||
    typeof h.chests !== "object" ||
    Array.isArray(h.chests) ||
    Object.keys(h.chests).length !== h.claimed ||
    TITLES.some((t, i) =>
      i < h.claimed
        ? !["closed", ...(!t.reason ? ["opened"] : [])].includes(h.chests[t.id])
        : Object.hasOwn(h.chests, t.id),
    )
  )
    throw Error("Повреждены титулы, сундуки или баланс эфира. Сохранение не перезаписано.");
  if (h.storage !== undefined && (!h.storage || typeof h.storage !== "object" || Array.isArray(h.storage) ||
      Object.entries(h.storage).some(([id,c]) => !c || h.chests[id] !== "closed" ||
        c.id !== "title-"+id || c.titleId !== id || typeof c.stored !== "boolean" ||
        c.expiresAt !== null || c.waitingHours !== undefined ||
        ![c.earnedAt,c.receivedAt,c.waitingSince].every(integer) ||
        c.storedAt !== undefined && !integer(c.storedAt) ||
        c.storageOrder !== undefined && (!integer(c.storageOrder) || c.storageOrder < 1))))
    throw Error("Повреждено размещение титульных сундуков. Сохранение не перезаписано.");
  if (
    h.deferredChests !== undefined &&
    (!h.deferredChests ||
      typeof h.deferredChests !== "object" ||
      Array.isArray(h.deferredChests) ||
      Object.entries(h.deferredChests).some(
        ([id, state]) =>
          !TITLES.slice(h.claimed).some((t) => t.id === id) ||
          !["closed", "opened"].includes(state),
      ))
  )
    throw Error("Повреждена история наград титулов. Сохранение не перезаписано.");
  if (
    h.medals !== undefined &&
    (!h.medals ||
      typeof h.medals !== "object" ||
      Array.isArray(h.medals) ||
      Object.entries(h.medals).some(
        ([id, at]) => !TITLES.some((t) => t.id === id) || (at !== null && !integer(at)),
      ))
  )
    throw Error("Повреждена история медалей титулов. Сохранение не перезаписано.");
  if (h.pending) {
    const r = h.pending;
    const title = TITLES.find((t) => t.id === r.id && !t.reason);
    if (
      !title ||
      h.chests[r.id] !== "closed" ||
      ![1, 2, 3, 4].includes(r.multiplier) ||
      !([2, 3, 4, 5, 6].includes(r.version)
        ? validRandomItems(
            r.version >= 4
              ? title
              : { ...title, boosters: PREVIOUS_BOOSTER_TOTALS[r.version][title.id] },
            r.items,
            r.multiplier,
          ) && isDeepStrictEqual(r, chestReward(title, r.multiplier, r.items, true, r.version))
        : LEGACY_CHEST_ITEMS[title.id] && isDeepStrictEqual(r, legacyReward(title, r.multiplier)))
    )
      throw Error("Повреждена подготовленная награда сундука. Сохранение не перезаписано.");
  }
}
function publicTitleMedals(p) {
  const h = p.honors;
  return TITLES.filter(
    (t) =>
      t.degree <= h.claimed ||
      Object.hasOwn(h.deferredChests || {}, t.id) ||
      Object.hasOwn(h.medals || {}, t.id),
  ).map(({ id, name, degree }) => ({ id, name, degree, awardedAt: h.medals?.[id] ?? null }));
}
function rememberTitleMedals(p) {
  p.honors.medals ||= {};
  // Legacy chests prove ownership, not the original date. Never invent a date.
  const h = p.honors;
  for (const title of TITLES)
    if (!Object.hasOwn(h.medals, title.id) &&
        (title.degree <= h.claimed || Object.hasOwn(h.deferredChests || {}, title.id)))
      h.medals[title.id] = null;
}
function publicTitle(p) {
  const t = TITLES[p.honors.claimed - 1];
  return t ? { id: t.id, name: t.name, degree: t.degree } : null;
}
function rebalanceChestBonuses(p) {
  validateHonors(p);
  const reward = p.honors.pending;
  if (reward?.multiplier !== 4) return;
  for (const currency of ["coins", "crystals", "bucks"])
    reward[currency] = (reward[currency] / 4) * 3;
  for (const id of Object.keys(reward.items)) reward.items[id] = (reward.items[id] / 4) * 3;
  reward.multiplier = 3;
  validateHonors(p);
}
// У сундуков титулов нет бонусов аккаунтов. Старый розыгрыш сохраняем,
// убирая только множитель из ещё не выданной награды.
function unmultipliedReward(reward) {
  if (!reward) return null;
  const result = structuredClone(reward),
    factor = result.multiplier;
  for (const key of ["coins", "crystals", "bucks"]) result[key] /= factor;
  for (const id of Object.keys(result.items)) result.items[id] /= factor;
  result.multiplier = 1;
  return result;
}
function publicHonors(p) {
  const pending = unmultipliedReward(p.honors.pending);
  return {
    claimed: p.honors.claimed,
    notified: p.honors.notified ?? p.honors.claimed,
    notifications: TITLES.filter(
      (t) => t.degree > (p.honors.notified ?? p.honors.claimed) && t.degree <= p.honors.claimed,
    ).map(({ id, name, chestName, degree }) => ({ id, name, chestName, degree })),
    pending,
    tiers: TITLES.map((t) => {
      const sealed = pending?.id === t.id ? pending : null;
      const reward = sealed || {
        ...t,
        accountDays: ACCOUNT_DAYS[t.id] || null,
      };
      const boosters = sealed
        ? Object.values(sealed.items).reduce((a, b) => a + b, 0)
        : reward.boosters;
      const rarityShares = sealed
        ? Object.fromEntries(
            Object.entries(POOLS)
              .map(([tier, ids]) => [
                tier,
                (ids.reduce((sum, id) => sum + (sealed.items[id] || 0), 0) * 100) / boosters,
              ])
              .filter(([, share]) => share > 0),
          )
        : { ...RARITY_SHARES[t.id] };
      return {
        ...t,
        state: p.honors.chests[t.id] || "unearned",
        stored: p.honors.storage?.[t.id]?.stored === true,
        coins: reward.coins,
        crystals: reward.crystals,
        bucks: reward.bucks,
        boosters,
        rarityShares,
        accountDays: reward.accountDays || null,
        contents: Object.entries(rarityShares)
          .map(([tier, percent]) => `${RARITY_NAMES[tier]} ${Number(percent.toFixed(2))}%`)
          .join(", "),
      };
    }),
  };
}
function availableChest(p, id) {
  const title = TITLES.find((t) => t.id === id);
  if (!title) throw new BoosterError("Такого сундука нет.");
  if (!Object.hasOwn(p.honors.chests, id))
    throw new BoosterError("Сначала получи соответствующий титул.", 409);
  if (p.honors.chests[id] === "opened")
    throw new BoosterError("Этот сундук уже открыт. Награды получены.", 409);
  if (title.reason) throw new BoosterError("Сундук пока закрыт. " + title.reason, 409);
  return title;
}
function legacyReward(title, multiplier) {
  return {
    id: title.id,
    multiplier,
    ...rewardCurrencies(title, multiplier, 1),
    items: Object.fromEntries(
      Object.entries(LEGACY_CHEST_ITEMS[title.id]).map(([id, n]) => [id, n * multiplier]),
    ),
    ...(ACCOUNT_DAYS[title.id] ? { accountDays: { ...ACCOUNT_DAYS[title.id] } } : {}),
  };
}
function rewardCurrencies(title, multiplier, version) {
  const amounts =
    version <= 4 ? PREVIOUS_CURRENCIES[title.id] : [title.coins, title.crystals, title.bucks];
  return Object.fromEntries(
    ["coins", "crystals", "bucks"].map((key, i) => [key, amounts[i] * multiplier]),
  );
}
function chestReward(title, multiplier, items, alreadyMultiplied = false, version = 6) {
  // Уже подготовленная награда сохраняет показанный игроку срок аккаунтов.
  const accountDays =
    title.id === "boss" && version <= 5 ? { vip: 180, premium: 180 } : ACCOUNT_DAYS[title.id];
  return {
    version,
    id: title.id,
    multiplier,
    ...rewardCurrencies(title, multiplier, version),
    items: Object.fromEntries(
      Object.entries(items).map(([id, n]) => [id, alreadyMultiplied ? n : n * multiplier]),
    ),
    ...(accountDays ? { accountDays: { ...accountDays } } : {}),
  };
}
function prepareChest(p, id, at = Date.now()) {
  const title = availableChest(p, id);
  if (p.honors.pending) {
    if (p.honors.pending.id !== id)
      throw new BoosterError("Сначала забери подготовленную награду.", 409);
    p.honors.pending = unmultipliedReward(p.honors.pending);
    return;
  }
  require("./treasury-capacity").fill(p, at);
  if (!p.honors.storage?.[id]?.stored)
    throw new BoosterError("Освободи место в Сокровищнице. Титульный сундук ждёт бессрочно.", 409);
  p.honors.pending = chestReward(title, 1, randomItems(title));
}
function openChest(p, id, at = Date.now()) {
  availableChest(p, id);
  const reward = unmultipliedReward(p.honors.pending);
  if (!reward || reward.id !== id)
    throw new BoosterError("Сначала подтверди открытие сундука.", 409);
  for (const currency of ["coins", "crystals", "bucks"])
    p.wallet[currency] = sum(p.wallet[currency], reward[currency]);
  for (const [item, count] of Object.entries(reward.items))
    p.inventory[item] = sum(p.inventory[item] || 0, count);
  for (const [kind, days] of Object.entries(reward.accountDays || {})) {
    p.account ||= accounts.fresh();
    const key = kind + "Until";
    p.account[key] = sum(Math.max(at, p.account[key]), days * 86400000);
  }
  // Награда не является заказом недели для достижений VIP/Premium.
  p.honors.chests[id] = "opened";
  delete p.honors.pending;
  require("./treasury-capacity").fill(p, at);
}
module.exports = {
  TITLES,
  POOLS,
  RARITY_SHARES,
  LEGACY_CHEST_ITEMS,
  randomItems,
  legacyReward,
  freshHonors,
  awardTitles,
  rebalanceTitles,
  rebalanceChestBonuses,
  validateHonors,
  publicTitle,
  publicTitleMedals,
  publicHonors,
  prepareChest,
  openChest,
};
