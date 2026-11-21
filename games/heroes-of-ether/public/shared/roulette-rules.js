/* Общие описания призов. Результат вращения определяет только сервер. */
"use strict";
((root, factory) => {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KillexRouletteRules = factory();
})(typeof window === "object" ? window : globalThis, () => {
  const categories = [
    { id: "vip", name: "1 час VIP", weight: 120, color: "#8b479b" },
    { id: "coins", name: "Монеты", weight: 1225, color: "#b97526" },
    { id: "crystals", name: "Кристаллы", weight: 490, color: "#248ca6" },
    {
      id: "advanced",
      name: "Улучшенные бустеры",
      weight: 1715,
      min: 10,
      max: 20,
      color: "#3479ac",
    },
    { id: "clan", name: "Клановые бустеры", weight: 980, min: 5, max: 10, color: "#db9143" },
    { id: "rare", name: "Редкие бустеры", weight: 1470, min: 7, max: 15, color: "#7848b2" },
  ];
  const slots = [
    "vip",
    "rare",
    "coins",
    "advanced",
    "clan",
    "crystals",
    "rare",
    "coins",
    "advanced",
    "clan",
    "crystals",
    "rare",
    "advanced",
    "clan",
  ];
  const fridayCategories = categories.map(c => c.id === "advanced"
    ? { ...c, id: "fridayTokens", name: "Жетоны Мани", min: 5, max: 10, color: "#aab6c4" }
    : c);
  const fridaySlots = slots.map(id => id === "advanced" ? "fridayTokens" : id);
  return { version: 4, categories, slots, totalWeight: 6000, vipMs: 3600000,
    forEvent: (variant) => variant === "black-friday"
      ? { categories: fridayCategories, slots: fridaySlots } : { categories, slots } };
});
