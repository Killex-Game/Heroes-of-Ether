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
    viking_hat: {}, sombrero_hat: { speed: 15 },
    striped_bow: { positive: 20, negativeReduction: 20, halfMinuteMass: 100 },
    black_bow: { xp: 10 }, red_bow: { speed: 25 }, mushroom_hat: {},
    cowboy_hat: { positive: 5, halfMinuteMass: 100 }, gold_bow: { xp: 15, generatorFactor: 2 },
    rabbit_ears: { speed: 25 }, may_wreath: { petTime: 8 }, royal_page: { massXp: 8 },
    forest_hood: { speed: 10 }, solar_ribbon: { fireBlock: 10 },
    forest_moth: { negativeReduction: 20 }, amber_drop: { boosterCritical: 10 },
    cherry_sweet: { foodRadius: 30 }, forge_spark: { shieldResistance: 10 },
    silk_peony: { positive: 20 }, royal_swallow: { xp: 30, negativeReduction: 10 },
    title_experienced_hat: { foodRadius: 15 }, title_experienced_bow: { xp: 15 },
    title_expert_hat: { speed: 10 }, title_expert_bow: { xp: 20, positive: 20 },
    title_sage_hat: { petTime: 10 }, title_sage_bow: { xp: 25, positive: 25, speed: 5, negativeReduction: 5 },
    title_master_hat: { attack: 25 }, title_master_bow: { xp: 30, positive: 25, speed: 10, negativeReduction: 10 },
    title_pro_hat: { completeKillXp: 25 }, title_pro_bow: { xp: 30, positive: 30, speed: 15, negativeReduction: 15 },
    title_prince_hat: { spawnMass: 500, negativeReduction: 5 }, title_prince_bow: { xp: 35, positive: 30, speed: 20, negativeReduction: 20 },
    title_king_hat: { xp: 10, speed: 10, potionFactor: 2, minuteMass: 750 }, title_king_bow: { xp: 40, positive: 35, speed: 25, negativeReduction: 25 },
    title_emperor_hat: { xp: 10, speed: 10, positive: 15, potionFactor: 2, minuteMass: 1000 }, title_emperor_bow: { xp: 45, positive: 45, speed: 45, negativeReduction: 45 },
    title_boss_hat: { xp: 15, speed: 15, positive: 15, negativeReduction: 15, potionFactor: 2, minuteMass: 2000 },
    title_boss_bow: { xp: 50, positive: 50, speed: 50, negativeReduction: 50 },
  });
  const titleAbilities = Object.freeze({
    experienced: ["candy", 10, "Конфета"], expert: ["donut", 5, "Пончик"],
    sage: ["meat", 3, "Мясо"], master: ["fire", 3, "Огонь"],
    pro: ["cake", 2, "Торт"], prince: ["hook", 5, "Крюк"],
    king: ["harpoon", 5, "Гарпун"], emperor: ["cake", 5, "Торт"],
    boss: ["fire", 10, "Огонь"],
  });
  const buffText = (stat, value) => ({
    xp: `+${value}% опыта.`,
    speed: `+${value}% скорости.`,
    positive: `+${value}% к действию позитивных бустеров.`,
    negativeReduction: `Действие негативных бустеров слабее на ${value}%.`,
    attack: `+${value}% к силе атакующих бустеров.`,
    completeKillXp: `+${value}% опыта за полное поглощение соперника.`,
    spawnMass: `+${value} массы при появлении на арене.`,
    halfMinuteMass: `+${value} массы за каждые 30 секунд на арене.`,
    generatorFactor: `Природный эфир с арены учитывается Эфирным генератором в ${value} раза быстрее.`,
    fireBlock: `${value}% вероятности отразить действие Огня.`,
    boosterCritical: `${value}% вероятности удвоить силу применённого бустера.`,
    shieldResistance: `${value}% вероятности сохранить щит при попытке его снятия.`,
    minuteMass: `+${value} массы за каждую минуту на арене.`,
    potionFactor: `Сила и длительность эффектов зелий x${value}.`,
    shieldSpeed: `После снятия щита вражеским бустером: +${value}% скорости на 3 секунды, не чаще раза в 20 секунд.`,
    feedSpeed: `После реального кормления по W: +${value}% скорости на 3 секунды; повтор обновляет срок.`,
    lightSpeed: `+${value}% скорости при общей массе меньше 5 000.`,
    decayReduction: `Естественная потеря массы меньше на ${value}%.`,
    foodRadius: `Радиус подбора эфира с арены больше на ${value}%; радиус поглощения игроков прежний.`,
    food: `+${value}% к массе от эфира с арены.`,
    massXp: `+${value}% базового опыта от 30-секундных начислений за массу.`,
    killXp: `+${value}% опыта за поглощение соперников.`,
    petTime: `+${value}% к исходному запасу активного времени питомца за вход на арену; корм не усиливается.`,
    freezeReduction: `Замедление от «Заморозки» заканчивается на ${value}% раньше.`,
  })[stat];
  const titleSets = Object.freeze([{"id":"novice","name":"Новичок","degree":1,"hat":"Шапка новичка","bow":"Бабочка новичка"},{"id":"experienced","name":"Опытный","degree":2,"hat":"Кепка следопыта","bow":"Узел следопыта"},{"id":"expert","name":"Знаток","degree":3,"hat":"Берет знатока","bow":"Сапфировый узел"},{"id":"sage","name":"Мудрец","degree":4,"hat":"Чалма мудреца","bow":"Лунный шёлк"},{"id":"master","name":"Мастер","degree":5,"hat":"Картуз мастера","bow":"Искусная работа"},{"id":"pro","name":"Профи","degree":6,"hat":"Треуголка профи","bow":"Изумрудный акцент"},{"id":"prince","name":"Принц","degree":7,"hat":"Венец принца","bow":"Княжеский шёлк"},{"id":"king","name":"Король","degree":8,"hat":"Королевский венец","bow":"Королевский узел"},{"id":"emperor","name":"Император","degree":9,"hat":"Диадема императора","bow":"Имперский бархат"},{"id":"boss","name":"Герой","degree":10,"hat":"Венец Эфира","bow":"Сияние Эфира"}].map(Object.freeze));
  const titleHatVersions = Object.freeze({
    expert: "v2", sage: "v3", master: "v2", pro: "v2",
    prince: "v3", king: "v3", emperor: "v2", boss: "v2",
  });
  const extraAbilities = {
    viking_hat: [["fire_sword", 3, "Меч"], ["meat", 3, "Мясо"]],
    sombrero_hat: [["sponge", 3, "Губка"]],
    mushroom_hat: [["poison", 3, "Яд"], ["mega_poison", 3, "Мега яд"]],
    star_pilot: [], velvet_trick: [],
  };
  const abilityList = item => item?.abilities || (item?.ability ? [item.ability] : []);
  const items = Object.freeze([
    Object.freeze({
      id: "viking_hat",
      slot: "hat",
      name: "Шлем викинга",
      icon: "assets/accessories/shop-v2/viking_hat.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/shop-v3/sombrero_hat.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/shop-v1/striped_bow.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/shop-v1/black_bow.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/shop-v1/red_bow.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/shop-v2/mushroom_hat.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/shop-v3/cowboy_hat.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/shop-v1/gold_bow.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/rewards-v4/rabbit_ears.webp?art=20261123-interface-art",
      bonus: Object.freeze({}),
      eventReward: true,
      description: "Постоянная награда за все четыре коллекции Пасхальной охоты.",
    }),
    Object.freeze({
      id: "carrot_bow",
      slot: "bow",
      name: "Морковная бабочка",
      icon: "assets/accessories/rewards-v4/carrot_bow.webp?art=20261123-interface-art",
      bonus: Object.freeze({}),
      eventReward: true,
      ability: Object.freeze({
        boosterId: "easter_egg",
        count: chargesPerLife,
        name: "Пасхальное яйцо",
        icon: "assets/events/easter-hunt/egg-sun.webp?art=20261123-interface-art",
      }),
      description: "Постоянная награда за все четыре коллекции Пасхальной охоты.",
    }),
    Object.freeze({
      id: "novice_bow",
      titleDegree: 1,
      slot: "bow",
      name: "Бабочка новичка",
      icon: "assets/accessories/rewards-v4/novice_bow.webp?art=20261123-interface-art",
      bonus: Object.freeze({ food: 100 }),
      description: "+100% к массе от эфира с арены",
    }),
    Object.freeze({
      id: "novice_hat",
      titleDegree: 1,
      slot: "hat",
      name: "Шапка новичка",
      icon: "assets/accessories/rewards-v4/novice_hat.webp?art=20261123-interface-art",
      bonus: Object.freeze({ xp: 10 }),
      description: "",
    }),
    Object.freeze({
      id: "dawn_circlet",
      slot: "hat",
      name: "Венец рассвета",
      icon: "assets/accessories/fitted-v3/dawn_circlet.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/fitted-v3/captain_tricorn.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "hook",
        name: "Крюк",
        count: chargesPerLife,
        icon: "assets/boosters/png/hook.png?art=20261123-interface-art",
      },
      description:
        "Обычные правила Крюка, без увеличения силы и дальности.",
    }),
    Object.freeze({
      id: "star_pilot",
      slot: "hat",
      name: "Шлем звёздного пилота",
      icon: "assets/accessories/fitted-v3/star_pilot.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "rocket",
        name: "Ракета",
        count: chargesPerLife,
        icon: "assets/boosters/png/rocket.png?art=20261123-interface-art",
      },
      description: "Использует обычную Ракету, а не веер Боеголовок.",
    }),
    Object.freeze({
      id: "forest_hood",
      slot: "hat",
      name: "Капюшон лесного дозора",
      icon: "assets/accessories/fitted-v3/forest_hood.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/fitted-v3/polar_hat.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/fitted-v3/alchemist_hat.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "poison",
        name: "Яд",
        count: chargesPerLife,
        icon: "assets/boosters/png/poison.png?art=20261123-interface-art",
      },
      description: "Обычный Яд, без усиления урона и без Мега яда.",
    }),
    Object.freeze({
      id: "baker_hat",
      slot: "hat",
      name: "Колпак пекаря",
      icon: "assets/accessories/fitted-v3/baker_hat.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "cake",
        name: "Торт",
        count: chargesPerLife,
        icon: "assets/boosters/clan-v2/256/cake.webp?art=20261124-clan-art",
      },
      description:
        "Повторный Торт обновляет действие по текущим правилам, без накопления эффекта.",
    }),
    Object.freeze({
      id: "magician_hat",
      slot: "hat",
      name: "Цилиндр фокусника",
      icon: "assets/accessories/fitted-v3/magician_hat.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "sponge",
        name: "Губка",
        count: chargesPerLife,
        icon: "assets/boosters/png/sponge.png?art=20261123-interface-art",
      },
      description:
        "Запускает обычное соединение частей, без телепортации в одну точку.",
    }),
    Object.freeze({
      id: "ash_crown",
      slot: "hat",
      name: "Корона пепла",
      icon: "assets/accessories/fitted-v3/ash_crown.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "fire",
        name: "Огонь",
        count: chargesPerLife,
        icon: "assets/boosters/clan-v2/256/fire.webp?art=20261124-clan-art",
      },
      description: "Сохраняет обычные правила Огня и защиты.",
    }),
    Object.freeze({
      id: "tracker_hat",
      slot: "hat",
      name: "Шляпа следопыта",
      icon: "assets/accessories/fitted-v3/tracker_hat.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/fitted-v3/may_wreath.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Выбор для тех, кому важен внешний вид.",
    }),
    Object.freeze({
      id: "royal_page",
      slot: "hat",
      name: "Берет королевского пажа",
      icon: "assets/accessories/fitted-v3/royal_page.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Более спокойная альтернатива крупным коронам.",
    }),
    Object.freeze({
      id: "solar_ribbon",
      slot: "bow",
      name: "Солнечная лента",
      icon: "assets/accessories/prism-wave1/solar_ribbon.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/prism-wave1/sea_bow.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "harpoon",
        name: "Гарпун",
        count: chargesPerLife,
        icon: "assets/boosters/png/harpoon.png?art=20261123-interface-art",
      },
      description:
        "Сила и движение точно такие же, как у обычного Гарпуна.",
    }),
    Object.freeze({
      id: "orbital_bow",
      slot: "bow",
      name: "Орбитальная бабочка",
      icon: "assets/accessories/prism-wave1/orbital_bow.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "vortex",
        name: "Вихрь",
        count: chargesPerLife,
        icon: "assets/boosters/clan-v2/256/vortex.webp?art=20261124-clan-art",
      },
      description:
        "Обычный срок действия, без сложения силы пересекающихся зон.",
    }),
    Object.freeze({
      id: "forest_moth",
      slot: "bow",
      name: "Лесной мотылёк",
      icon: "assets/accessories/prism-wave1/forest_moth.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/prism-wave1/snow_pattern.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "freeze",
        name: "Заморозка",
        count: chargesPerLife,
        icon: "assets/boosters/png/freeze.png?art=20261123-interface-art",
      },
      description:
        "Не добавляет второе замедление поверх существующего.",
    }),
    Object.freeze({
      id: "amber_drop",
      slot: "bow",
      name: "Янтарная капля",
      icon: "assets/accessories/prism-wave1/amber_drop.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {
        petTime: 10,
      },
      bonusLabel: "+10% к исходному запасу активного времени питомца за вход на арену.",
      description:
        "Применяется один раз при входе. Не ускоряет способности и не усиливает продление кормлением.",
    }),
    Object.freeze({
      id: "cherry_sweet",
      slot: "bow",
      name: "Вишнёвая сладость",
      icon: "assets/accessories/prism-wave1/cherry_sweet.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "ice_cream",
        name: "Мороженое",
        count: chargesPerLife,
        icon: "assets/boosters/png/ice_cream.png?art=20261123-interface-art",
      },
      description:
        "Каждое применение даёт обычную прибавку массы.",
    }),
    Object.freeze({
      id: "velvet_trick",
      slot: "bow",
      name: "Бархатный фокус",
      icon: "assets/accessories/prism-wave1/velvet_trick.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      ability: {
        boosterId: "glove",
        name: "Перчатка",
        count: chargesPerLife,
        icon: "assets/boosters/png/glove.png?art=20261123-interface-art",
      },
      description: "Обычное отталкивание, без изменения силы.",
    }),
    Object.freeze({
      id: "forge_spark",
      slot: "bow",
      name: "Искра кузни",
      icon: "assets/accessories/prism-wave1/forge_spark.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/prism-wave1/wanderer_knot.webp?art=20261123-interface-art",
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
      icon: "assets/accessories/prism-wave1/silk_peony.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Без скрытых преимуществ.",
    }),
    Object.freeze({
      id: "royal_swallow",
      slot: "bow",
      name: "Королевская ласточка",
      icon: "assets/accessories/prism-wave1/royal_swallow.webp?art=20261123-interface-art",
      previewOnly: true,
      bonus: {},
      bonusLabel: "Декоративный аксессуар",
      description: "Подходит к берету пажа и другим красно-золотым аксессуарам.",
    }),
    ...titleSets.filter(t => t.degree > 1).flatMap(t => ["hat", "bow"].map(slot => Object.freeze({
      id: "title_" + t.id + "_" + slot, slot, name: t[slot], titleDegree: t.degree,
      icon: "assets/accessories/titles-" + (slot === "hat" ? (titleHatVersions[t.id] || "v1") + "/" : "v1/") + t.id + "-" + slot + ".webp",
      ...(slot === "hat" && titleAbilities[t.id] && { ability: Object.freeze({
        boosterId: titleAbilities[t.id][0], count: titleAbilities[t.id][1], name: titleAbilities[t.id][2],
        icon: titleAbilities[t.id][0] === "fire"
          ? "assets/boosters/clan-v2/256/fire.webp?art=20261124-clan-art"
          : "assets/boosters/png/" + titleAbilities[t.id][0] + ".png",
      }) }),
      bonus: Object.freeze({}), bonusLabel: "За титул «" + t.name + "»",
      description: "Декоративный аксессуар",
    }))),
  ].map(original => {
    let accessory = original;
    if (Object.hasOwn(extraAbilities, original.id)) {
      const abilities = Object.freeze(extraAbilities[original.id].map(([boosterId, count, name]) => Object.freeze({
        boosterId, count, name, icon: boosterId === "fire_sword"
          ? "assets/boosters/clan-v2/256/sword.webp"
          : "assets/boosters/png/" + boosterId + ".png?art=20261123-interface-art",
      })));
      accessory = {...original, abilities, ability: abilities[0]};
    }
    const mapped = abilityList(accessory).map(a => ["fire","cake","warheads","vortex","awl","clan_shield"].includes(a.boosterId)
      ? Object.freeze({...a, icon: `assets/boosters/clan-v2/256/${a.boosterId}.webp?art=20261124-clan-art`}) : a);
    if (mapped.some((a,i) => a !== abilityList(accessory)[i])) accessory = {...accessory, abilities: Object.freeze(mapped), ability: mapped[0]};
    const buff = provisionalBuffs[accessory.id];
    if (!buff && accessory === original) return original;
    const abilities = abilityList(accessory);
    return Object.freeze({ ...accessory, bonus: Object.freeze(buff || accessory.bonus),
      bonusLabel: Object.entries(buff || accessory.bonus).map(([stat, value]) => buffText(stat, value)).join(" "),
      description: abilities.length
        ? "За вход на арену по клавише E: " + abilities.map(a => `${a.count} применений «${a.name}»`).join(", затем ") + ". Одно нажатие расходует один заряд."
        : Object.values(buff || accessory.bonus).some(v => v > 0) ? "Бонус действует, пока аксессуар надет." : "Награда события. Свойства будут доступны с его запуском.",
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
  const descriptionFor = accessory => [...new Set([accessory.bonusLabel, accessory.description].filter(Boolean))].join(" ");
  return { items, titleSets, slots, item, outfit, bonus, isOwned, provisionalBuffs, abilityList, descriptionFor };
});
