/* Общие отображаемые правила питомцев; покупки и применение подтверждает сервер. */
"use strict";
(function (root, factory) {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else root.KillexPets = rules;
})(typeof window === "object" ? window : globalThis, () => {
  const HOUR = 3600000,
    REFILL_MS = 4 * HOUR;
  const UNLOCK_LEVEL = 12;
  const isUnlocked = (playerLevel) =>
    Number.isSafeInteger(playerLevel) && playerLevel >= UNLOCK_LEVEL;
  const thresholds = [100, 500, 1000, 2500, 5000];
  const shields = Object.freeze({
    colorful_shield: Object.freeze({
      name: "Красочный щит",
      icon: "assets/boosters/png/colorful_shield.png?art=20261122b",
    }),
    sphere: Object.freeze({ name: "Сфера-щит", icon: "assets/boosters/png/sphere.png?art=20261122b" }),
    golden_shield: Object.freeze({
      name: "Золотой щит",
      icon: "assets/boosters/png/golden_shield.png?art=20261122b",
    }),
    clan_shield: Object.freeze({
      name: "Клановый щит",
      icon: "assets/progression/webp/256/boosters/clan_shield.webp?art=20261122b",
    }),
  });
  const shieldLevels = Object.freeze({
    zaya: ["colorful_shield", "colorful_shield", "sphere", "golden_shield", "clan_shield"],
    leva: ["colorful_shield", "sphere", "golden_shield", "golden_shield", "clan_shield"],
    drakosha: ["colorful_shield", "sphere", "golden_shield", "clan_shield", "clan_shield"],
    manya: ["golden_shield", "golden_shield", "clan_shield", "clan_shield", "clan_shield"],
  });
  const pets = [
    {
      id: "zaya",
      name: "Зая",
      role: "Нежная защитница",
      description: "Верная спутница бережёт тебя на арене и создаёт защитные щиты.",
      currency: "coins",
      price: 10000,
      vitalityMinutes: Object.freeze([30, 40, 50, 60, 80, 120]),
      mass: [0, 0, 0, 0, 0],
      premium: "Клавиша R: Морковь каждые 30 секунд: +500 массы",
    },
    {
      id: "leva",
      name: "Лёва",
      role: "Храбрый страж",
      description: "Маленький лев с большим сердцем. Дарит щиты и помогает набирать массу.",
      currency: "crystals",
      price: 1000,
      vitalityMinutes: Object.freeze([60, 70, 80, 90, 120, 150]),
      mass: [200, 300, 400, 500, 600],
      premium: "Клавиша R: Когтистая перчатка каждые 30 секунд",
    },
    {
      id: "drakosha",
      name: "Дракоша",
      role: "Повелитель пламени",
      description: "Огненный друг для смелых побед: щиты, масса, скорость и особые боевые бустеры.",
      currency: "bucks",
      price: 500,
      vitalityMinutes: Object.freeze([80, 90, 120, 150, 180, 210]),
      mass: [300, 400, 500, 700, 1000],
      premium: "По одному огню и когтистой перчатке каждые 30 секунд.",
    },
    {
      id: "manya",
      name: "Маня",
      role: "Царица арены",
      description: "Царственная кошка защищает от урона, ускоряет и снабжает целым арсеналом.",
      currency: "bucks",
      price: 2000,
      vitalityMinutes: Object.freeze([90, 100, 120, 180, 210, 240]),
      mass: [400, 600, 800, 1000, 1500],
      premium:
        "По одному огню, когтю и когтистой перчатке каждые 60 секунд. Позитивные бустеры сильнее на 20%.",
    },
  ].map((p) =>
    Object.freeze({
      ...p,
      premiumIntervalMs: p.id === "manya" ? 60000 : 30000,
      image: `assets/pets/levels-v1/${p.id}-0.webp?art=20261122b`,
    }),
  );
  const get = (id) => pets.find((p) => p.id === id);
  const level = (games) => thresholds.filter((n) => games >= n).length;
  const capacityMs = (id, games = 0) => get(id).vitalityMinutes[level(games)] * 60000;
  const imageFor = (id, rank = 0) =>
    get(id)
      ? `assets/pets/${id === "manya" && Number(rank) >= 5 ? "levels-v2" : "levels-v1"}/${id}-${Math.min(5, Math.max(0, Math.floor(Number(rank) || 0)))}.webp?art=20261122b`
      : null;
  function stats(id, games) {
    const p = get(id),
      rank = level(games),
      i = Math.max(0, rank - 1);
    if (!p) return null;
    const combat = id === "drakosha" || id === "manya",
      manya = id === "manya";
    const training = rank === 0,
      amount = training ? 5 : [7, 8, 9, 10, 11][i];
    return {
      level: rank,
      rank,
      capacityMs: capacityMs(id, games),
      shieldId: training ? "colorful_shield" : shieldLevels[id][i],
      intervalMs:
        (training ? (id === "zaya" ? 90 : 60) : manya ? [50, 40, 30, 20, 20][i] : 60 - 10 * i) *
        1000,
      mass: training ? { zaya: 0, leva: 100, drakosha: 150, manya: 300 }[id] : p.mass[i],
      thornMeals: id === "leva" ? rank * 10 : id === "zaya" ? 1 : 0,
      thornRefillMs: id === "leva" ? [0,0,0,180000,120000,60000][rank] : id === "zaya" ? [60000,55000,50000,45000,40000,30000][rank] : 0,
      speed: combat ? [1, 3, 6, 10, 15][i] : 0,
      resistance: manya ? [1, 3, 6, 10, 15][i] : 0,
      firePercent: combat ? (training ? 50 : [53, 57, 60, 65, 70][i] + (manya ? 0 : 2)) : 0,
      start: {
        fire: manya ? amount : combat ? (training ? 3 : 4 + i) : 0,
        claw: manya ? amount : 0,
        glove: manya ? amount : combat ? (training ? 4 : 6 + i) : 0,
        carrot: 0,
      },
    };
  }
  // Advance an energy interval, splitting exactly at each automatic refill.
  // Idle time refills but never drains energy. Returns actual active arena milliseconds.
  function advance(state, capacity, from, to, playing = false) {
    if (to < from) return 0;
    if (!playing) {
      if (to >= state.refillAt) {
        state.vitalityMs = capacity;
        state.refillAt += (Math.floor((to - state.refillAt) / REFILL_MS) + 1) * REFILL_MS;
      }
      return 0;
    }
    let active = 0,
      cursor = from;
    if (cursor >= state.refillAt) advance(state, capacity, cursor, cursor, false);
    while (cursor < to) {
      const end = Math.min(to, state.refillAt),
        used = Math.min(state.vitalityMs, end - cursor);
      active += used;
      state.vitalityMs -= used;
      cursor = end;
      if (cursor >= state.refillAt) {
        state.vitalityMs = capacity;
        state.refillAt += REFILL_MS;
      }
    }
    return active;
  }
  const abilities = {
    fire: {
      id: "pet_fire",
      name: "Огонь питомца",
      key: "Q",
      target: "direction",
      icon: "assets/progression/webp/256/boosters/fire.webp?art=20261122b",
    },
    claw: {
      id: "pet_claw",
      name: "Коготь",
      key: "R",
      target: "direction",
      icon: "assets/pets/boosters/claw.webp?art=20261122b",
    },
    glove: {
      id: "pet_glove",
      name: "Когтистая перчатка",
      key: "R",
      target: "direction",
      icon: "assets/pets/boosters/clawed-glove.webp?art=20261122b",
    },
    carrot: {
      id: "pet_carrot",
      name: "Морковь",
      key: "R",
      icon: "assets/pets/boosters/carrot-v2.webp?art=20261122b",
    },
  };
  const ABILITY_COOLDOWN_MS = 0;
  return {
    pets,
    get,
    imageFor,
    capacityMs,
    stats,
    level,
    thresholds,
    shields,
    advance,
    REFILL_MS,
    UNLOCK_LEVEL,
    isUnlocked,
    abilities,
    ABILITY_COOLDOWN_MS,
  };
});
