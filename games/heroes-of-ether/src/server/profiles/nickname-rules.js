"use strict";
const { BoosterError } = require("../boosters/booster-catalog");

// Сравнение не меняет написание ника, выбранное игроком.
function key(name) {
  return String(name)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
function taken(profiles, name, exceptId) {
  const candidate = key(name);
  for (const p of profiles) if (p.id !== exceptId && key(p.name) === candidate) return true;
  return false;
}
function requireAvailable(profiles, name, exceptId) {
  if (!key(name)) throw new BoosterError("Ник должен содержать видимые символы.");
  if (taken(profiles, name, exceptId))
    throw new BoosterError("Этот ник уже занят. Выбери другой.", 409);
}
function available(profiles, preferred = "Путник", exceptId) {
  const names = new Set(
    Array.from(profiles)
      .filter((p) => p.id !== exceptId)
      .map((p) => key(p.name)),
  );
  const base = Array.from(preferred).slice(0, 16);
  let name = base.join("");
  for (let number = 2; names.has(key(name)); number++) {
    const suffix = " " + number;
    name = base.slice(0, 16 - suffix.length).join("") + suffix;
  }
  return name;
}
module.exports = { key, taken, requireAvailable, available };
