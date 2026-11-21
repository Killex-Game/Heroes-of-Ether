/* Проверка ника, пола и ссылки VK; правила изменения личных данных. */
"use strict";
const { BoosterError } = require("../boosters/booster-catalog");
const { cleanName } = require("../arena/arena-simulation");
const RENAME_COST = 10;
const GENDERS = Object.freeze(["unspecified", "male", "female"]);
function vkLink(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 200)
    throw new BoosterError("Укажи ссылку на профиль VK.");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BoosterError("Укажи ссылку вида https://vk.com/имя.");
  }
  if (
    url.protocol !== "https:" ||
    !["vk.com", "www.vk.com", "m.vk.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[a-zA-Z0-9_.]+\/?$/.test(url.pathname)
  )
    throw new BoosterError("Укажи прямую ссылку на профиль https://vk.com/имя.");
  return "https://vk.com" + url.pathname.replace(/\/$/, "");
}
function validate(profile) {
  if (
    profile.personal !== undefined &&
    (!profile.personal ||
      Array.isArray(profile.personal) ||
      typeof profile.personal.nameSet !== "boolean" ||
      (profile.personal.introPending !== undefined &&
        typeof profile.personal.introPending !== "boolean") ||
      (profile.personal.firstNameSetAt !== undefined &&
        (!profile.personal.nameSet ||
          !Number.isSafeInteger(profile.personal.firstNameSetAt) ||
          profile.personal.firstNameSetAt <= 0)) ||
      !GENDERS.includes(profile.personal.gender) ||
      (profile.personal.vkUrl !== undefined &&
        vkLink(profile.personal.vkUrl) !== profile.personal.vkUrl))
  )
    throw Error("Повреждены личные данные. Сохранение не перезаписано.");
}
function view(profile) {
  return {
    gender: profile.personal?.gender || "unspecified",
    nameSet: profile.personal?.nameSet === true,
    vkUrl: profile.personal?.vkUrl || "",
    renameCost: profile.personal?.nameSet ? RENAME_COST : 0,
    introPending: profile.personal?.introPending === true,
  };
}
function normalize(input) {
  if (
    typeof input.name !== "string" ||
    !cleanName(input.name) ||
    Array.from(input.name.trim()).length > 16
  )
    throw new BoosterError("Ник должен содержать от 1 до 16 символов.");
  if (!GENDERS.includes(input.gender)) throw new BoosterError("Выбери пол из списка.");
  if (typeof input.expectedName !== "string")
    throw new BoosterError("Обнови личные данные перед сохранением.", 409);
  return {
    name: cleanName(input.name),
    gender: input.gender,
    ...(input.vkUrl !== undefined ? { vkUrl: vkLink(input.vkUrl) } : {}),
    expectedName: input.expectedName,
    confirmed: input.confirmed === true,
  };
}
function update(profile, input, at) {
  if (profile.name !== input.expectedName)
    throw new BoosterError("Ник уже изменён в другой вкладке. Обнови профиль.", 409);
  const personal = view(profile),
    changed = profile.name !== input.name;
  if (changed && personal.renameCost) {
    if (!input.confirmed) throw new BoosterError("Подтверди смену ника за 10 кристаллов.", 409);
    if (profile.wallet.crystals < RENAME_COST)
      throw new BoosterError("Недостаточно кристаллов для смены ника.", 409);
    profile.wallet.crystals -= RENAME_COST;
    require("../progression/activity-achievements").spend(profile, "crystals", RENAME_COST, at);
  }
  profile.name = input.name;
  const firstNameSetAt = profile.personal?.firstNameSetAt ?? (!personal.nameSet ? at : undefined);
  profile.personal = {
    gender: input.gender,
    nameSet: true,
    vkUrl: input.vkUrl ?? personal.vkUrl,
    introPending: false,
    ...(firstNameSetAt === undefined ? {} : { firstNameSetAt }),
  };
}
module.exports = { RENAME_COST, GENDERS, validate, view, normalize, update, vkLink };
