/* Эмоции арены: только временное отображение, без игровых эффектов. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexEmotes = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const DURATION_MS = 3000, COOLDOWN_MS = 1500;
  const items = Object.freeze([
    [1, "drakosha", "Сердитый Дракоша"], [6, "leva", "Дурачащийся Лёва"],
    [2, "zaya", "Смеющаяся Зая"], [4, "leva", "Плачущий Лёва"],
    [5, "manya", "Влюблённая Маня"], [7, "drakosha", "Крутой Дракоша"],
    [3, "manya", "Голодная Маня"], [8, "manya", "Мир"],
    [9, "manya", "Маня извиняется"],
  ].map(([asset, pet, name], i) => Object.freeze({ id: i + 1, pet, name,
    image: `assets/emotes/basic-v1/${asset}.webp`,
    premiumImage: `assets/emotes/pets-v1/${asset}.webp` })));
  const valid = id => Number.isInteger(id) && id >= 1 && id <= items.length;
  function key(event) {
    if (!event || event.defaultPrevented || event.repeat || event.isComposing ||
        event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
    const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || "");
    if (!match || (event.code.startsWith("Numpad") && event.key !== match[1])) return null;
    return Number(match[1]);
  }
  return { items, valid, key, DURATION_MS, COOLDOWN_MS };
});
