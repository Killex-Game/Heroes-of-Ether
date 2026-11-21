"use strict";
const { BoosterError } = require("../boosters/booster-catalog");
// Регистр, полноширинные буквы, невидимые разделители и распространённые
// похожие кириллические символы не превращают имя владельца в свободный ник.
function reservedName(name) {
  const similar = { к: "k", і: "i", ӏ: "l", е: "e", х: "x" };
  const key = String(name)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[кіӏех]/gu, (c) => similar[c])
    .replace(/[\p{M}\p{Cf}\p{P}\p{Z}\p{S}]/gu, "");
  return key.includes("killex");
}
function requireAllowedName(profileId, name, ownerId) {
  if (ownerId && profileId !== ownerId && reservedName(name))
    throw new BoosterError(
      "Данный ник зарезервирован",
      403,
    );
}
module.exports = { reservedName, requireAllowedName };
