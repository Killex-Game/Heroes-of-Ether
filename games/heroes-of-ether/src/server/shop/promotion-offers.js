"use strict";
const { randomInt } = require("node:crypto");
const products = require("../../../public/shared/virtual-product-catalog");
const { BoosterError } = require("../boosters/booster-catalog");
const { POOLS } = require("../progression/title-chest-rewards");
const weekends = require("./weekend-promotions");

function configuration({
  enabled = false,
  preview = false,
  levelMilestones = false,
  productIds = [],
  weekend = {},
} = {}) {
  if (
    typeof enabled !== "boolean" ||
    typeof preview !== "boolean" ||
    typeof levelMilestones !== "boolean" ||
    !Array.isArray(productIds) ||
    new Set(productIds).size !== productIds.length ||
    productIds.some((id) => products.get(id)?.type !== "promotion" || products.get(id)?.weekendId)
  )
    throw Error("Неверная конфигурация акций.");
  const calendar = weekends.configuration(weekend);
  if (calendar.offerIds.some(id => products.get(id)?.weekendId !== id))
    throw Error("Неизвестная пятничная акция.");
  return Object.freeze({
    enabled,
    preview,
    levelMilestones,
    productIds: Object.freeze([...productIds]),
    weekend: calendar,
  });
}
function purchased(profile, product) {
  // Квитанции сохраняются навсегда, вместе с выдачей набора. Отдельная миграция не нужна.
  const signature = JSON.stringify(["mock-purchase", product.id]);
  return Object.values(profile.receipts).filter((value) => value === signature).length;
}
function product(config,id) {
  const original=products.get(id);
  if(!original?.weekendId||!config.weekendOffers)return original;
  const offer=config.weekendOffers[original.weekendId];
  if(!offer)return undefined;
  if(!original.occurrenceId)return {...offer,promotionRevision:config.weekend.revision};
  const [date,week]=original.occurrenceId.split(':');
  const startsAt=Date.parse(date+'T'+config.weekend.startTime+':00+03:00')+Number(week)*7*86400000;
  return {...offer,id,occurrenceId:original.occurrenceId,startsAt,endsAt:startsAt+config.weekend.durationHours*3600000,promotionRevision:config.weekend.revision};
}
function definitions(profile,config,at) {
  if(!config.weekendOffers)return undefined;
  const selected=[...(config.enabled?ids(profile,config,at):[]),...(config.preview?config.weekend.offerIds:[])];
  return Object.fromEntries(selected.filter(id=>products.get(id)?.weekendId).map(id=>[id,product(config,id)]));
}
function deadline(profile, product) {
  if (product?.weekendId) return product.endsAt || null;
  if (product?.milestone) {
    const start = profile.progress?.levelOffers?.[product.milestone];
    return Number.isSafeInteger(start) && start > 0 ? start + product.durationMs : null;
  }
  const start = profile.personal?.firstNameSetAt;
  if (!profile.personal?.nameSet || !Number.isSafeInteger(start) || start <= 0) return null;
  const end = start + product.firstNameDurationMs;
  return Number.isSafeInteger(end) ? end : null;
}
function inTime(profile, product, at) {
  const end = deadline(profile, product);
  const start = product.milestone
    ? profile.progress?.levelOffers?.[product.milestone]
    : product.weekendId ? product.startsAt : profile.personal?.firstNameSetAt;
  return end !== null && start <= at && at < end;
}
function ids(profile, config, at) {
  const weekend = weekends.current(config.weekend || weekends.draft, at);
  return [
    ...config.productIds,
    ...(weekend ? [weekend.offerId + ":" + weekend.occurrenceId] : []),
    ...(config.levelMilestones
      ? Object.keys(profile.progress?.levelOffers || {}).map(
          (level) => `promotion:century:${level}`,
        )
      : []),
  ];
}
function recordLevels(profile, previousLevel, at) {
  if (Math.floor(profile.level / 100) <= Math.floor(previousLevel / 100)) return;
  const offers = Object.fromEntries(
    Object.entries(profile.progress.levelOffers || {}).filter(
      ([, start]) => start + 3 * 86400000 > at,
    ),
  );
  for (
    let level = (Math.floor(previousLevel / 100) + 1) * 100;
    level <= profile.level;
    level += 100
  )
    offers[level] = at;
  profile.progress.levelOffers = offers;
}
function validate(profile) {
  const seen = profile.seenPromotionIds;
  if (seen !== undefined && (!Array.isArray(seen) || seen.length > 256 ||
    new Set(seen).size !== seen.length || seen.some(id => products.get(id)?.type !== "promotion")))
    throw Error("Повреждены отметки просмотра акций.");
  const offers = profile.progress?.levelOffers;
  if (offers === undefined) return;
  if (
    !offers ||
    typeof offers !== "object" ||
    Array.isArray(offers) ||
    Object.entries(offers).some(
      ([level, at]) =>
        !products.get(`promotion:century:${level}`) ||
        Number(level) > profile.level ||
        !Number.isSafeInteger(at) ||
        at <= 0 ||
        !Number.isSafeInteger(at + 3 * 86400000),
    )
  )
    throw Error("Повреждены сроки акций за уровень.");
}
function acknowledge(profile, config, input, at) {
  const ids = input.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 40 || new Set(ids).size !== ids.length ||
    ids.some(id => typeof id !== "string" || id.length > 100))
    throw new BoosterError("Неверный список просмотренных акций.");
  const active = view(profile, config, at);
  if (ids.some(id => !active.includes(id))) throw new BoosterError("Список акций изменился.", 409);
  profile.seenPromotionIds = [...new Set([...(profile.seenPromotionIds || []), ...ids])].slice(-256);
  validate(profile);
}
function view(profile, config, at) {
  if (!config.enabled) return [];
  return ids(profile, config, at).filter(id => {
    const offer=product(config,id);
    return inTime(profile,offer,at) && purchased(profile,offer)<offer.purchaseLimit;
  });
}
function add(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result) || result < 0)
    throw new BoosterError("Превышен допустимый баланс набора.", 409);
  return result;
}
function grant(profile, product, config, at, random = randomInt) {
  if (!config.enabled || !ids(profile, config, at).includes(product.id))
    throw new BoosterError("Эта акция сейчас недоступна.", 409);
  if (!inTime(profile, product, at))
    throw new BoosterError(
      product.milestone
        ? "Акция доступна 3 дня после достижения уровня."
        : "Набор доступен только в первые 7 дней после установки ника.",
      409,
    );
  if (purchased(profile, product) >= product.purchaseLimit)
    throw new BoosterError("Этот акционный набор уже куплен.", 409);
  for (const [currency, amount] of Object.entries(product.wallet)) {
    profile.wallet[currency] = add(profile.wallet[currency], amount);
    const achievement = { coins: "wealthy", crystals: "miner", bucks: "banker" }[currency];
    profile.activity.values[achievement] = add(profile.activity.values[achievement], amount);
  }
  const items = { ...product.exactBoosters };
  for (const [rarity, count] of Object.entries(product.boosters)) {
    const pool = POOLS[rarity];
    for (let i = 0; i < count; i++) {
      const id = pool[random(pool.length)];
      items[id] = (items[id] || 0) + 1;
    }
  }
  for (const [id, count] of Object.entries(items))
    profile.inventory[id] = add(profile.inventory[id] || 0, count);
  if (product.vipMs) {
    profile.account ||= require("../accounts/account-benefits").fresh();
    const until = add(Math.max(at, profile.account.vipUntil || 0), product.vipMs);
    if (until > 8640000000000000) throw new BoosterError("Превышен срок статуса.", 409);
    profile.account.vipUntil = until;
  }
}
module.exports = { configuration, view, grant, deadline, ids, recordLevels, validate, acknowledge, product, definitions };
