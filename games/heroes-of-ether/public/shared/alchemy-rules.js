(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexAlchemyRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const asset = name => `assets/events/ether-alchemy/v1/${name}.webp`;
  const ingredients = [
    ["mushroom", "Медовый гриб", "#c58a44", 10],
    ["leaf", "Лунолист", "#76ad43", 10],
    ["berries", "Алые ягоды", "#df4140", 10],
    ["dew", "Живая роса", "#5cd2e3", 10],
    ["amber", "Солнечный янтарь", "#efb33e", 10],
    ["coal", "Жар-уголёк", "#ef702f", 10],
    ["frost", "Ледяной кристалл", "#a4e7f3", 10],
    ["sand", "Звёздный песок", "#edd78d", 10],
    ["pearl", "Перламутровая жемчужина", "#e6d9bd", 10],
    ["feather", "Перо феникса", "#eab253", 10],
  ].map(([id, name, color, weight]) => ({ id, name, color, weight, image: asset(`ingredient-${id}`) }));
  const recipe = (id, name, color, items, effect, modifiers, yieldCount = 5) => ({
    id, boosterId: `alchemy_${id}`, name: `Зелье ${name}`, color,
    image: asset(`potion-${id}`), ingredients: Object.entries(items).map(([id, count]) => ({ id, count })),
    yield: yieldCount, tier: Object.keys(items).length, effect, modifiers,
  });
  const potions = [
    recipe("strength", "силы", "#df4b35", { mushroom: 3, leaf: 3, berries: 5 },
      "Раз в 10 с усиливает следующий бустер вдвое.", { pulseMs: 10000 }),
    recipe("swiftness", "проворства", "#5fbda5", { leaf: 4, dew: 3, berries: 2 },
      "+8% к скорости движения.", { speed: 0.08 }),
    recipe("satiety", "сытости", "#d7a541", { mushroom: 5, berries: 3, amber: 2 },
      "+15% массы от природного эфира.", { food: 0.15 }),
    recipe("knowledge", "знаний", "#458dcc", { leaf: 4, dew: 4, sand: 2 },
      "+15% опыта на арене.", { xp: 0.15 }),
    recipe("steadiness", "равновесия", "#819d67", { mushroom: 4, leaf: 5, amber: 2 },
      "Естественная потеря массы меньше на 20%.", { decay: 0.2 }),
    recipe("reach", "дальнего броска", "#d18e54", { berries: 4, dew: 3, feather: 1 },
      "+20% дальности снарядов.", { range: 0.2 }),
    recipe("vigor", "жизненной силы", "#e77858", { mushroom: 6, berries: 6, dew: 4, amber: 3 },
      "Бустеры массы дают на 25% больше массы.", { mass: 0.25 }),
    recipe("longevity", "долголетия", "#42af78", { leaf: 6, dew: 5, amber: 3, pearl: 2 },
      "Положительные эффекты бустеров длятся на 25% дольше.", { positiveDuration: 0.25 }),
    recipe("clarity", "ясности", "#b6e5dd", { leaf: 5, dew: 6, frost: 3, pearl: 2 },
      "Негативные эффекты длятся на 20% меньше.", { negativeDuration: 0.2 }),
    recipe("precision", "меткости", "#4d9eaf", { berries: 5, coal: 4, sand: 3, feather: 2 },
      "+30% к скорости снарядов.", { projectileSpeed: 0.3 }),
    recipe("magnetism", "притяжения", "#3ba7bc", { mushroom: 5, leaf: 5, amber: 4, frost: 3 },
      "+25% к радиусу подбора природного эфира.", { pickupRadius: 0.25 }),
    recipe("gatherer", "собирателя", "#96ad45", { leaf: 6, berries: 6, dew: 5, pearl: 3 },
      "Каждый третий ингредиент приносит ещё один такой же.", { ingredientEvery: 3 }),
    recipe("tempest", "бури", "#2b93be", { leaf: 8, dew: 6, coal: 5, frost: 4, feather: 3 },
      "+12% скорости движения, +30% скорости и дальности снарядов.", { speed: 0.12, projectileSpeed: 0.3, range: 0.3 }),
    recipe("fortitude", "стойкости", "#b1bdba", { mushroom: 8, amber: 6, frost: 5, sand: 4, pearl: 3 },
      "Негативные эффекты короче на 30%, урон бустеров меньше на 20%.", { negativeDuration: 0.3, resistance: 0.2 }),
    recipe("prosperity", "изобилия", "#e9bd48", { mushroom: 8, leaf: 8, berries: 8, amber: 5, pearl: 3 },
      "+25% массы от природного эфира и +25% опыта на арене.", { food: 0.25, xp: 0.25 }),
    recipe("archmage", "архимага", "#36bed1", { dew: 8, amber: 6, coal: 5, sand: 5, feather: 4 },
      "Раз в 8 с усиливает бустер вдвое. Положительные эффекты на 20% дольше.", { pulseMs: 8000, positiveDuration: 0.2 }),
  ];
  const ingredientMap = new Map(ingredients.map(i => [i.id, i]));
  const potionMap = new Map(potions.flatMap(p => [[p.id, p], [p.boosterId, p]]));
  const equipped = saved => saved?.queue || (saved?.equipped ? [saved.equipped] : []);
  const activeIds = active => active?.ids || (active?.id ? [active.id] : []);
  function combine(ids) {
    const result = {};
    for (const id of new Set(ids)) for (const [key, value] of Object.entries(potionMap.get(id)?.modifiers || {})) {
      result[key] = ["pulseMs", "ingredientEvery"].includes(key)
        ? Math.min(result[key] || Infinity, value) : (result[key] || 0) + value;
    }
    return result;
  }
  function freeze(value) { for (const item of Object.values(value)) if (item && typeof item === "object") freeze(item); return Object.freeze(value); }
  return freeze({ ingredients, potions, asset, equipped, activeIds, combine, MAX_ACTIVE: 3,
    get: id => potionMap.get(id), ingredient: id => ingredientMap.get(id),
    NATURAL_PER_EXCHANGE: 100000, CONCENTRATED_PER_EXCHANGE: 10, MAX_PICKUPS: 24, PICKUP_RADIUS: 14,
    manifest: { schemaVersion: 1, id: "ether-alchemy", title: "Эфирная алхимия",
      description: "Собирай ингредиенты на арене и вари зелья для новых приключений. Эфирный генератор превращает природный эфир в концентрированный.",
      durationMinutes: 10080, contentPack: "ether-alchemy-v1", features: { roulette: false, lite: false } },
  });
});
