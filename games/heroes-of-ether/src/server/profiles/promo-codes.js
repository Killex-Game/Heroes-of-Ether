"use strict";
const { fail } = require("../admin/content-actions");
const { BOOSTERS } = require("../boosters/booster-catalog");
const accessories = require("../../../public/shared/accessory-catalog");
const identity = require("../../../public/shared/player-identity");
const appearance = require("../../../public/shared/league-appearance");
const { CHESTS } = require("../../../public/shared/clan-competition-rules");
const art = require("../../../public/shared/progression-asset-paths");
const int = n => Number.isSafeInteger(n) && n >= 0;
const catalog = Object.freeze([
  ...Object.entries({ coins: "Монеты", crystals: "Кристаллы", bucks: "Эфир" }).map(([id, name]) => ({ kind: "currency", id, name, category: "Валюта", max: 1000000 })),
  ...[...BOOSTERS.values()].map(b => ({ kind: "booster", id: b.id, name: b.name, category: "Бустеры", max: 10000 })),
  ...accessories.items.map(a => ({ kind: "accessory", id: a.id, name: a.name, category: a.slot === "hat" ? "Шапки" : "Бабочки", max: 1 })),
  ...identity.allSkins.filter(s => !s.ownerGift).map(s => ({ kind: "skin", id: s.id, name: s.name, category: "Скины", max: 1 })),
  ...appearance.interfaceThemes.map(t => ({ kind: "theme", id: t.id, name: t.name, category: "Темы интерфейса — полный набор", max: 1 })),
  ...appearance.themes.map(t => ({ kind: "theme", id: t.id, name: t.name, category: "Темы оформления", max: 1 })),
  ...[...appearance.rankFrames, ...appearance.accountFrames].map(t => ({ kind: "frame", id: t.id, name: t.name, category: "Рамки", max: 1 })),
  ...Object.entries(CHESTS).map(([id, c]) => ({ kind: "chest", id, name: c.name, category: "Сундуки", max: 50 })),
].filter((item, i, list) => item.id !== "default" && list.findIndex(o => o.kind === item.kind && o.id === item.id) === i));
const lookup = new Map(catalog.map(item => [item.kind + ":" + item.id, item]));
// Old claims remain byte-for-byte intact; their retired skin identifiers resolve to current rewards.
const rewardItem = (kind, id) => lookup.get(kind + ":" + (kind === "skin" ? identity.currentSkinId(id) : id));
function normalizeCode(value) {
  if (typeof value !== "string" || value.length > 80) fail("Введи промокод.");
  const code = value.trim().normalize("NFKC").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,47}$/.test(code)) fail("Промокод: 3–48 латинских букв, цифр, дефисов или подчёркиваний.");
  return code;
}
function rewards(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) fail("Добавь от 1 до 50 наград.");
  const seen = new Set();
  return value.map(row => {
    const key = row?.kind + ":" + row?.id, item = rewardItem(row?.kind, row?.id);
    if (!item || seen.has(key) || !int(row.amount) || row.amount < 1 || row.amount > item.max)
      fail("Проверь вид и количество награды; одинаковые награды объединяй в одну строку.");
    seen.add(key);
    return { kind: item.kind, id: item.id, amount: row.amount };
  });
}
function normalize(input) {
  if (input.action === "delete") {
    if (input.confirmed !== true || typeof input.id !== "string" || !input.id || input.id.length > 80)
      fail("Подтверди удаление выбранного промокода.");
    return { action: "delete", id: input.id };
  }
  if (input.action !== undefined) fail("Неизвестное действие с промокодом.");
  const code = normalizeCode(input.code);
  if ((input.id !== undefined && (typeof input.id !== "string" || input.id.length > 80)) ||
      typeof input.enabled !== "boolean" || typeof input.title !== "string" ||
      !input.title.trim() || input.title.length > 100 ||
      !int(input.startsAt) || !int(input.endsAt) ||
      input.startsAt > 8640000000000000 || input.endsAt > 8640000000000000 ||
      (input.endsAt && input.endsAt <= input.startsAt) ||
      !int(input.maxRedemptions) || input.maxRedemptions > 10000000)
    fail("Проверь название, срок и лимит промокода. Нулевой срок или лимит означает отсутствие ограничения.");
  return { ...(input.id ? { id: input.id } : {}), code, title: input.title.trim(), enabled: input.enabled,
    startsAt: input.startsAt, endsAt: input.endsAt, maxRedemptions: input.maxRedemptions, rewards: rewards(input.rewards) };
}
function rewardIcon(r) {
  if (r.kind === "currency") return `assets/menu-icons/128/currency_${r.id}.webp`;
  if (r.kind === "booster") return BOOSTERS.get(r.id)?.icon;
  if (r.kind === "accessory") return accessories.item(r.id)?.icon;
  if (r.kind === "skin") return identity.skinSource(r.id, 128);
  if (r.kind === "theme") return appearance.source(r.id, "profile");
  if (r.kind === "frame") return appearance.source(r.id, "frame");
  if (r.kind === "chest") return art.clanChest(r.id);
  return null;
}
const describe = list => list.map(r => ({ ...r, name: rewardItem(r.kind, r.id)?.name ||
  (r.kind === "skin" && identity.ownerGiftSkins.find(s => s.id === r.id)?.name) || r.id, icon: rewardIcon(r) }));
