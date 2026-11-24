"use strict";
const catalog = require("../../../public/shared/league-appearance");
const testAccess = require("./appearance-test-access");
const accessOverrides = require("../../../config/appearance-testing.json");
const { BoosterError } = require("../boosters/booster-catalog");
const MONTH = 30 * 86400000;
const fresh = () => ({ ...catalog.selection(), grants: {}, grantVersion: 2 });
function validate(profile) {
  const a = profile.appearance;
  if (a === undefined) return;
  if (
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    !a.grants ||
    (a.granted !== undefined && (!a.granted || Array.isArray(a.granted) || typeof a.granted !== "object" ||
      Object.entries(a.granted).some(([id, at]) => !catalog.slots.some(slot => catalog.valid(id, slot)) ||
        id === "default" || !Number.isSafeInteger(at) || at < 0))) ||
    typeof a.grants !== "object" ||
    Array.isArray(a.grants) ||
    (a.purchasedThemes !== undefined &&
      (!a.purchasedThemes ||
        typeof a.purchasedThemes !== "object" ||
        Array.isArray(a.purchasedThemes) ||
        Object.entries(a.purchasedThemes).some(
          ([id, at]) => !catalog.interfaceTheme(id) || !Number.isSafeInteger(at) || at <= 0,
        ))) ||
    (a.grantVersion !== undefined && a.grantVersion !== 2) ||
    catalog.slots.some(
      (slot) =>
        !(["arenaFrame", "uiTheme"].includes(slot) && a[slot] === undefined) &&
        !catalog.valid(a[slot], slot),
    ) ||
    Object.entries(a.grants).some(
      ([id, until]) =>
        !catalog.theme(id) ||
        (id === "champions" ? until !== null : !Number.isSafeInteger(until) || until <= 0),
    )
  )
    throw Error("Повреждено оформление профиля.");
}
// Только серверная выдача медали: все текущие участники, даже без киллов.
// Срок отсчитывается от результата недели, в том числе после простоя сервера.
function grant(profile, rank, at) {
  const theme = catalog.themes[rank];
  if (!theme) return;
  profile.appearance ||= fresh();
  profile.appearance.grantVersion = 2;
  const previousUntil = profile.appearance.grants[theme.id];
  if (typeof previousUntil === "number" && previousUntil <= at)
    for (const slot of catalog.slots)
      if (catalog.baseFrame(profile.appearance[slot]) === theme.id) profile.appearance[slot] = "default";
  profile.appearance.grants[theme.id] =
    rank === 5 ? null : Math.max(profile.appearance.grants[theme.id] || 0, at + MONTH);
  profile.revision++;
}
// Покупка темы открывает её набор независимо от выбранного сейчас оформления.
// Только адресный тест владельца является исключением, общий preview не даёт наборы.
function ownedThemes(profile) {
  const preview =
    testAccess.all(profile) ||
    accessOverrides.allPersonalAppearanceProfileIds?.includes(profile.id);
  return catalog.interfaceThemes
    .filter(({ id, price }) => price > 0 && (preview || Object.hasOwn(profile.appearance?.purchasedThemes || {}, id) || Object.hasOwn(profile.appearance?.granted || {}, id)))
    .map(({ id }) => id);
}
function access(profile, clans, at) {
  const grants = profile.appearance?.grants || {};
  const available = {
    default: null,
    ...Object.fromEntries(Object.keys(profile.appearance?.granted || {}).map(id => [id, null])),
    ...((profile.honors?.claimed || 0) >= 10 || Object.hasOwn(profile.honors?.medals || {}, "boss") || testAccess.all(profile) ? { heroic: null } : {}),
    ...Object.fromEntries(
      catalog.rankFrames
        .filter(
          (f, i) =>
            i < (profile.honors?.claimed || 0) ||
            Object.hasOwn(profile.honors?.medals || {}, f.titleId),
        )
        .map((f) => [f.id, null]),
    ),
    ...Object.fromEntries(
      ownedThemes(profile).map((id) => [id, null]),
    ),
    ...Object.fromEntries(
      catalog.accountFrames
        .map(({ id }) => [id, profile.account?.[id + "Until"] || 0])
        .filter(([, until]) => until > at),
    ),
    ...Object.fromEntries(
      Object.entries(grants).filter(([id, until]) => id === "champions" || until > at),
    ),
    ...(testAccess.all(profile)
      ? Object.fromEntries(
          [
            ...catalog.themes,
            ...catalog.accountFrames,
            ...catalog.rankFrames,
          ].map(({ id }) => [id, null]),
        )
      : {}),
    // Адресный доступ к оформлению, без выдачи аккаунтов и их игровых бонусов.
    ...(accessOverrides.allPersonalAppearanceProfileIds?.includes(profile.id)
      ? Object.fromEntries(
          catalog.themes.map(({ id }) => [id, null]),
        )
      : {}),
  };
  for (const frame of catalog.variantFrames)
    if (Object.hasOwn(available,frame.baseId)) available[frame.id]=available[frame.baseId];
  return available;
}
const background = (slot) => slot === "lobbyBackground" || slot === "profileBackground";
const testing = (slot, backgrounds, frames) =>
  (backgrounds && (background(slot) || slot === "uiTheme")) ||
  (frames && (slot === "avatarFrame" || slot === "arenaFrame"));
