/* Эмоции арены: только временное отображение, без игровых эффектов. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexEmotes = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const DURATION_MS = 3000, COOLDOWN_MS = 1500;
  const items = Object.freeze([
    ["drakosha", "Сердитый Дракоша"], ["zaya", "Смеющаяся Зая"],
    ["manya", "Голодная Маня"], ["leva", "Плачущий Лёва"],
    ["manya", "Влюблённая Маня"], ["leva", "Дурачащийся Лёва"],
    ["drakosha", "Крутой Дракоша"], [null, "Мир"],
    ["manya", "Маня извиняется"],
  ].map(([pet, name], i) => Object.freeze({ id: i + 1, pet, name,
    image: `assets/emotes/basic-v1/${i + 1}.webp`,
    premiumImage: i === 7 ? "assets/emotes/basic-v1/8.webp" : `assets/emotes/pets-v1/${i + 1}.webp` })));
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
