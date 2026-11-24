/* Единый каталог тестовых покупок за голоса: цены и выдаваемые продукты. */
"use strict";
(function (root, factory) {
  const catalog = factory(typeof module === "object" && module.exports
    ? require("./weekend-promotion-catalog") : root.KillexWeekendProducts);
  if (typeof module === "object" && module.exports) module.exports = catalog;
  else root.KillexVirtualProducts = catalog;
})(typeof globalThis !== "undefined" ? globalThis : this, (weekend) => {
  const catalogs = {
    bucks: {
      label: "эфира",
      icon: "Э",
      packages: [
        {
          id: "change",
          name: "Эфирная крошка",
          base: 20,
          bonus: 0,
          percent: 0,
          votes: 1,
          rubles: 7,
        },
        {
          id: "stash",
          name: "Эфирная россыпь",
          base: 100,
          bonus: 0,
          percent: 0,
          votes: 5,
          rubles: 35,
        },
        {
          id: "piggy",
          name: "Бутылек с эфиром",
          base: 200,
          bonus: 0,
          percent: 0,
          votes: 10,
          rubles: 70,
        },
        {
          id: "gift",
          name: "Бочка эфира",
          base: 500,
          bonus: 50,
          percent: 10,
          votes: 25,
          rubles: 175,
        },
        {
          id: "treasure",
          name: "Эфирная сокровищница",
          base: 1000,
          bonus: 200,
          percent: 20,
          votes: 50,
          rubles: 350,
        },
        {
          id: "bank",
          name: "Водопад Эфира",
          base: 2000,
          bonus: 500,
          percent: 25,
          votes: 100,
          rubles: 700,
        },
      ],
    },
    coins: {
      label: "монеток",
      icon: "★",
      packages: [
        {
          id: "handful",
          name: "Горсть золота",
          base: 300,
          bonus: 0,
          percent: 0,
          votes: 1,
          rubles: 7,
        },
        {
          id: "purse",
          name: "Кошель странника",
          base: 1500,
          bonus: 0,
          percent: 0,
          votes: 5,
          rubles: 35,
        },
        {
          id: "sack",
          name: "Мешок искателя",
          base: 3000,
          bonus: 0,
          percent: 0,
          votes: 10,
          rubles: 70,
        },
        {
          id: "casket",
          name: "Ларец чародея",
          base: 7500,
          bonus: 750,
          percent: 10,
          votes: 25,
          rubles: 175,
        },
        {
          id: "dragon",
          name: "Сундук дракона",
          base: 15000,
          bonus: 3000,
          percent: 20,
          votes: 50,
          rubles: 350,
        },
        {
          id: "treasury",
          name: "Сокровищница Эфира",
          base: 30000,
          bonus: 7500,
          percent: 25,
          votes: 100,
          rubles: 700,
        },
      ],
    },
    crystals: {
      label: "кристаллов",
      icon: "◆",
      packages: [
        { id: "sparks", name: "Искры маны", base: 15, bonus: 0, percent: 0, votes: 1, rubles: 7 },
        {
          id: "moon",
          name: "Лунная россыпь",
          base: 75,
          bonus: 0,
          percent: 0,
          votes: 5,
          rubles: 35,
        },
        {
          id: "radiance",
          name: "Ларец сияния",
          base: 150,
          bonus: 0,
          percent: 0,
          votes: 10,
          rubles: 70,
        },
        {
          id: "vein",
          name: "Кристальная жила",
          base: 375,
          bonus: 40,
          percent: 10,
          votes: 25,
          rubles: 175,
        },
        {
          id: "mountain",
          name: "Сердце горы",
          base: 750,
          bonus: 150,
          percent: 20,
          votes: 50,
          rubles: 350,
        },
        {
          id: "source",
          name: "Источник Эфира",
          base: 1500,
          bonus: 375,
          percent: 25,
          votes: 100,
          rubles: 700,
        },
      ],
    },
  };

  const accountLoginRewards = {
    vip: { coins: 50, crystals: 10, bucks: 5 },
    premium: { coins: 100, crystals: 25, bucks: 10 },
  };
  const products = Object.entries(catalogs).flatMap(([currency, catalog]) =>
    catalog.packages.map((item) => ({
      id: `${currency}:${item.id}`,
      name: item.name,
      type: "currency",
      currency,
      amount: item.base + item.bonus,
      baseAmount: item.base,
      votes: item.votes,
      description: `${(item.base + item.bonus).toLocaleString("ru-RU")} ${catalog.label}`,
      icon:
        currency === "bucks"
          ? `assets/currency-packs/ether-v1/${item.id}.webp?art=20261123-interface-art`
          : `assets/currency-packs/v1/${currency}-${item.id}.webp?art=20261123-interface-art`,
    })),
  );
  for (const [kind, name, votes] of [
    ["vip", "VIP", 10],
    ["premium", "Premium", 30],
  ]) {
    products.push({
      id: `account:${kind}`,
      name,
      type: "account",
      kind,
      days: kind === "premium" ? 14 : 7,
      votes,
      description: `${kind === "premium" ? 14 : 7} дней - срок активного статуса продлевается`,
      icon: `assets/accounts/${kind}.png?art=20261123-interface-art`,
    });
  }
  products.push({
    id: "account:lite",
    name: "Lite",
    type: "lite",
    kind: "lite",
    votes: 50,
    description:
      "50 билетов при активации, билет за каждый сундук, покупка билетов и быстрая прокрутка",
    icon: "assets/accounts/lite.svg?art=20261123-interface-art",
  });
  for (const offer of [
    {
      id: "promotion:starter",
      name: "Стартовый набор",
      votes: 7,
      originalVotes: 14,
      wallet: { coins: 2500, crystals: 150 },
      boosters: { common: 1000, advanced: 500 },
      description: "2 500 монет, 150 кристаллов, 1 000 случайных обычных и 500 улучшенных бустеров",
      icon: "assets/promotions/starter-v1.webp?art=20261123-interface-art",
    },
    {
      id: "promotion:advanced",
      name: "Продвинутый набор",
      votes: 20,
      originalVotes: 40,
      wallet: { coins: 5000, crystals: 750 },
      boosters: { common: 2000, advanced: 1000, rare: 500 },
      description:
        "5 000 монет, 750 кристаллов, 2 000 случайных обычных, 1 000 улучшенных и 500 редких бустеров",
      icon: "assets/promotions/advanced-v1.webp?art=20261123-interface-art",
    },
  ])
    products.push({
      ...offer,
      type: "promotion",
      purchaseLimit: 1,
      firstNameDurationMs: 7 * 24 * 60 * 60 * 1000,
    });
  products.push({
    id: "event:manya-coupon", name: "Купон Мани", type: "manya-coupon", votes: 50,
    description: "500 жетонов и сундук сразу. Удвоение последующих жетонов, VIP за жетоны без лимита, шанс VIP в сундуках Чёрной пятницы 4%. На текущее событие.",
    icon: "assets/events/black-friday/coupon.webp?art=20261123-interface-art",
  });
  const freeze = (object) => {
    for (const value of Object.values(object)) {
      if (value && typeof value === "object") freeze(value);
    }
    return Object.freeze(object);
  };
  freeze(catalogs);
  freeze(products);
  freeze(accountLoginRewards);
  const centuryOffer = (id) => {
    if (typeof id !== "string" || !/^promotion:century:[1-9]\d*00$/.test(id)) return;
    const milestone = Number(id.split(":")[2]);
    if (!Number.isSafeInteger(milestone)) return;
    return freeze({
      id,
      milestone,
      name: "Новая сотня",
      type: "promotion",
      purchaseLimit: 1,
      votes: 40,
      originalVotes: 80,
      durationMs: 3 * 86400000,
      vipMs: 3 * 86400000,
      wallet: { coins: 10000, crystals: 1000 },
      boosters: { common: 100, advanced: 100, rare: 100 },
      description:
        "10 000 монет, 1 000 кристаллов, по 100 обычных, улучшенных и редких бустеров, VIP на 3 дня",
      icon: "assets/promotions/century-v2.webp?art=20261123-interface-art",
    });
  };
  return Object.freeze({
    mockDailyPurchaseLimit: 5,
    currencies: catalogs,
    accountLoginRewards,
    products,
    get: (id) => products.find((product) => product.id === id) || centuryOffer(id) || weekend.get(id),
  });
});
