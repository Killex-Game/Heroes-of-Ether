"use strict";
// Four independent slots, random tier order, bounded daily quotas.
const { createHash } = require("node:crypto");
const { BoosterError } = require("../boosters/booster-catalog");
const questOpponents = require("../progression/quest-opponents");
const tiers = [
  {
    id: "common",
    name: "Обычный заказ",
    quota: 4,
    tokens: 10,
    targets: [100, 10, 5, 10, 10, 5, 5, 5, 5000],
  },
  {
    id: "important",
    name: "Важный заказ",
    quota: 4,
    tokens: 20,
    targets: [250, 25, 10, 25, 25, 10, 10, 10, 15000],
  },
  {
    id: "secret",
    name: "Секретный заказ",
    quota: 4,
    tokens: 30,
    targets: [500, 50, 15, 50, 50, 15, 15, 15, 40000],
  },
];
const dailyLimit = 12,
  eventLimit = 84,
  slotCount = 4;
const templates = [
  {
    metric: "food",
    name: "Запасы для лавки",
    text: (n) => `Собери ${n} частиц еды на арене.`,
    icon: "assets/menu-icons/128/currency_bucks.webp",
  },
  {
    metric: "life",
    name: "Дозор",
    text: (n) => `Сыграй на арене ${n} раз. Засчитывается игра длительностью от минуты.`,
    icon: "assets/events/black-friday/order-timer.webp",
  },
  {
    metric: "life",
    name: "Тайное поручение",
    text: (n) =>
      `Заверши ${n} ${n === 1 ? "игру" : n < 5 ? "игры" : "игр"} на арене длительностью от минуты.`,
    icon: "assets/events/black-friday/order-timer.webp",
  },
];
const validInt = (v) => Number.isSafeInteger(v) && v >= 0;
// Append only: indexes of saved orders must not change.
templates.push(
  {
    metric: "kills",
    name: "Охота за соперниками",
    text: (n) => `Полностью поглоти ${n} игроков.`,
    icon: "assets/boosters/png/meat.png",
  },
  {
    metric: "hazards",
    name: "Колючие припасы",
    text: (n) => `Поглоти ${n} колючек.`,
    icon: "assets/arena/thorn-v2.webp",
  },
  {
    metric: "hazardHits",
    name: "Колючий сюрприз",
    text: (n) => `Атакуй соперников запущенной колючкой ${n} раз.`,
    icon: "assets/arena/thorn-v2.webp",
  },
  {
    metric: "rocketHits",
    name: "Особая доставка",
    text: (n) => `Попади Ракетой по соперникам ${n} раз.`,
    icon: "assets/boosters/png/rocket.png",
  },
  {
    metric: "freezeHits",
    name: "Холодный приём",
    text: (n) => `Заморозь соперников ${n} раз.`,
    icon: "assets/boosters/png/freeze.png",
  },
  {
    metric: "absorbedMass",
    name: "Весомая сделка",
    text: (n) =>
      `Получи ${n.toLocaleString("ru-RU")} массы от поглощения соперников.`,
    icon: "assets/boosters/png/meat.png",
  },
);

