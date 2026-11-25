"use strict";
const HOUR = 3600000;
const entries = [
  ["chocolates", "Коробка конфет", "coins", 250, "Декоративный подарок."],
  ["teddy", "Мишка", "coins", 500, "Декоративный подарок."],
  ["rose", "Роза", "coins", 750, "Декоративный подарок."],
  ["ether_bottle", "Бутылек с эфиром", "crystals", 10, "Декоративный подарок."],
  ["ring", "Кольцо", "crystals", 50, "Декоративный подарок."],
  ["car", "Машина", "crystals", 100, "Декоративный подарок."],
  ["clover", "Клевер", "bucks", 15, "+25% к опыту", "xp", 25],
  ["swift_boot", "Сапог скороход", "bucks", 15, "+25% к скорости", "speed", 25],
  [
    "booster_crystal",
    "Кристалл",
    "bucks",
    15,
    "+25% к силе и длительности своих бустеров",
    "outgoing",
    25,
  ],
  [
    "ward_shield",
    "Щит",
    "bucks",
    15,
    "−25% к урону и длительности вражеских бустеров",
    "incoming",
    -25,
  ],
  ["skull", "Череп", "bucks", 5, "−5% к опыту", "xp", -5],
  ["shackles", "Кандалы", "bucks", 5, "−5% к скорости", "speed", -5],
  ["venom", "Яд", "bucks", 5, "−5% к силе и длительности своих бустеров", "outgoing", -5],
  [
    "black_mark",
    "Чёрная метка",
    "bucks",
    5,
    "+5% к урону и длительности вражеских бустеров",
    "incoming",
    5,
  ],
];
const gifts = Object.freeze(
  [...entries.map(([id, name, currency, price, description, stat, percent]) =>
    Object.freeze({
      id,
      name,
      currency,
      price,
      description,
      stat,
      percent,
      durationMs: stat ? HOUR : 0,
      category: !stat ? "decorative" : currency === "bucks" && price === 15 ? "buff" : "debuff",
      icon: "assets/gifts/prism-v1/128/" + id + ".webp",
    }),
  ),
  ...[["hex", "Чары", 10, 15, 30], ["infection", "Заражение", 20, 25, 45],
    ["curse", "Проклятье", 25, 35, 60]].map(([id, name, bundlePercent, price, minutes]) => Object.freeze({
      id, name, bundlePercent, currency: "bucks", price, durationMs: minutes * 60000, category: "debuff",
      description: `−${bundlePercent}% к опыту\n−${bundlePercent}% к скорости\n−${bundlePercent}% к силе и длительности своих бустеров\n+${bundlePercent}% к урону и длительности вражеских бустеров`,
      icon: `assets/gifts/sets-v1/128/${id}.webp`,
    })),
  Object.freeze({ id: "golden_lucky_cat", name: "Золотой счастливчик", currency: "crystals", price: 100,
    description: "Золотая статуэтка на удачу. Декоративный подарок.", durationMs: 0, category: "event",
    icon: "assets/gifts/event-v1/golden-lucky-cat.webp", eventId: "black-friday",
    unlockHint: "Заверши заказы Мани и получи итоговую награду Чёрной пятницы." }),
  Object.freeze({ id: "easter_guardian", name: "Пасхальный хранитель", currency: "crystals", price: 100,
    description: "Хранитель весеннего чуда. Декоративный подарок.", durationMs: 0, category: "event",
    icon: "assets/gifts/event-v1/easter-guardian.webp", eventId: "easter-hunt",
    unlockHint: "Собери хотя бы одну картину Пасхальной охоты." })],
);
const retired = Object.freeze(["warm_heart", "golden_box", "crystal", "star", "royal", "eternal"]);
module.exports = { gifts, retired, HOUR };
