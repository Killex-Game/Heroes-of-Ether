/* Общие параметры аксессуаров для сервера и клиента. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexAccessories = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const chargesPerLife = 3;
  // Preliminary balance for formerly decorative items. Existing abilities and
  // bonuses are preserved; this table is the single place to tune the new ones.
  const provisionalBuffs = Object.freeze({
    viking_hat: { shieldSpeed: 4 }, sombrero_hat: { decayReduction: 5 },
    striped_bow: { feedSpeed: 3 }, black_bow: { massXp: 5 }, red_bow: { killXp: 5 },
    mushroom_hat: { foodRadius: 5 }, cowboy_hat: { lightSpeed: 3 }, gold_bow: { petTime: 6 },
    rabbit_ears: { lightSpeed: 4 }, may_wreath: { petTime: 8 }, royal_page: { massXp: 8 },
    silk_peony: { freezeReduction: 8 }, royal_swallow: { feedSpeed: 4 },
    title_experienced_hat: { foodRadius: 4 }, title_experienced_bow: { massXp: 5 },
    title_expert_hat: { massXp: 8 }, title_expert_bow: { freezeReduction: 8 },
    title_sage_hat: { petTime: 8 }, title_sage_bow: { decayReduction: 6 },
    title_master_hat: { food: 10 }, title_master_bow: { shieldSpeed: 4 },
    title_pro_hat: { killXp: 8 }, title_pro_bow: { feedSpeed: 4 },
    title_prince_hat: { lightSpeed: 3, massXp: 4 }, title_prince_bow: { petTime: 10 },
    title_king_hat: { freezeReduction: 10 }, title_king_bow: { foodRadius: 6 },
    title_emperor_hat: { decayReduction: 8 }, title_emperor_bow: { killXp: 10 },
    title_boss_hat: { massXp: 10, freezeReduction: 5 },
    title_boss_bow: { petTime: 8, shieldSpeed: 3 },
  });
  const buffText = (stat, value) => ({
    shieldSpeed: `После снятия щита вражеским бустером: +${value}% скорости на 3 секунды, не чаще раза в 20 секунд.`,
    feedSpeed: `После реального кормления по W: +${value}% скорости на 3 секунды; повтор обновляет срок.`,
    lightSpeed: `+${value}% скорости при общей массе меньше 5 000.`,
    decayReduction: `Естественная потеря массы меньше на ${value}%.`,
    foodRadius: `Радиус подбора эфира с арены больше на ${value}%; радиус поглощения игроков прежний.`,
    food: `+${value}% к массе от эфира с арены.`,
    massXp: `+${value}% базового опыта от 30-секундных начислений за массу.`,
    killXp: `+${value}% опыта за поглощение соперников.`,
    petTime: `+${value}% к исходному запасу активного времени питомца на жизнь; корм не усиливается.`,
    freezeReduction: `Замедление от «Заморозки» заканчивается на ${value}% раньше.`,
  })[stat];
  const titleSets = Object.freeze([{"id":"novice","name":"Новичок","degree":1,"hat":"Шапка новичка","bow":"Бабочка новичка"},{"id":"experienced","name":"Опытный","degree":2,"hat":"Кепка следопыта","bow":"Узел следопыта"},{"id":"expert","name":"Знаток","degree":3,"hat":"Берет знатока","bow":"Сапфировый узел"},{"id":"sage","name":"Мудрец","degree":4,"hat":"Чалма мудреца","bow":"Лунный шёлк"},{"id":"master","name":"Мастер","degree":5,"hat":"Картуз мастера","bow":"Искусная работа"},{"id":"pro","name":"Профи","degree":6,"hat":"Треуголка профи","bow":"Изумрудный акцент"},{"id":"prince","name":"Принц","degree":7,"hat":"Венец принца","bow":"Княжеский шёлк"},{"id":"king","name":"Король","degree":8,"hat":"Королевский венец","bow":"Королевский узел"},{"id":"emperor","name":"Император","degree":9,"hat":"Диадема императора","bow":"Имперский бархат"},{"id":"boss","name":"Герой","degree":10,"hat":"Венец Эфира","bow":"Сияние Эфира"}].map(Object.freeze));
  const titleHatVersions = Object.freeze({
    expert: "v2", sage: "v3", master: "v2", pro: "v2",
    prince: "v3", king: "v3", emperor: "v2", boss: "v2",
  });
  const items = Object.freeze([
    Object.freeze({
      id: "viking_hat",
      slot: "hat",
      name: "Шлем викинга",
      icon: "assets/accessories/shop-v2/viking_hat.webp",
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без способностей и бонусов.",
      currency: "crystals",
      price: 750,
    }),
    Object.freeze({
      id: "sombrero_hat",
      slot: "hat",
      name: "Солнечное сомбреро",
      icon: "assets/accessories/shop-v3/sombrero_hat.webp",
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без способностей и бонусов.",
      currency: "coins",
      price: 1500,
    }),
    Object.freeze({
      id: "striped_bow",
      slot: "bow",
      name: "Полосатая бабочка",
      icon: "assets/accessories/shop-v1/striped_bow.webp",
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без способностей и бонусов.",
      currency: "coins",
      price: 1000,
    }),
    Object.freeze({
      id: "black_bow",
      slot: "bow",
      name: "Чёрная бабочка",
      icon: "assets/accessories/shop-v1/black_bow.webp",
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без способностей и бонусов.",
      currency: "coins",
      price: 500,
    }),
    Object.freeze({
      id: "red_bow",
      slot: "bow",
      name: "Алая бабочка",
      icon: "assets/accessories/shop-v1/red_bow.webp",
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без способностей и бонусов.",
      currency: "coins",
      price: 750,
    }),
    Object.freeze({
      id: "mushroom_hat",
      slot: "hat",
      name: "Шляпка мухомора",
      icon: "assets/accessories/shop-v2/mushroom_hat.webp",
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без способностей и бонусов.",
      currency: "crystals",
      price: 250,
    }),
    Object.freeze({
      id: "cowboy_hat",
      slot: "hat",
      name: "Шляпа шерифа",
      icon: "assets/accessories/shop-v3/cowboy_hat.webp",
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без способностей и бонусов.",
      currency: "crystals",
      price: 500,
    }),
    Object.freeze({
      id: "gold_bow",
      slot: "bow",
      name: "Золотая бабочка",
      icon: "assets/accessories/shop-v1/gold_bow.webp",
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без способностей и бонусов.",
      currency: "crystals",
      price: 1000,
    }),
    Object.freeze({
      id: "rabbit_ears",
      slot: "hat",
      name: "Кроличьи ушки",
      icon: "assets/accessories/rewards-v4/rabbit_ears.webp",
      bonus: Object.freeze({}),
      eventReward: true,
      description: "Постоянная награда за все четыре коллекции Пасхальной охоты.",
    }),
    Object.freeze({
      id: "carrot_bow",
      slot: "bow",
      name: "Морковная бабочка",
      icon: "assets/accessories/rewards-v4/carrot_bow.webp",
      bonus: Object.freeze({}),
      eventReward: true,
      ability: Object.freeze({
        boosterId: "easter_egg",
        count: chargesPerLife,
        name: "Пасхальное яйцо",
        icon: "assets/events/easter-hunt/egg-sun.webp",
      }),
      description: "Постоянная награда за все четыре коллекции Пасхальной охоты.",
    }),
    Object.freeze({
      id: "novice_bow",
      titleDegree: 1,
      slot: "bow",
      name: "Бабочка новичка",
      icon: "assets/accessories/rewards-v4/novice_bow.webp",
      bonus: Object.freeze({ food: 100 }),
      description: "+100% к массе от эфира с арены",
    }),
    Object.freeze({
      id: "novice_hat",
      titleDegree: 1,
      slot: "hat",
      name: "Шапка новичка",
      icon: "assets/accessories/rewards-v4/novice_hat.webp",
      bonus: Object.freeze({ xp: 10 }),
      description: "",
    }),
    Object.freeze({
      id: "dawn_circlet",
      slot: "hat",
      name: "Венец рассвета",
      icon: "assets/accessories/fitted-v3/dawn_circlet.webp",
      previewOnly: true,
      bonus: {
        massXp: 15,
      },
      bonusLabel: "+15% опыта от 30-секундных начислений за массу.",
      description: "Опыт от поглощений не меняется. Бонус берётся от базового начисления.",
    }),
    Object.freeze({
      id: "captain_tricorn",
      slot: "hat",
      name: "Треуголка капитана",
      icon: "assets/accessories/fitted-v3/captain_tricorn.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "hook",
        name: "Крюк",
        count: chargesPerLife,
        icon: "assets/boosters/png/hook.png",
      },
      description:
        "Обычные правила Крюка, без увеличения силы и дальности.",
    }),
    Object.freeze({
      id: "star_pilot",
      slot: "hat",
      name: "Шлем звёздного пилота",
      icon: "assets/accessories/fitted-v3/star_pilot.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "rocket",
        name: "Ракета",
        count: chargesPerLife,
        icon: "assets/boosters/png/rocket.png",
      },
      description: "Использует обычную Ракету, а не веер Боеголовок.",
    }),
    Object.freeze({
      id: "forest_hood",
      slot: "hat",
      name: "Капюшон лесного дозора",
      icon: "assets/accessories/fitted-v3/forest_hood.webp",
      previewOnly: true,
      bonus: {
        lightSpeed: 4,
      },
      bonusLabel: "+4% скорости, пока общая масса игрока меньше 5 000.",
      description:
        "Порог считается по сумме всех частей. Делением нельзя сохранить бонус при большой общей массе.",
    }),
    Object.freeze({
      id: "polar_hat",
      slot: "hat",
      name: "Шапка полярника",
      icon: "assets/accessories/fitted-v3/polar_hat.webp",
      previewOnly: true,
      bonus: {
        freezeReduction: 15,
      },
      bonusLabel: "Замедление от «Заморозки» заканчивается на 15% раньше.",
      description: "Не ослабляет Крюк, Гарпун, Камень или Паутину.",
    }),
    Object.freeze({
      id: "alchemist_hat",
      slot: "hat",
      name: "Шляпа алхимика",
      icon: "assets/accessories/fitted-v3/alchemist_hat.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "poison",
        name: "Яд",
        count: chargesPerLife,
        icon: "assets/boosters/png/poison.png",
      },
      description: "Обычный Яд, без усиления урона и без Мега яда.",
    }),
    Object.freeze({
      id: "baker_hat",
      slot: "hat",
      name: "Колпак пекаря",
      icon: "assets/accessories/fitted-v3/baker_hat.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "cake",
        name: "Торт",
        count: chargesPerLife,
        icon: "assets/boosters/png/cake.png",
      },
      description:
        "Повторный Торт обновляет действие по текущим правилам, без накопления эффекта.",
    }),
    Object.freeze({
      id: "magician_hat",
      slot: "hat",
      name: "Цилиндр фокусника",
      icon: "assets/accessories/fitted-v3/magician_hat.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "sponge",
        name: "Губка",
        count: chargesPerLife,
        icon: "assets/boosters/png/sponge.png",
      },
      description:
        "Запускает обычное соединение частей, без телепортации в одну точку.",
    }),
    Object.freeze({
      id: "ash_crown",
      slot: "hat",
      name: "Корона пепла",
      icon: "assets/accessories/fitted-v3/ash_crown.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "fire",
        name: "Огонь",
        count: chargesPerLife,
        icon: "assets/progression/webp/256/boosters/fire.webp",
      },
      description: "Сохраняет обычные правила Огня и защиты.",
    }),
    Object.freeze({
      id: "tracker_hat",
      slot: "hat",
      name: "Шляпа следопыта",
      icon: "assets/accessories/fitted-v3/tracker_hat.webp",
      previewOnly: true,
      bonus: {
        foodRadius: 12,
      },
      bonusLabel: "+12% к радиусу сбора природного эфира.",
      description: "Не расширяет шар, поглощение игроков, колючек, яиц или еды, выброшенной по W.",
    }),
    Object.freeze({
      id: "may_wreath",
      slot: "hat",
      name: "Венок майского утра",
      icon: "assets/accessories/fitted-v3/may_wreath.webp",
      previewOnly: true,
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Выбор для тех, кому важен внешний вид.",
    }),
    Object.freeze({
      id: "royal_page",
      slot: "hat",
      name: "Берет королевского пажа",
      icon: "assets/accessories/fitted-v3/royal_page.webp",
      previewOnly: true,
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Более спокойная альтернатива крупным коронам.",
    }),
    Object.freeze({
      id: "solar_ribbon",
      slot: "bow",
      name: "Солнечная лента",
      icon: "assets/accessories/prism-wave1/solar_ribbon.webp",
      previewOnly: true,
      bonus: {
        decayReduction: 8,
      },
      bonusLabel: "Естественное уменьшение массы на арене медленнее на 8%.",
      description: "Не уменьшает потерю массы от Огня, Яда и других атак.",
    }),
    Object.freeze({
      id: "sea_bow",
      slot: "bow",
      name: "Узел морского ветра",
      icon: "assets/accessories/prism-wave1/sea_bow.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "harpoon",
        name: "Гарпун",
        count: chargesPerLife,
        icon: "assets/boosters/png/harpoon.png",
      },
      description:
        "Сила и движение точно такие же, как у обычного Гарпуна.",
    }),
    Object.freeze({
      id: "orbital_bow",
      slot: "bow",
      name: "Орбитальная бабочка",
      icon: "assets/accessories/prism-wave1/orbital_bow.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "vortex",
        name: "Вихрь",
        count: chargesPerLife,
        icon: "assets/progression/webp/256/boosters/whirlwind.webp",
      },
      description:
        "Обычный срок действия, без сложения силы пересекающихся зон.",
    }),
    Object.freeze({
      id: "forest_moth",
      slot: "bow",
      name: "Лесной мотылёк",
      icon: "assets/accessories/prism-wave1/forest_moth.webp",
      previewOnly: true,
      bonus: {
        feedSpeed: 5,
      },
      bonusLabel: "После кормления по W: +5% скорости на 3 секунды.",
      description:
        "Повторное W обновляет 3 секунды, не складывает скорость. Срабатывает только при реальном расходе массы.",
    }),
    Object.freeze({
      id: "snow_pattern",
      slot: "bow",
      name: "Снежный узор",
      icon: "assets/accessories/prism-wave1/snow_pattern.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "freeze",
        name: "Заморозка",
        count: chargesPerLife,
        icon: "assets/boosters/png/freeze.png",
      },
      description:
        "Не добавляет второе замедление поверх существующего.",
    }),
    Object.freeze({
      id: "amber_drop",
      slot: "bow",
      name: "Янтарная капля",
      icon: "assets/accessories/prism-wave1/amber_drop.webp",
      previewOnly: true,
      bonus: {
        petTime: 10,
      },
      bonusLabel: "+10% к исходному запасу активного времени питомца на жизнь.",
      description:
        "Применяется один раз при входе. Не ускоряет способности и не усиливает продление кормлением.",
    }),
    Object.freeze({
      id: "cherry_sweet",
      slot: "bow",
      name: "Вишнёвая сладость",
      icon: "assets/accessories/prism-wave1/cherry_sweet.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "ice_cream",
        name: "Мороженое",
        count: chargesPerLife,
        icon: "assets/boosters/png/ice_cream.png",
      },
      description:
        "Каждое применение даёт обычную прибавку массы.",
    }),
    Object.freeze({
      id: "velvet_trick",
      slot: "bow",
      name: "Бархатный фокус",
      icon: "assets/accessories/prism-wave1/velvet_trick.webp",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "glove",
        name: "Перчатка",
        count: chargesPerLife,
        icon: "assets/boosters/png/glove.png",
      },
      description: "Обычное отталкивание, без изменения силы.",
    }),
    Object.freeze({
      id: "forge_spark",
      slot: "bow",
      name: "Искра кузни",
      icon: "assets/accessories/prism-wave1/forge_spark.webp",
      previewOnly: true,
      bonus: {
        shieldSpeed: 5,
      },
      bonusLabel: "Если вражеский бустер снял щит: +5% скорости на 3 секунды.",
      description: "Не чаще раза в 20 секунд. Истечение щита по таймеру бонус не включает.",
    }),
    Object.freeze({
      id: "wanderer_knot",
      slot: "bow",
      name: "Страннический узел",
      icon: "assets/accessories/prism-wave1/wanderer_knot.webp",
      previewOnly: true,
      bonus: {
        killXp: 10,
      },
      bonusLabel: "+10% опыта за поглощение соперников.",
      description:
        "Начисления за удержание массы не меняются. Дробный бонус сохраняется до целого опыта.",
    }),
    Object.freeze({
      id: "silk_peony",
      slot: "bow",
      name: "Шёлковый пион",
      icon: "assets/accessories/prism-wave1/silk_peony.webp",
      previewOnly: true,
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без скрытых преимуществ.",
    }),
    Object.freeze({
      id: "royal_swallow",
      slot: "bow",
      name: "Королевская ласточка",
      icon: "assets/accessories/prism-wave1/royal_swallow.webp",
      previewOnly: true,
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Подходит к берету пажа и другим красно-золотым аксессуарам.",
    }),
    ...titleSets.filter(t => t.degree > 1).flatMap(t => ["hat", "bow"].map(slot => Object.freeze({
      id: "title_" + t.id + "_" + slot, slot, name: t[slot], titleDegree: t.degree,
      icon: "assets/accessories/titles-" + (slot === "hat" ? (titleHatVersions[t.id] || "v1") + "/" : "v1/") + t.id + "-" + slot + ".webp",
      bonus: Object.freeze({}), bonusLabel: "За титул «" + t.name + "»",
      description: "Декоративный аксессуар",
    }))),
  ].map(accessory => {
    const buff = provisionalBuffs[accessory.id];
    if (!buff) return accessory;
    return Object.freeze({ ...accessory, bonus: Object.freeze(buff),
      bonusLabel: Object.entries(buff).map(([stat, value]) => buffText(stat, value)).join(" "),
      description: "Бонус действует, пока аксессуар надет.",
    });
  }));
  const slots = Object.freeze(["bow", "hat"]);
  const byId = new Map(items.map((accessory) => [accessory.id, accessory]));
  const item = (id) => byId.get(id);
  // Called for every player in every arena snapshot. The two fixed slots do
  // not need an intermediate array and entry tuples on each network tick.
  const outfit = (value) => ({
    bow: item(value?.bow)?.slot === "bow" ? value.bow : null,
    hat: item(value?.hat)?.slot === "hat" ? value.hat : null,
  });
  const bonus = (value, stat) =>
    slots.reduce((sum, slot) => {
      const accessory = item(value?.[slot]);
      return sum + (accessory?.slot === slot ? accessory.bonus[stat] || 0 : 0);
    }, 0);
  function isOwned(profile, id) {
    const accessory = item(id);
    if (!accessory) return false;
    if (profile.grantedAccessories?.includes(id)) return true;
    if (accessory.titleDegree) return (profile.honors?.claimed || 0) >= accessory.titleDegree ||
      (accessory.titleDegree === 1 && profile.wardrobeState?.legacyNovice === true);
    if (accessory.price) return profile.purchasedAccessories?.includes(id) === true;
    if (accessory.previewOnly) return false;
    if (!accessory.eventReward) return true;
    const trophies = profile.easter?.trophies || [];
    if (id === "rabbit_ears") return trophies.length > 0;
    if (id === "carrot_bow")
      return (
        trophies.some((t) => t.collectionVersion === 2) ||
        Object.values(profile.easter?.runs || {}).some(
          (run) => run.fragmentCounts?.length === 48 && run.fragmentCounts.every((n) => n > 0),
        )
      );
    return false;
  }
  return { items, titleSets, slots, item, outfit, bonus, isOwned, provisionalBuffs };
});