// Append-only catalogue: existing saved indexes retain their meaning.
templates.push({ metric: "boosterUses", name: "Полный арсенал", text: n => "Используй {n} бустеров.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/boosters/png/rocket.png' });
tiers[0].targets.push(100);
tiers[1].targets.push(200);
tiers[2].targets.push(300);
templates.push({ metric: "shieldUses", name: "Надёжная защита", text: n => "Используй щиты {n} раз.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/boosters/png/colorful_shield.png' });
tiers[0].targets.push(50);
tiers[1].targets.push(150);
tiers[2].targets.push(300);
templates.push({ metric: "poisonHits", name: "Ядовитая доставка", text: n => "Попади Ядом по соперникам {n} раз.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/boosters/png/poison.png' });
tiers[0].targets.push(25);
tiers[1].targets.push(50);
tiers[2].targets.push(100);
templates.push({ metric: "rareUses", name: "Редкий мастер", text: n => "Используй {n} редких бустеров.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/boosters/png/golden_shield.png' });
tiers[0].targets.push(null);
tiers[1].targets.push(200);
tiers[2].targets.push(null);
templates.push({ metric: "commonUses", name: "Простые решения", text: n => "Используй {n} обычных бустеров.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/boosters/png/candy.png' });
tiers[0].targets.push(100);
tiers[1].targets.push(null);
tiers[2].targets.push(null);
templates.push({ metric: "clanUses", name: "Сила клана", text: n => "Используй {n} клановых бустеров.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/boosters/png/fire.png' });
tiers[0].targets.push(null);
tiers[1].targets.push(null);
tiers[2].targets.push(300);
templates.push({ metric: "advancedUses", name: "Особый подход", text: n => "Используй {n} улучшенных бустеров.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/boosters/png/donut.png' });
tiers[0].targets.push(null);
tiers[1].targets.push(150);
tiers[2].targets.push(null);
templates.push({ metric: "purchasedBoosters", name: "Пополнение запасов", text: n => "Купи {n} бустеров.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/menu-icons/128/nav_shop.webp' });
tiers[0].targets.push(75);
tiers[1].targets.push(150);
tiers[2].targets.push(300);
templates.push({ metric: "rouletteSpins", name: "Колесо возможностей", text: n => "Покрути рулетку {n} раз.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/roulette/wheel.svg' });
tiers[0].targets.push(5);
tiers[1].targets.push(15);
tiers[2].targets.push(30);
templates.push({ metric: "giftsGiven", name: "Щедрый гость", text: n => "Подари {n} подарков игрокам.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/gifts/prism-v1/128/chocolates.webp' });
tiers[0].targets.push(3);
tiers[1].targets.push(5);
tiers[2].targets.push(10);
templates.push({ metric: "giftsReceived", name: "Знаки внимания", text: n => "Получи {n} подарков от игроков.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/gifts/prism-v1/128/teddy.webp' });
tiers[0].targets.push(1);
tiers[1].targets.push(3);
tiers[2].targets.push(5);
templates.push({ metric: "coinsEarned", name: "Золотой запас", text: n => "Заработай {n} монет.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/menu-icons/128/currency_coins.webp' });
tiers[0].targets.push(null);
tiers[1].targets.push(null);
tiers[2].targets.push(5000);
templates.push({ metric: "creditedKills", name: "Счёт побед", text: n => "Заработай {n} киллов.".replace('{n}', n.toLocaleString('ru-RU')), icon: 'assets/boosters/png/rocket.png' });
tiers[0].targets.push(500);
tiers[1].targets.push(1000);
tiers[2].targets.push(1500);
const pick = (seed) => createHash("sha256").update(seed).digest()[0] % templates.length;
// Saved indexes remain stable. Only already completed old orders keep their
// old conditions; unfinished seconds must never become completed games.
const previousTargets = { common: [60, 1], important: [120, 2], secret: [240, 3] };
const previousWatch = {
  metric: "survival",
  name: "Ночной дозор",
  text: n => `Проведи ${n} секунд на арене за одну жизнь.`,
  icon: "assets/events/black-friday/shop.webp",
};
const templateFor = c => c.catalogVersion === undefined && c.template === 1 ? previousWatch : templates[c.template];
const targetFor = (tier, c) => c.catalogVersion === undefined && (c.template === 1 || c.template === 2)
  ? previousTargets[tier.id][c.template - 1] : tier.targets[c.template];
function upgradeCurrent(c, tier) {
  if (c.catalogVersion !== undefined || ![1, 2].includes(c.template) || c.progress >= targetFor(tier, c)) return c;
  return { ...c, catalogVersion: 2, progress: c.template === 1 ? 0 : c.progress };
}
function instance(profileId, date, tier, sequence, revision, at, index) {
  const choices = eligible(tier);
  const template = index ?? choices[pick(`${profileId}:${date}:${tier}:${sequence}:${revision}`) % choices.length];
  return { id: `${tier}:${sequence}:${revision}`, template, progress: 0, assignedAt: at, revision, catalogVersion: 2 };
}
function legacyDaily(p, s, date, start) {
  const old = s?.days?.[date];
  if (old?.version === 2) return old;
  // Keep old received orders and progress; never recalculate or re-award old tokens.
  const d = {
    version: 2,
    earned: 0,
    swaps: 0,
    exchanges: { ...(old?.exchanges || {}) },
    lanes: {},
  };
  tiers.forEach((t, i) => {
    const legacy = old?.claimed?.includes(["food", "mass", "life"][i]) ? 1 : 0;
    const current = instance(
      p.id,
      date,
      t.id,
      legacy,
      0,
      start,
      old && i !== 1 ? (i === 0 ? 0 : 2) : undefined,
    );
    if (old && !legacy && i !== 1)
      current.progress = Math.min(
        t.targets[current.template],
        old[["food", "mass", "life"][i]] || 0,
      );
    d.lanes[t.id] = { done: legacy, current };
  });
  return d;
}
// Initial orders may be inspected by many unrelated arena events before any
// order advances. Keep only their deterministic hash words, never a mutable
// order, progress, reward or choice. Applying the current modulus preserves
// the original sequence even if the eligible catalogue changes.
const SEED_CACHE_LIMIT = 2048, SEED_CACHE_WORDS = 16;
const seedWords = new Map();
function seeded(seed) {
  let words = seedWords.get(seed);
  if (!words) {
    if (seedWords.size >= SEED_CACHE_LIMIT) seedWords.delete(seedWords.keys().next().value);
    seedWords.set(seed, words = []);
  }
  let n = 0;
  return (max) => {
    const index = n++;
    let value = words[index];
    if (value === undefined) {
      value = createHash("sha256").update(`${seed}:${index}`).digest().readUInt32LE(0);
      if (index < SEED_CACHE_WORDS) words[index] = value;
    }
    return value % max;
  };
}
function eligible(tier, previous) {
  const t = tiers.find(t => t.id === tier);
  return templates.map((_, i) => i).filter(i => t.targets[i] > 0 && i !== previous);
}
function choose(tier, previous, random) {
  const choices = eligible(tier, previous);
  return choices[random(choices.length)];
}
function assign(p, d, date, at, random, previous) {
  const remaining = tiers.flatMap((t) => Array(t.quota - d.lanes[t.id].issued).fill(t));
  if (!remaining.length) return null;
  const tier = remaining[random(remaining.length)],
    lane = d.lanes[tier.id];
  // Select a different task when replacing a completed one, independent of tier.
  const index = choose(tier.id, previous, random);
  return {
    tier: tier.id,
    complete: false,
    current: instance(p.id, date, tier.id, lane.issued++, 0, at, index),
  };
}
function daily(p, s, date, start, at = start) {
  const old = s?.days?.[date];
  if (old?.version === 3) {
    if (old.catalogVersion === 2) return old;
    const slots = old.slots.map(slot => {
      const current = slot.complete ? slot.current : upgradeCurrent(slot.current, tiers.find(t => t.id === slot.tier));
      if (current === slot.current) return slot;
      return { ...slot, current };
    });
    return { ...old, catalogVersion: 2, slots };
  }
  const d = {
    version: 3,
    catalogVersion: 2,
    earned: old?.earned || 0,
    swaps: old?.swaps || 0,
    exchanges: { ...(old?.exchanges || {}) },
    lanes: {},
    slots: [],
  };
  const legacy = old ? legacyDaily(p, s, date, start) : null;
  for (const [i, tier] of tiers.entries()) {
    const lane = legacy?.lanes[tier.id],
      done = lane?.done || 0;
    d.lanes[tier.id] = { done, issued: done };
    // V2 finished lanes retain the last claimed order: do not revive it.
    if (lane && done < [4, 3, 3][i]) {
      d.slots.push({ tier: tier.id, complete: false, current: structuredClone(upgradeCurrent(lane.current, tier)) });
      d.lanes[tier.id].issued++;
    }
  }
  const random = seeded(`${p.id}:${date}:four-orders`);
  while (d.slots.length < slotCount) {
    const next = assign(p, d, date, old ? at : start, random);
    if (!next) break;
    d.slots.push(next);
  }
  // Existing orders keep IDs, progress and distinct-opponent history.
  for (let i = d.slots.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [d.slots[i], d.slots[j]] = [d.slots[j], d.slots[i]];
  }
  return d;
}
function ensure(p, s, date, start, at = start) {
  return (s.days[date] = daily(p, s, date, start, at));
}
function rows(d) {
  return d.slots.map((slot) => {
    const tier = tiers.find((t) => t.id === slot.tier);
    const lane = d.lanes[tier.id],
      current = slot.current,
      t = templateFor(current),
      target = targetFor(tier, current);
    return {
      ...tier,
      id: current.id,
      name: t.name,
      tier: tier.id,
      tierName: tier.name,
      target,
      description: t.text(target),
      metric: t.metric,
      progress: current.progress,
      icon: t.icon,
      claimed: slot.complete,
      done: lane.done,
    };
  });
}
function count(d) {
  return d.version >= 2 ? tiers.reduce((n, t) => n + d.lanes[t.id].done, 0) : d.claimed.length;
}
function advance(p, d, date, row, at, random, swap) {
  const tier = tiers.find((t) => t.id === row.tier),
    lane = d.lanes[tier.id],
    slot = d.slots.find((s) => s.current.id === row.id);
  if (swap) {
    const cost = d.swaps ? 3 : 0;
    if (p.wallet.bucks < cost) throw new BoosterError("Для замены нужно 3 эфира.", 409);
    p.wallet.bucks -= cost;
    if (!validInt(d.swaps + 1)) throw new BoosterError("Достигнут предел замен.", 409);
    d.swaps++;
    const current = slot.current,
      sequence = Number(current.id.split(":")[1]);
    const index = choose(tier.id, current.template, random);
    slot.current = instance(p.id, date, tier.id, sequence, current.revision + 1, at, index);
  } else {
    lane.done++;
    const next = assign(p, d, date, at, random, slot.current.template);
    if (next) d.slots[d.slots.indexOf(slot)] = next;
    else slot.complete = true;
  }
}
// Progress changes only the current counter and replaces the opponent list.
// Keep the rest of the book shared; never clone its history for every contact.
function copyForProgress(d) {
  return { ...d, slots: d.slots.map(slot => ({ ...slot, current: { ...slot.current } })) };
}
function progress(p, d, event, at, start, session, changes = {}, immutable = false) {
  if (
    !session ||
    (event.type !== "absorbed" && session.id !== event.lifeId) ||
    (event.type === "questSample" && at <= session.sampledAt)
  )
    return immutable ? d : false;
  let changed = false;
  let result = d;
  for (let index = 0; index < d.slots.length; index++) {
    const slot = d.slots[index];
    if (slot.complete) continue;
    const tier = tiers.find((t) => t.id === slot.tier);
    const current = slot.current,
      metric = templateFor(current).metric,
      target = targetFor(tier, current);
    const before = current.progress, opponents = current.opponents;
    let value = before, next = current;
    const since = Math.max(start, current.assignedAt, session.startedAt);
    if (
      !["food", "survival", "life"].includes(metric) &&
      changes[metric] &&
      at >= since
    ) {
      // accepts may replace the distinct-opponent list. Only copy an order
      // which this event can affect; unrelated events allocate no book rows.
      next = immutable ? { ...current } : current;
      if (questOpponents.accepts(next, metric, event, p.id, target))
        value = Math.min(target, value + changes[metric]);
    }
    if (
      metric === "food" &&
      event.type === "questSample" &&
      validInt(event.food) &&
      session.sampledAt >= Math.max(start, current.assignedAt)
    )
      value = Math.min(
        target,
        value + Math.max(0, event.food - session.food),
      );
    if (
      metric === "survival" &&
      ["questSample", "lifeEnded"].includes(event.type) &&
      event.reason !== "recovered"
    )
      value = Math.max(
        value,
        Math.min(target, Math.floor(Math.max(0, at - since) / 1000)),
      );
    if (
      metric === "life" &&
      event.type === "lifeEnded" &&
      event.reason !== "recovered" &&
      event.durationSeconds >= 60 &&
      at - since >= 60000
    )
      value = Math.min(target, value + 1);
    if (value !== before || next.opponents !== opponents) {
      changed = true;
      if (immutable) {
        if (result === d) result = { ...d, slots: d.slots.slice() };
        result.slots[index] = { ...slot, current: { ...next, progress: value } };
      } else current.progress = value;
    }
  }
  return immutable ? result : changed;
}
// Called only inside an accepted server transaction, never from client counters.
function activity(d, changes, at, immutable = false) {
  let changed = false;
  let result = d;
  for (let index = 0; index < d.slots.length; index++) {
    const slot = d.slots[index];
    if (slot.complete || at < slot.current.assignedAt) continue;
    const c = slot.current, metric = templateFor(c).metric;
    const amount = changes[metric], target = targetFor(tiers.find(t => t.id === slot.tier), c);
    if (!validInt(amount) || !amount || c.progress >= target) continue;
    const value = Math.min(target, c.progress + amount);
    if (immutable) {
      if (result === d) result = { ...d, slots: d.slots.slice() };
      result.slots[index] = { ...slot, current: { ...c, progress: value } };
    } else c.progress = value;
    changed = true;
  }
  return immutable ? result : changed;
}
function validateLegacy(d) {
  if (d.version !== 2) return false;
  if (!validInt(d.earned) || !validInt(d.swaps) || !d.lanes || Object.keys(d.lanes).length !== 3)
    throw Error("Повреждена книга заказов.");
  for (const [i, spec] of tiers.entries()) {
    const t = { ...spec, quota: [4, 3, 3][i] };
    const l = d.lanes[t.id],
      c = l?.current;
    if (
      !l ||
      !validInt(l.done) ||
      l.done > t.quota ||
      !c ||
      (c.catalogVersion !== undefined && c.catalogVersion !== 2) ||
      !validInt(c.revision) ||
      !validInt(c.template) ||
      !templates[c.template] ||
      !(t.targets[c.template] > 0) ||
      !validInt(c.progress) ||
      c.progress > targetFor(t, c) ||
      !questOpponents.valid(c, targetFor(t, c)) ||
      !validInt(c.assignedAt) ||
      c.id !== `${t.id}:${Math.min(l.done, t.quota - 1)}:${c.revision}`
    )
      throw Error("Повреждён текущий заказ.");
  }
  return true;
}
function validate(d) {
  if (d.version === 2) return validateLegacy(d);
  if (d.version !== 3) return false;
  const bad = () => {
    throw Error("Повреждена книга заказов.");
  };
  if (
    (d.catalogVersion !== undefined && d.catalogVersion !== 2) ||
    !validInt(d.earned) ||
    !validInt(d.swaps) ||
    !d.lanes ||
    Object.keys(d.lanes).length !== 3 ||
    !Array.isArray(d.slots) ||
    !d.slots.length ||
    d.slots.length > slotCount
  )
    bad();
  const ids = new Set();
  for (const slot of d.slots) {
    const t = tiers.find((t) => t.id === slot.tier),
      c = slot.current;
    if (
      !t ||
      !c ||
      (c.catalogVersion !== undefined && c.catalogVersion !== 2) ||
      typeof slot.complete !== "boolean" ||
      !validInt(c.revision) ||
      !validInt(c.template) ||
      !templates[c.template] ||
      !(t.targets[c.template] > 0) ||
      !validInt(c.progress) ||
      c.progress > targetFor(t, c) ||
      !questOpponents.valid(c, targetFor(t, c)) ||
      !validInt(c.assignedAt)
    )
      bad();
    const sequence = Number(c.id?.split(":")[1]);
    if (
      !validInt(sequence) ||
      sequence >= d.lanes[t.id]?.issued ||
      c.id !== `${t.id}:${sequence}:${c.revision}` ||
      ids.has(`${t.id}:${sequence}`)
    )
      bad();
    ids.add(`${t.id}:${sequence}`);
  }
  for (const t of tiers) {
    const l = d.lanes[t.id],
      live = d.slots.filter((s) => s.tier === t.id && !s.complete).length;
    if (
      !l ||
      !validInt(l.done) ||
      !validInt(l.issued) ||
      l.issued > t.quota ||
      l.done + live !== l.issued
    )
      bad();
  }
  return true;
}
module.exports = {
  templates,
  activity,
  tiers,
  dailyLimit,
  eventLimit,
  daily,
  ensure,
  rows,
  count,
  advance,
  progress,
  copyForProgress,
  validate,
};
