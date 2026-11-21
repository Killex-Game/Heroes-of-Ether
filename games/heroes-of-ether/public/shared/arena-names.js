/* Один справочник для списка арен, подсказок и серверных ответов. */
"use strict";
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexArenaNames = api;
})(globalThis, () => {
  const names = Object.freeze([
    "Альфа",
    "Бета",
    "Гамма",
    "Дельта",
    "Эпсилон",
    "Дзета",
    "Эта",
    "Тета",
    "Йота",
    "Каппа",
    "Лямбда",
    "Мю",
    "Ню",
  ]);
  const arenaName = (id) => names[Number(String(id).slice(6)) - 1] || "Арена";
  const groups = Object.freeze([
    Object.freeze({ id: "sandbox", maxParts: 8, maxBots: 10, minLevel: 1, maxLevel: 11, title: "Выбор Песочницы", world: Object.freeze({ width: 3060, height: 2040 }) }),
    Object.freeze({ id: "glade", maxParts: 12, maxBots: 20, minLevel: 12, maxLevel: 120, title: "Выбор Полянки" }),
    Object.freeze({ id: "arena", maxParts: 16, maxBots: 30, minLevel: 121, maxLevel: Infinity, title: "Выбор Арены" }),
  ]);
  const groupForLevel = (level) => groups.find(g => level >= g.minLevel && level <= g.maxLevel) || groups[0];
  return Object.freeze({ arenaName, names, groups, groupForLevel });
});