function selected(profile, clans, at, testBackgrounds = false, testFrames = false) {
  const selection = catalog.selection(profile.appearance);
  if (catalog.slots.every((slot) => selection[slot] === "default")) return selection;
  const available = access(profile, clans, at);
  return Object.fromEntries(
    Object.entries(selection).map(([slot, id]) => [
      slot,
      (!catalog.interfaceTheme(id) &&
        !catalog.accountFrame(id) &&
        !catalog.rankFrame(id) &&
        testing(slot, testBackgrounds, testFrames)) ||
      Object.hasOwn(available, id)
        ? id
        : "default",
    ]),
  );
}
function view(profile, clans, at, testBackgrounds = false, testFrames = false) {
  const available = access(profile, clans, at);
  return {
    ...selected(profile, clans, at, testBackgrounds, testFrames),
    testAll: testAccess.all(profile),
    testBackgrounds,
    testFrames,
    unlocked: Object.keys(available),
    availableUntil: available,
  };
}
function capture(profile, clans, at, migrate = false, testBackgrounds = false, testFrames = false) {
  let next = profile;
  if (!next.appearance) {
    next = { ...profile, appearance: fresh(), revision: profile.revision + 1 };
  }
  // До версии 2 бронза ошибочно выдавалась за членство. Убираем именно
  // этот доступ; ранее выданные награды остальных лиг и их сроки сохраняем.
  if (next.appearance.grantVersion !== 2) {
    const grants = { ...next.appearance.grants };
    delete grants.bronze;
    next = {
      ...next,
      revision: next.revision + 1,
      appearance: { ...next.appearance, grants, grantVersion: 2 },
    };
  }
  // Default selections cannot expire. Avoid rebuilding the same selection
  // object for every idle profile on each unrelated arena save.
  if (catalog.slots.every((slot) => next.appearance[slot] === "default")) return next;
  const active = selected(next, clans, at, testBackgrounds, testFrames);
  if (catalog.slots.some((slot) => next.appearance[slot] !== active[slot]))
    next = { ...next, revision: next.revision + 1, appearance: { ...next.appearance, ...active } };
  return next;
}
function update(profile, input, clans, at, testBackgrounds = false, testFrames = false) {
  if (input.action !== undefined && !["select", "buy"].includes(input.action))
    throw new BoosterError("Неизвестное действие оформления.");
  // Все части набора проверяются до изменения; сохраняет их одна транзакция профиля.
  const slots =
    input.slot === "set"
      ? catalog.slots
      : input.slot === "frames"
        ? ["avatarFrame", "arenaFrame"]
        : input.slot === "theme"
          ? ["lobbyBackground", "uiTheme"]
          : [input.slot];
  if (slots.some((slot) => !catalog.slots.includes(slot) || !catalog.valid(input.themeId, slot)))
    throw new BoosterError("Выбери доступное оформление.");
  const available = access(profile, clans, at);
  const pack = catalog.interfaceTheme(input.themeId);
  if (input.action === "buy") {
    if (!pack || !(pack.price > 0) || !["theme", "set"].includes(input.slot)) throw new BoosterError("Выбери тему для покупки.");
    // Ownership also protects against a retry with a new operation ID after reconnecting.
    if (!Object.hasOwn(available, pack.id)) {
      if ((profile.wallet[pack.currency] || 0) < pack.price)
        throw new BoosterError(
          "Недостаточно " +
            { coins: "монет", crystals: "кристаллов", bucks: "эфира" }[pack.currency] +
            ".",
          409,
        );
      profile.wallet[pack.currency] -= pack.price;
      require("../progression/activity-achievements").spend(profile, pack.currency, pack.price, at);
      profile.appearance ||= fresh();
      profile.appearance.purchasedThemes = { ...profile.appearance.purchasedThemes, [pack.id]: at };
      available[pack.id] = null;
    }
  }
  if (
    slots.some(
      (slot) =>
        (pack ||
          catalog.accountFrame(input.themeId) ||
          catalog.rankFrame(input.themeId) ||
          !testing(slot, testBackgrounds, testFrames)) &&
        !Object.hasOwn(available, input.themeId),
    )
  )
    throw new BoosterError(
      pack
        ? pack.earnedTitle ? "Сначала получи титул «Герой»." : "Сначала купи эту тему интерфейса."
        : catalog.accountFrame(input.themeId)
          ? "Оформление недоступно: нужен активный " +
            catalog.accountFrame(input.themeId).name +
            "."
          : catalog.rankFrame(input.themeId)
            ? "Сначала получи соответствующий титул."
            : "Оформление недоступно: клан должен получить медаль этой лиги.",
      403,
    );
  profile.appearance ||= fresh();
  for (const slot of slots) profile.appearance[slot] = catalog.frameForSlot(input.themeId, slot);
  validate(profile);
}
const skinSets = () => [];
module.exports = { MONTH, validate, view, capture, update, selected, grant, skinSets };
