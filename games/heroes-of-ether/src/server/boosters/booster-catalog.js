/* Каталог, цены, длительности и правила применения бустеров. */
"use strict";
const catalog = require("../../../public/assets/boosters/boosters.json");
const progressionArt = require("../../../public/shared/progression-asset-paths");
const alchemy = require("../../../public/shared/alchemy-rules");

// Числовые эффекты и цены взяты из каталога и справочника. Общие правила
// первого прототипа отделены от них, чтобы впоследствии менять баланс явно.
const BOOSTER_RULES = Object.freeze({
  COOLDOWNS_ENABLED: true,
  COOLDOWN_MS: 500,
  MASS_REPEAT_MS: 100,
  SHIELD_COOLDOWN_MS: 500,
  TARGET_RANGE: 600,
  RARE_SHOP_ENABLED: true,
  FLIGHT_SPEED: 200,
  PROJECTILE_RADIUS: 10,
  TRAP_RADIUS: 24,
  MAX_TRAPS_PER_PROFILE: 48,
  PULL_MS: 1000,
  HOOK_SPEED: 720,
  HOOK_PULL_DISTANCE: 400,
  HARPOON_SPEED: 612,
  PULL_FOLLOW_THROUGH_MS: 400,
});
const implementations = {
  easter_egg: {
    kind: "easter_growth",
    target: "self",
    durationMs: 10000,
    tickMs: 2000,
    amount: 50,
    cooldownMs: 10000,
    sharedCooldownMs: 0,
  },
  ice_cream: { kind: "mass", target: "self", amount: 200 },
  candy: { kind: "mass", target: "self", amount: 150 },
  donut: { kind: "mass", target: "self", amount: 500 },
  meat: { kind: "mass", target: "self", amount: 700 },
  speed: { kind: "speed", target: "self", durationMs: 15000, multiplier: 1.5 },
  colorful_shield: { kind: "shield", target: "self", durationMs: 20000 },
  sphere: { kind: "shield", target: "self", durationMs: 30000 },
  golden_shield: { kind: "shield", target: "self", durationMs: 35000, speedBonus: 0.2 },
  freeze: {
    kind: "slow",
    target: "direction",
    flightMs: 5000,
    flightSpeed: 200,
    maxDistance: 500,
    durationMs: 10000,
    multiplier: 0.7,
  },
  hook: {
    kind: "pull",
    target: "direction",
    flightMs: 3750,
    maxDistance: 750,
    pullTarget: "opponent",
  },
  harpoon: {
    kind: "pull",
    target: "direction",
    flightMs: 7000,
    maxDistance: 400,
    pullTarget: "self",
    pullOnMiss: true,
  },
  web: {
    kind: "root",
    target: "direction",
    flightMs: 1000,
    flightSpeed: 80,
    trap: true,
    flightImpact: true,
    durationMs: 7000,
  },
  stone: {
    kind: "dizzy",
    target: "direction",
    flightMs: 3600,
    flightSpeed: 180,
    maxDistance: 648,
    trap: true,
    flightImpact: true,
    durationMs: 5000,
  },
  rocket: {
    kind: "rocket",
    minHitMass: 20,
    flightSpeed: 200,
    maxDistance: 400,
    splitLimitDamage: 0.2,
  },
  glove: { kind: "push", flightSpeed: 100, pushDistance: 400 },
  mine: {
    kind: "divide",
    pieces: 8,
    trap: true,
    flightMs: 1000,
    flightImpact: true,
    hitOwnerInFlight: true,
    splitLimitDamage: 0.2,
  },
  axe: { kind: "divide", pieces: 4, flightSpeed: 200, maxDistance: 400, splitLimitDamage: 0.5 },
  knuckles: { kind: "knuckles", durationMs: 15000, flightSpeed: 200, maxDistance: 400 },
  poison: {
    kind: "poison",
    fraction: 0.35,
    durationMs: 10000,
    tickMs: 1500,
    flightSpeed: 160,
    maxDistance: 250,
  },
  mega_poison: {
    kind: "poison",
    fraction: 0.5,
    durationMs: 15000,
    tickMs: 1500,
    flightSpeed: 200,
    maxDistance: 400,
  },
  lock: { kind: "lock", durationMs: 10000, flightSpeed: 160, maxDistance: 400 },
  sponge: { kind: "sponge", target: "self", durationMs: 5000 },
  fire: {
    kind: "fire",
    destroyAtOrBelowMass: 300,
    flightSpeed: 200,
    flightMs: 3000,
    maxDistance: 600,
  },
  cake: {
    kind: "cake",
    durationMs: 40000,
    growthFraction: 0.01,
    flightSpeed: 200,
    maxDistance: 400,
  },
  warheads: {
    kind: "rocket",
    fan: 5,
    fanAngleDegrees: 40,
    flightSpeed: 200,
    maxDistance: 400,
    minHitMass: 10,
    splitLimitDamage: 0.2,
  },
  vortex: { kind: "vortex", target: "self", durationMs: 10000 },
  awl: { kind: "awl", flightSpeed: 200, maxDistance: 400 },
  clan_shield: { kind: "shield", target: "self", durationMs: 30000 },
  fire_sword: {
    kind: "sword",
    fraction: 0.2,
    durationMs: 1000,
    heldMs: 5000,
    cooldownMs: 500,
    contactIntervalMs: 2000,
  },
};
for (const id of [
  "rocket",
  "glove",
  "mine",
  "axe",
  "knuckles",
  "poison",
  "mega_poison",
  "lock",
  "fire",
  "cake",
  "warheads",
  "awl",
  "fire_sword",
]) {
  implementations[id] = {
    target: "direction",
    flightMs: 5000,
    flightSpeed: 80,
    ...implementations[id],
  };
}
// Каждый предмет перезаряжается независимо от остальных и срока его эффекта.
for (const [id, item] of Object.entries(implementations)) {
  item.sharedCooldownMs = 0;
  item.cooldownMs = id === "easter_egg" ? 10000
    : ["meat", "donut", "candy"].includes(id) ? BOOSTER_RULES.MASS_REPEAT_MS
      : BOOSTER_RULES.COOLDOWN_MS;
}
const clanCatalog = [
  [
    "fire",
    "Огонь",
    500,
    "Пронзает щиты. Сжигает 50% текущей массы задетой части; активный боевой питомец заменяет этот процент своим. Огонь питомца и клановый Огонь действуют одинаково. Усиления и сопротивление изменяют урон. Если до или после попадания остаётся 300 массы или меньше, часть уничтожается. Без киллов и опыта.",
  ],
  [
    "cake",
    "Торт",
    300,
    "+1% к массе в секунду, действует 40 секунд",
  ],
  ["warheads", "Боеголовки", 100, "Веер из 5 ракет. Каждая делит задетую часть на 80%, 10% и 10%."],
  [
    "vortex",
    "Вихрь",
    200,
    "На 10 с создаёт вокруг каждой вашей части зону притяжения. Чем тяжелее часть, тем больше радиус. Притягивает соперников и еду со скоростью 200. Перекрытие зон не усиливает притяжение, соперников притягивает к большей вашей части. Щит защищает игрока.",
  ],
  ["awl", "Шило", 400, "Снимает щит с соперника."],
  [
    "clan_shield",
    "Клановый щит",
    200,
    "На 30 с отражает летящие снаряды со скоростью 200. Установленные Мина, Паутина и Камень поглощаются. Огонь пробивает, Шило снимает.",
  ],
  [
    "fire_sword",
    "Огненный меч",
    300,
    "Меч действует 5 с у крупнейшего шара. При касании и каждые 2 с непрерывного контакта поджигает шар: 20% его массы за 1 с. Поджоги складываются. При 300 массы и меньше часть сгорает. Щит защищает.",
  ],
].map(([id, name, amount, effect]) => ({
  id,
  name,
  tier: "clan",
  effect,
  icon: `assets/boosters/clan/${id}.svg`,
  price: { amount, currency: "bucks", quantity: 10 },
}));
const usage = {
  freeze: "Снижает скорость соперника на 30%.",
  hook: "Притягивает соперника.",
  harpoon: "Притягивает вас к сопернику.",
  web: "Обездвиживает соперника на 7 секунд.",
  stone:
    "Вызывает головокружение на 5 с: движение становится спутанным, арена покачивается. После приземления остаётся ловушкой, которая действует и на вас.",
};
Object.assign(usage, {
  colorful_shield: "Защита от негативных бустеров на 20 секунд.",
  sphere: "Защита от негативных бустеров на 30 секунд.",
  golden_shield: "Защита от негативных бустеров на 35 секунд + увеличение скорости на 20%.",
  clan_shield: "Отражает негативные бустеры. Действует 30 секунд.",
  rocket: "Делит соперника на 3 части.",
  glove: "Отталкивает соперника",
  mine: "Взрывает соперника на 8 частей.",
  axe: "Делит задетую часть на 4 без потери массы.",
  poison: "Сжигает 35% массы за 10 секунд.",
  mega_poison: "Сжигает 50% массы за 15 секунд.",
  lock: "На 10 секунд запрещает поглощать игроков и еду.",
  sponge: "Запускает обычное соединение текущих частей без ожидания.",
  speed: "Увеличивает скорость на 50% на 15 секунд.",
  fire: "Сжигает 50% текущей массы задетой части, с активным боевым питомцем — его процент. Усиления и сопротивление изменяют урон. При 300 массы и меньше часть сгорает.",
  vortex:
    "Все ваши части притягивают игроков и еду вокруг. Захваченного соперника плавно переносит к более крупным частям, до самого большого шара.",
  fire_sword: "Поджигает соперника, от огня он теряет 20% от массы.",
});
// Event is an acquisition category; every present and future event item is rare.
function boosterRarity(item) { return item.tier === "event" ? "rare" : item.tier; }
const BOOSTERS = new Map(
  [
    ...catalog.items,
    {
      id: "easter_egg",
      name: "Пасхальное яйцо",
      tier: "event",
      icon: "assets/events/easter-hunt/egg-sun.webp",
      effect:
        "Каждые 2 секунды добавляет 50 массы каждой части игрока в течение 10 секунд. За полный срок - по 250 массы на часть. Перезарядка 10 секунд. Используется на себя. Хранится два месяца, срок указан в инвентаре.",
      price: { currency: "coins", amount: 0, quantity: 1 },
    },
    ...clanCatalog,
    ...alchemy.potions.map(p => ({ id: p.boosterId, name: p.name, tier: "potion",
      icon: p.image, effect: p.effect, price: { currency: "coins", amount: 0, quantity: 1 } })),
  ].map((item) => [
    item.id,
    Object.freeze({
      ...item,
      rarity: boosterRarity(item),
      purchaseLevel: item.tier === "rare" ? 25 : item.tier === "advanced" ? 12 : 1,
      useLevel: item.tier === "clan" ? 12 : 1,
      icon: progressionArt.booster(item.id) || item.icon,
      ...implementations[item.id],
      ...(item.tier === "potion" ? { kind: "potion", target: "self" } : {}),
      ready: item.tier === "potion" || !!implementations[item.id],
      unavailableReason:
        item.tier === "clan" ? "Покупается главой в магазине клана за средства казны." : "",
      usage: usage[item.id] || item.effect,
      price: item.price || catalog.tiers[item.tier].pack_price,
    }),
  ]),
);
function publicCatalog() {
  return {
    items: [...BOOSTERS.values()].map(
      ({
        id,
        name,
        tier,
        effect,
        icon,
        ready,
        unavailableReason,
        target,
        price,
        kind,
        flightMs,
        durationMs,
        heldMs,
        cooldownMs,
        sharedCooldownMs,
        trap,
        usage,
        purchaseLevel,
        useLevel,
      }) => ({
        id,
        name,
        tier: boosterRarity({ tier }),
        category: tier,
        eventOnly: tier === "event",
        effect,
        icon,
        ready,
        target,
        price,
        kind,
        flightMs,
        durationMs,
        heldMs,
        cooldownMs,
        sharedCooldownMs,
        trap: !!trap,
        usage,
        purchaseLevel,
        useLevel,
        purchasable:
          ready &&
          tier !== "clan" &&
          tier !== "event" &&
          tier !== "potion" &&
          (tier !== "rare" || BOOSTER_RULES.RARE_SHOP_ENABLED),
        unavailableReason:
          unavailableReason ||
          (tier === "rare" && !BOOSTER_RULES.RARE_SHOP_ENABLED
            ? "Доступен на ярмарках и событиях."
            : ""),
      }),
    ),
    tiers: {
      ...catalog.tiers,
      clan: { name: "Клановые", rarity_color: "#d6a44a" },
      event: { ...catalog.tiers.rare },
      potion: { name: "Зелья", rarity_color: "#43a898" },
    },
    rules: {
      cooldownsEnabled: BOOSTER_RULES.COOLDOWNS_ENABLED,
      cooldownMs: BOOSTER_RULES.COOLDOWN_MS,
      massRepeatMs: BOOSTER_RULES.MASS_REPEAT_MS,
      shieldCooldownMs: BOOSTER_RULES.SHIELD_COOLDOWN_MS,
      targetRange: BOOSTER_RULES.TARGET_RANGE,
      rareShopEnabled: BOOSTER_RULES.RARE_SHOP_ENABLED,
    },
  };
}
class BoosterError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
module.exports = { BOOSTERS, BOOSTER_RULES, BoosterError, publicCatalog, boosterRarity };
