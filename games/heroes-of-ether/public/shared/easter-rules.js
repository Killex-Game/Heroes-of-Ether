(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexEaster = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const asset = (name) => `assets/events/easter-hunt/${name}.webp?art=20261122b`;
  const eggs = [
    { id: "ruby", name: "Алое яйцо", image: asset("egg-ruby") },
    { id: "sky", name: "Небесное яйцо", image: asset("egg-sky") },
    { id: "leaf", name: "Лесное яйцо", image: asset("egg-leaf") },
    { id: "sun", name: "Солнечное яйцо", image: asset("egg-sun") },
  ];
  const entry = (id, name, unit, thresholds, rewards, description) => ({
    id: "easter_" + id,
    name,
    unit,
    thresholds,
    rewards,
    description,
    category: "event",
    exception: false,
    cumulative: false,
    available: true,
  });
  const achievements = [
    entry("trail", "Пасхальный след", "яиц", [1], [25], "Найти первое пасхальное яйцо."),
    entry(
      "colors",
      "Четыре краски",
      "наборов",
      [3, 5, 10, 15, 50],
      [25, 50, 75, 100, 150],
      "Собрать наборы из четырёх видов яиц: по одному каждого вида.",
    ),
    entry(
      "hunter",
      "Охотник за узорами",
      "яиц",
      [100, 200, 300, 400, 500],
      [25, 50, 75, 100, 250],
      "Собрать пасхальные яйца на аренах.",
    ),
    entry(
      "adventure",
      "Пасхальное приключение",
      "игр",
      [10, 50, 100, 250, 500],
      [25, 50, 75, 100, 150],
      "Завершить игры, проведя на арене не менее минуты.",
    ),
    entry(
      "find",
      "Первая находка",
      "сундуков",
      [1, 3, 5, 10, 15],
      [25, 50, 75, 100, 150],
      "Обменять яйца на пасхальные сундуки.",
    ),
    entry(
      "collection",
      "Золотая коллекция",
      "коллекций",
      [1, 1, 1, 1],
      [250, 250, 250, 250],
      "Собрать пасхальную коллекцию.",
    ),
    entry(
      "extra",
      "Ничего лишнего",
      "обменов",
      [1, 2, 3, 4, 5],
      [25, 50, 100, 150, 250],
      "Обменять лишние яйца.",
    ),
  ];
  const eggsPerType = 10;
  const collections = [
    { id: "golden-egg", name: "Золотое яйцо", image: asset("golden-egg") },
    { id: "easter-guardian", name: "Пасхальный хранитель", image: asset("easter-guardian") },
    { id: "spring-basket", name: "Весенняя корзина", image: asset("spring-basket") },
    { id: "awakening-garden", name: "Сад пробуждения", image: asset("awakening-garden") },
  ];
  return {
    eggs,
    achievements,
    asset,
    collections,
    fragmentsPerCollection: 12,
    fragments: collections.length * 12,
    eggsPerType,
    eggsPerChest: eggs.length * eggsPerType,
    etherDailyLimit: 10,
    boosterId: "easter_egg",
    hatId: "rabbit_ears",
  };
});
