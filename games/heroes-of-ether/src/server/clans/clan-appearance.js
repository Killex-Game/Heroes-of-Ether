"use strict";
const testAccess = require("../profiles/appearance-test-access");
const selectedFrame = (clan) =>
  testAccess.clan(clan) && clan.appearance?.testFrame === "champion"
    ? "champion"
    : clan.competition?.frame || null;
const catalog = require("../../../public/shared/league-appearance");
const { MONTH } = require("../profiles/league-appearance");
const { BoosterError } = require("../boosters/booster-catalog");
const fresh = () => ({ background: "default", grants: {}, grantVersion: 2 });
function validate(clan) {
  const a = clan.appearance;
  if (a === undefined) return;
  if (
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    !catalog.valid(a.background, "clanBackground") ||
    !a.grants ||
    typeof a.grants !== "object" ||
    Array.isArray(a.grants) ||
    (a.grantVersion !== undefined && a.grantVersion !== 2) ||
    Object.entries(a.grants).some(
      ([id, until]) =>
        !catalog.theme(id) ||
        (id === "champions" ? until !== null : !Number.isSafeInteger(until) || until <= 0),
    )
  )
    throw Error("Повреждено оформление клана.");
}
function grant(clan, rank, at) {
  const theme = catalog.themes[rank];
  if (!theme) return;
  const a = (clan.appearance ||= fresh());
  a.grantVersion = 2;
  if (
    typeof a.grants[theme.id] === "number" &&
    a.grants[theme.id] <= at &&
    a.background === theme.id
  )
    a.background = "default";
  a.grants[theme.id] = rank === 5 ? null : Math.max(a.grants[theme.id] || 0, at + MONTH);
}
function view(clan, at, testBackgrounds = false) {
  testBackgrounds ||= testAccess.clan(clan);
  const availableUntil = {
    default: null,
    ...Object.fromEntries(
      Object.entries(clan.appearance?.grants || {}).filter(
        ([id, until]) => id === "champions" || until > at,
      ),
    ),
  };
  const chosen = clan.appearance?.background || "default";
  return {
    background: testBackgrounds || Object.hasOwn(availableUntil, chosen) ? chosen : "default",
    unlocked: Object.keys(availableUntil),
    availableUntil,
    testBackgrounds,
  };
}
function capture(clan, at, migrate = false, testBackgrounds = false) {
  let next = clan;
  if (!clan.appearance) {
    next = { ...clan, appearance: fresh() };
  }
  // Бронза прежней версии открывалась автоматически, без медали.
  if (next.appearance.grantVersion !== 2) {
    const grants = { ...next.appearance.grants };
    delete grants.bronze;
    next = {
      ...next,
      appearance: { ...next.appearance, grants, grantVersion: 2 },
    };
  }
  const active = view(next, at, testBackgrounds).background;
  if (active !== next.appearance.background)
    next = { ...next, appearance: { ...next.appearance, background: active } };
  return next;
}
function update(clan, themeId, at, testBackgrounds = false) {
  if (!catalog.valid(themeId, "clanBackground"))
    throw new BoosterError("Выбери фон клана из каталога.");
  if (
    !testBackgrounds &&
    !testAccess.clan(clan) &&
    !Object.hasOwn(view(clan, at).availableUntil, themeId)
  )
    throw new BoosterError("Фон недоступен: клан должен получить медаль этой лиги.", 403);
  clan.appearance ||= fresh();
  clan.appearance.background = themeId;
  validate(clan);
}
module.exports = { validate, grant, view, capture, update, selectedFrame };