function view(store) {
  return { revision: store.data.promoCodes?.revision || 0,
    items: structuredClone(store.data.promoCodes?.items || []), catalog };
}
function add(a, b) {
  if (!int(a) || !int(b) || !int(a + b)) fail("Награда превышает допустимый баланс.", 409);
  return a + b;
}
function grant(p, list, at) {
  for (const r of list) {
    if (r.kind === "currency") p.wallet[r.id] = add(p.wallet[r.id] || 0, r.amount);
    if (r.kind === "booster") {
      p.inventory[r.id] = add(p.inventory[r.id] || 0, r.amount);
      if (r.id === "easter_egg") {
        p.easter ||= { runs: {}, chests: [], batches: [], trophies: [] };
        const deadline = require("../events/easter-hunt").expiresAt(at);
        const batch = p.easter.batches.find(b => b.expiresAt === deadline);
        if (batch) batch.count = add(batch.count, r.amount);
        else p.easter.batches.push({ count: r.amount, expiresAt: deadline });
      }
    }
    if (r.kind === "accessory" || r.kind === "skin") {
      const key = r.kind === "accessory" ? "grantedAccessories" : "grantedSkins";
      const id = r.kind === "skin" ? identity.currentSkinId(r.id) : r.id;
      if (!p[key]?.includes(id)) p[key] = [...(p[key] || []), id];
    }
    if (r.kind === "theme" || r.kind === "frame") {
      p.appearance ||= { ...appearance.selection(), grants: {}, grantVersion: 2 };
      p.appearance.granted = { ...p.appearance.granted, [r.id]: at };
    }
    if (r.kind === "chest") for (let i = 0; i < r.amount; i++)
      require("../clans/clan-chest-rewards").grant(p, r.id, at);
  }
}
function redeem(store, token, input) {
  const code = normalizeCode(input.code);
  const result = store.transactWorld(token, input.requestId, JSON.stringify(["promo-code", code]), (p, world) => {
    const item = world.promoCodes?.items.find(row => row.code === code), at = store.now();
    if (!item) fail("Промокод не найден.", 404);
    if (p.promoClaims?.some(c => c.id === item.id)) fail("Ты уже активировал этот промокод.", 409);
    if (!item.enabled || item.startsAt > at || (item.endsAt && item.endsAt <= at))
      fail("Промокод сейчас недоступен.", 409);
    if (item.maxRedemptions && item.redeemed >= item.maxRedemptions) fail("Лимит активаций промокода исчерпан.", 409);
    require("../events/easter-hunt").expire(p, at);
    grant(p, item.rewards, at);
    p.promoClaims = [...(p.promoClaims || []), { id: item.id, code, at, rewards: structuredClone(item.rewards) }];
    world.promoCodes = { ...world.promoCodes, revision: add(world.promoCodes.revision, 1),
      items: world.promoCodes.items.map(row => row.id === item.id ? { ...row, redeemed: add(row.redeemed, 1) } : row) };
    validateProfile(p);
    require("./league-appearance").validate(p);
    require("../events/easter-hunt").validate(p);
    require("../clans/clan-chest-rewards").validate(p);
  }, () => ({ profileIds: [], profileDraft: "owned" }));
  const claim = store.find(token).promoClaims?.find(c => c.code === code);
  return { ...result, code, rewards: describe(claim?.rewards || []) };
}
function validateProfile(p) {
  const broken = () => { throw Error("Повреждены награды промокодов. Сохранение не перезаписано."); };
  for (const [key, valid] of [["grantedAccessories", id => !!accessories.item(id)], ["grantedSkins", identity.validSkin]])
    if (p[key] !== undefined && (!Array.isArray(p[key]) || new Set(p[key]).size !== p[key].length || p[key].some(id => !valid(id)))) broken();
  if (p.promoClaims !== undefined) {
    if (!Array.isArray(p.promoClaims) || new Set(p.promoClaims.map(c => c?.id)).size !== p.promoClaims.length) broken();
    for (const c of p.promoClaims) {
      if (!c || typeof c.id !== "string" || !int(c.at) || c.code !== normalizeCode(c.code)) broken();
      rewards(c.rewards);
    }
  }
}
function validate(world) {
  const data = world.promoCodes;
  if (data !== undefined) {
    if (!data || data.version !== 1 || !int(data.revision) || !Array.isArray(data.items) ||
        new Set(data.items.map(i => i?.id)).size !== data.items.length ||
        new Set(data.items.map(i => i?.code)).size !== data.items.length)
      throw Error("Повреждён каталог промокодов.");
    for (const item of data.items) {
      normalize(item);
      if (!item.id || !int(item.redeemed) || !int(item.createdAt) || !int(item.updatedAt) ||
          (item.maxRedemptions && item.redeemed > item.maxRedemptions)) throw Error("Повреждён промокод.");
    }
    if (data.retired !== undefined && (!Array.isArray(data.retired) ||
        new Set(data.retired.map(r => r?.code)).size !== data.retired.length ||
        data.retired.some(r => !r || typeof r.id !== "string" || !r.id || !int(r.deletedAt) ||
          r.code !== normalizeCode(r.code) || data.items.some(i => i.id === r.id || i.code === r.code))))
      throw Error("Повреждён журнал удалённых промокодов.");
  }
  for (const p of Object.values(world.profiles)) validateProfile(p);
}
module.exports = { catalog, normalize, normalizeCode, rewards, grant, describe, view, redeem, validate, validateProfile };
