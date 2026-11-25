"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");

const { findRunAt } = require("./event-run-lookup");
const { randomInt } = require("node:crypto");
const { BOOSTERS, BoosterError } = require("../boosters/booster-catalog");
const book = require("./black-friday-orders");
const chests = require("./black-friday-chests");
const stages = require("../progression/achievement-stages");
const DAY = 86400000,
  MSK = 10800000;
const manifest = {
  schemaVersion: 1,
  id: "black-friday",
  title: "Чёрная пятница",
  description:
    "Лавка Мани открыта! Выполняй заказы, собирай жетоны и получай подарки. За 50 заказов получи регалию и уникальную картину для Альбома.",
  durationMinutes: 10080,
  contentPack: "black-friday-v1",
  features: { roulette: true, lite: true },
};
const art = "assets/events/black-friday/";
const orders = [
  {
    id: "food",
    name: "Запасы для лавки",
    description: "Собери 150 частиц еды на арене.",
    target: 150,
    tokens: 10,
    icon: "assets/menu-icons/128/currency_bucks.webp",
  },
  {
    id: "mass",
    name: "Крупный покупатель",
    description: "Достигни 5 000 массы на арене.",
    target: 5000,
    tokens: 10,
    icon: "assets/boosters/png/meat.png",
  },
  {
    id: "life",
    name: "Верный помощник",
    description: "Заверши вход на арену длительностью от минуты.",
    target: 1,
    tokens: 10,
    icon: art + "shop.webp",
  },
];
const shop = [
  {
    id: "common",
    name: "30 обычных бустеров",
    tokens: 10,
    tier: "common",
    count: 30,
    limit: 25,
    icon: "assets/boosters/png/candy.png",
  },
  {
    id: "advanced",
    name: "25 улучшенных бустеров",
    tokens: 15,
    tier: "advanced",
    count: 25,
    limit: 25,
    icon: "assets/boosters/png/donut.png",
  },
  {
    id: "rare",
    name: "20 редких бустеров",
    tokens: 20,
    tier: "rare",
    count: 20,
    limit: 25,
    icon: "assets/boosters/png/golden_shield.png",
  },
  {
    id: "clan",
    name: "15 клановых бустеров",
    tokens: 25,
    tier: "clan",
    count: 15,
    limit: 25,
    icon: "assets/boosters/clan-v2/256/fire.webp?art=20261124-clan-art",
  },
  {
    id: "coins",
    name: "250 монет",
    tokens: 10,
    currency: "coins",
    count: 250,
    icon: "assets/menu-icons/128/currency_coins.webp",
  },
  {
    id: "crystals",
    name: "25 кристаллов",
    tokens: 15,
    currency: "crystals",
    count: 25,
    icon: "assets/menu-icons/128/currency_crystals.webp",
  },
  {
    id: "bucks",
    name: "5 эфира",
    tokens: 20,
    currency: "bucks",
    count: 5,
    icon: "assets/menu-icons/128/currency_bucks.webp",
  },
  {
    id: "vip",
    name: "VIP на 1 час",
    tokens: 100,
    vipMs: 3600000,
    limit: 24,
    icon: "assets/accounts/vip.png",
  },
  { id: "chest", name: "Сундук Чёрной пятницы", tokens: 100, limit: 50,
    chest: true, icon: art + "chest.webp" },
];
const exchanges = [
  { id: "coins", currency: "coins", cost: 500, tokens: 10, limit: 10 },
  { id: "crystals", currency: "crystals", cost: 50, tokens: 15, limit: 10 },
  { id: "bucks", currency: "bucks", cost: 30, tokens: 10, limit: null },
];
const pools = Object.fromEntries(
  ["common", "advanced", "rare", "clan"].map((tier) => [
    tier,
    [...BOOSTERS.values()].filter((b) => b.tier === tier && b.ready).map((b) => b.id),
  ]),
);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const add = (a, b) => {
  if (!integer(a) || !integer(b) || !integer(a + b))
    throw new BoosterError("Достигнут предел счётчика.", 409);
  return a + b;
};
const day = (at) => Math.floor((at + MSK) / DAY);
const runAt = (manager, at) =>
  findRunAt(manager, at, manifest.contentPack);
function state(p, run) {
  p.blackFriday ||= { runs: {} };
  const s = (p.blackFriday.runs[run.id] ||= {
    tokens: 0,
    completedOrders: 0,
    days: {},
    purchases: {},
    finalAt: null,
  });
  ensureAchievementStages(s);
  return s;
}
function usesQuestSession(event) {
  return ["questSample", "lifeEnded", "absorbed", "arenaAction"].includes(event.type);
}
function progress(p, manager, event, at, session = p.quests?.session, changes = {}) {
  if (!usesQuestSession(event)) return;
  const run = runAt(manager, at);
  if (
    !run ||
    !session ||
    (event.type !== "absorbed" && session.id !== event.lifeId) ||
    event.reason === "recovered" ||
    (p.blackFriday?.runs?.[run.id]?.completedOrders || 0) >= book.eventLimit
  )
    return;
  const date = day(at),
    start = Math.max(run.startsAt, date * DAY - MSK);
  const old = p.blackFriday?.runs?.[run.id],
    d = book.daily(p, old, date, start, at);
  const updated = book.progress(p, d, event, at, start, session, changes, true);
  if (updated !== d) replaceDay(p, run, old, date, updated);
}
function replaceDay(p, run, old, date, d) {
  const updated = old
    ? { ...old, days: { ...old.days, [date]: d } }
    : { tokens: 0, completedOrders: 0, days: { [date]: d }, purchases: {}, finalAt: null };
  ensureAchievementStages(updated);
  p.blackFriday = { ...p.blackFriday, runs: { ...p.blackFriday?.runs, [run.id]: updated } };
}
// Atomic activity deltas. Views and replays never advance an order.
function activity(p, manager, changes, at) {
  if (!Object.values(changes).some(n => Number.isSafeInteger(n) && n > 0)) return;
  const run = runAt(manager, at);
  if (!run) return;
  const date = day(at), old = p.blackFriday?.runs?.[run.id];
  const start = Math.max(run.startsAt, date * DAY - MSK);
  const d = book.daily(p, old, date, start, at);
  const updated = book.activity(d, changes, at, true);
  if (updated !== d) replaceDay(p, run, old, date, updated);
}
// Count only appended economy receipts and actual credited kills, never old totals.
function captureOrders(p, previous, manager, at) {
  if (!previous || p === previous || !runAt(manager, at)) return p;
  const kills = Math.max(0, (p.progress?.kills || 0) - (previous.progress?.kills || 0));
  const before = previous.transactions?.entries || [], entries = p.transactions?.entries || [];
  const earned = entries.slice(before.length).filter(e => e.after.coins > e.before.coins);
  if (!kills && !earned.length) return p;
  // Copy only a changed book, not the archive of past events and rewards.
  const draft = { ...p };
  if (kills) activity(draft, manager, { creditedKills: kills }, at);
  // Use the transaction time, not the later save time. Earlier earnings cannot
  // complete an order assigned later in the same batch.
  for (const e of earned) activity(draft, manager, { coinsEarned: e.after.coins - e.before.coins }, e.at);
  return draft.blackFriday === p.blackFriday ? p : draft;
}

const achievement = (id, name, unit, thresholds, rewards, description) => ({
  id,
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
  { ...achievement(
    "friday_orders",
    "Главный исполнитель",
    "заказов",
    [5, 10, 25, 40, 50],
    [10, 25, 50, 150, 250],
    "Выполнять заказы Лавки Мани.",
  ), exception: true, cumulative: true },
  achievement(
    "friday_trophy",
    "Трофей",
    "регалий",
    [1],
    [500],
    "Получить регалию «Карточная шкатулка».",
  ),
  achievement(
    "friday_tokens",
    "Зажиточный",
    "жетонов",
    [100, 300, 600, 1000, 1500],
    [10, 25, 50, 150, 250],
    "Получить жетоны во время Чёрной пятницы.",
  ),
  achievement(
    "friday_exchange",
    "Обменник",
    "обменов",
    [5, 10, 20, 30, 50],
    [10, 25, 50, 150, 250],
    "Обменять валюту на жетоны.",
  ),
  achievement(
    "friday_shopper",
    "Ценный покупатель",
    "покупок",
    [10, 25, 50, 100, 200],
    [10, 25, 50, 150, 250],
    "Получить ценные призы в Лавке Мани.",
  ),
  achievement("friday_levels", "Личное дело", "уровней", [5, 10, 25, 50, 100],
    [10, 25, 50, 75, 100], "Получить уровни на арене за время события «Чёрная пятница»."),
  ...["common", "advanced", "rare", "clan"].map((tier, i) => achievement(
    "friday_" + tier, "Обменник " + ["I", "II", "III", "IV"][i], "обменов", [25], [100],
    "Обменять жетоны на " + ["обычные", "улучшенные", "редкие", "клановые"][i] + " бустеры 25 раз.")),
  achievement("friday_currency", "Обменник V", "валюты", [500, 1000, 2500, 5000, 10000],
    [25, 50, 150, 250, 500], "Получить монеты, кристаллы и эфир за жетоны."),
  achievement("friday_status", "Статус всегда", "часов VIP", [24], [500], "Обменять жетоны на 24 часа VIP."),
  achievement("friday_case", "Кейс", "сундуков", [1, 3, 5, 10, 15], [25, 50, 75, 100, 250],
    "Открыть сундуки Чёрной пятницы во время события."),
];
const oldThresholds = { friday_exchange: [1, 5, 10, 20, 50], friday_shopper: [1, 5, 10, 20, 30] };
function metrics(s) {
  return {
    friday_orders: s?.completedOrders || 0,
    friday_trophy: s?.finalAt != null ? 1 : 0,
    friday_tokens: Object.values(s?.days || {}).reduce((n, d) => n + (d.earned || 0), 0),
    friday_exchange: Object.values(s?.days || {}).reduce(
      (n, d) => n + Object.values(d.exchanges).reduce((a, b) => a + b, 0),
      0,
    ),
    friday_shopper: Object.values(s?.purchases || {}).reduce((a, b) => a + b, 0),
    friday_levels: s?.arenaLevels || 0,
    ...Object.fromEntries(["common", "advanced", "rare", "clan"].map(t => ["friday_" + t, s?.purchases?.[t] || 0])),
    friday_currency: (s?.purchases?.coins || 0) * 250 + (s?.purchases?.crystals || 0) * 25 + (s?.purchases?.bucks || 0) * 5,
    friday_status: s?.purchases?.vip || 0,
    friday_case: s?.openedChests || 0,
  };
}
function achievementState(s) {
  return { claimed: s?.achievementClaims || {}, stageSpent: s?.stageSpent };
}
function ensureAchievementStages(s) {
  if (s.achievementVersion !== 2) {
    s.legacyAchievementClaims = { ...(s.achievementClaims || {}) };
    s.achievementVersion = 2;
  }
  s.achievementClaims ||= {};
  const counters = achievementState(s);
  if (s.stageSpent === undefined) {
    const values = metrics(s);
    stages.ensure(counters, achievements, (a) => values[a.id]);
    s.stageSpent = counters.stageSpent;
  }
  return counters;
}
function award(p, s) {
  const values = metrics(s), counters = ensureAchievementStages(s);
  for (const a of achievements) {
    let count = s.achievementClaims[a.id] || 0;
    while (count < a.thresholds.length &&
        stages.current(counters, a, values[a.id]) >= a.thresholds[count]) {
      stages.consume(counters, a);
      p.greatness = add(p.greatness, a.rewards[count++]);
      s.achievementClaims[a.id] = count;
    }
    s.achievementClaims[a.id] = count;
  }
}
function migrate(p) {
  let changed = false;
  for (const s of Object.values(p.blackFriday?.runs || {})) {
    if (s.stageSpent !== undefined) continue;
    ensureAchievementStages(s);
    changed = true;
  }
  return changed;
}
function credit(s, d, amount, double = true) {
  const n = amount * (double && s.couponAt != null ? 2 : 1);
  s.tokens = add(s.tokens, n);
  d.earned = add(d.earned || 0, n);
  return n;
}
const tokenChestSources = new Set(["quest", "clan", "friday"]);
function chestTokenBonus(p, manager, at, source) {
  if (!tokenChestSources.has(source)) return 0;
  const run = runAt(manager, at);
  return run ? 3 * (p.blackFriday?.runs[run.id]?.couponAt != null ? 2 : 1) : 0;
}
// Only called after a successful opening, inside the same profile transaction.
function rewardChest(p, manager, at, source) {
  if (!tokenChestSources.has(source)) return;
  const run = runAt(manager, at);
  if (!run) return;
  const s = state(p, run);
  credit(s, book.ensure(p, s, day(at), Math.max(run.startsAt, day(at) * DAY - MSK), at), 3);
  award(p, s);
}
function activateCoupon(p, manager, eventId, at) {
  const run = runAt(manager, at);
  if (!run || run.id !== eventId) throw new BoosterError("Предложение купона завершилось.", 409);
  const s = state(p, run);
  if (s.couponAt != null) throw new BoosterError("Купон уже куплен для этого события.", 409);
  s.couponAt = at;
  credit(s, book.ensure(p, s, day(at), Math.max(run.startsAt, day(at) * DAY - MSK), at), 500, false);
  chests.grant(p, run.id, at);
  award(p, s);
}
function rewardCurrencyPack(p, run, votes, at) {
  if (!run) return 0;
  const s = state(p, run);
  // Package tokens are always votes x 10, including with Manya's coupon.
  const tokens = credit(s, book.ensure(p, s, day(at), Math.max(run.startsAt, day(at) * DAY - MSK), at), votes * 10, false);
  award(p, s);
  return tokens;
}
function rewardRoulette(p, run, amount, at) {
  if (!run || !Number.isSafeInteger(amount) || amount < 5 || amount > 10)
    throw new BoosterError("Неверная награда рулетки.");
  const s = state(p, run);
  // The owner explicitly excludes this prize from all account/coupon multipliers.
  credit(s, book.ensure(p, s, day(at), Math.max(run.startsAt, day(at) * DAY - MSK), at), amount, false);
  award(p, s);
}
function recordLevels(p, run, count, at) {
  // Arena drafts share the archived books/chests. A level reward is infrequent
  // and changes achievements as well as tokens: isolate its active run before
  // the ordinary reward logic mutates counters. Never copy all historical runs
  // for a movement sample, pickup or combat contact.
  const old = p.blackFriday?.runs?.[run.id];
  p.blackFriday = { ...p.blackFriday, runs: { ...p.blackFriday?.runs,
    ...(old ? { [run.id]: require("../profiles/arena-profile-copy").copyArenaData(old) } : {}) } };
  const s = state(p, run);
  s.arenaLevels = add(s.arenaLevels || 0, count);
  const tokens = credit(s, book.ensure(p, s, day(at), Math.max(run.startsAt, day(at) * DAY - MSK), at), count * 5);
  // Save the actual credit with the level receipt; the UI must not guess from a later coupon state.
  if (p.progress.lastLife?.levelReward)
    p.progress.lastLife.levelReward = { ...p.progress.lastLife.levelReward, fridayTokens: tokens };
  award(p, s);
}
function arena(p, manager, event, before, previousLevel, at) {
  const session = p.progress.session;
  if (session && before < p.progress.arenaXpTarget &&
      p.progress.xp + session.xp >= p.progress.arenaXpTarget) {
    const run = runAt(manager, at);
    if (run) session.fridayLevel = { runId: run.id, at };
  }
  if (p.level > previousLevel && event.fridayLevel) {
    const mark = event.fridayLevel, run = runAt(manager, mark.at);
    if (run?.id === mark.runId && runAt(manager, at)?.id === run.id)
      recordLevels(p, run, p.level - previousLevel, at);
    delete p.progress.lastLife.pendingFridayLevel;
  }
}
const needsRecovery = p => !!p.progress.lastLife?.pendingFridayLevel;
const recoveryKeys = (world, cache) => cache
  ? cache.matchingProfiles("fridayRecovery", world.profiles, needsRecovery)
  : Object.keys(world.profiles).filter(key => needsRecovery(world.profiles[key]));
const recoveryDue = (world, manager, cache) => !!manager &&
  (cache ? recoveryKeys(world, cache).size > 0 : Object.values(world.profiles).some(needsRecovery));
function recover(world, manager, at, cache) {
  if (!manager) return world;
  const keys = [...recoveryKeys(world, cache)];
  if (!keys.length) return world;
  const next = { ...world, profiles: { ...world.profiles } };
  for (const id of keys) {
    const original = world.profiles[id];
    const mark = original.progress.lastLife?.pendingFridayLevel;
    if (!mark) continue;
    const p = copyProfile(original), run = runAt(manager, mark.at);
    if (run?.id === mark.runId && runAt(manager, at)?.id === run.id)
      recordLevels(p, run, p.progress.lastLife.levelReward.levels, at);
    delete p.progress.lastLife.pendingFridayLevel;
    require("../progression/title-chest-rewards").awardTitles(p, at);
    validate(p);
    p.revision++;
    next.profiles[id] = p;
  }
  require("../profiles/immutable-table-delta").remember(next.profiles,world.profiles,keys);
  return next;
}
function achievementView(p, manager, at) {
  const run = runAt(manager, at);
  if (!run) return [];
  const s = p.blackFriday?.runs?.[run.id],
    values = metrics(s);
  return achievements.map((a) => ({
    ...a,
    eventRunId: run.id,
    value: stages.current(achievementState(s), a, values[a.id]),
    claimed: s?.achievementClaims?.[a.id] || 0,
    description: "Чёрная пятница. " + a.description,
  }));
}
function regalia(p) {
  return Object.entries(p.blackFriday?.runs || {})
    .filter(([, s]) => s.finalAt !== null)
    .map(([runId, s]) => ({
      id: "card-casket",
      runId,
      name: "Карточная шкатулка",
      image: art + "regalia-v2.webp",
      awardedAt: s.finalAt,
      description: `Выполнено ${s.finalTarget || 15} заказов Лавки Мани во время Чёрной пятницы.`,
    }));
}
function albumPictures(p) {
  return [
    {
      id: "manya-casket",
      name: "Сделка с Маней",
      image: art + "album.webp",
      progress: regalia(p).length ? 1 : 0,
      target: 1,
    },
  ];
}
function arenaOrders(p, manager, at) {
  const run = runAt(manager, at);
  if (!run) return [];
  const s = p.blackFriday?.runs?.[run.id];
  if ((s?.completedOrders || 0) >= book.eventLimit) return [];
  const d = book.daily(p, s, day(at), Math.max(run.startsAt, day(at) * DAY - MSK), at);
  return book.rows(d).map(o => ({ id: run.id + ":" + day(at) + ":" + o.id,
    name: o.name, description: o.description, metric: o.metric, icon: o.icon,
    progress: o.progress, target: o.target, claimed: o.claimed,
    priority: o.tokens, reward: o.tokens * (s?.couponAt != null ? 2 : 1),
    expiresAt: Math.min(run.endsAt, (day(at) + 1) * DAY - MSK) }));
}
function view(p, manager, at) {
  const run = runAt(manager, at);
  if (!run) return { active: false };
  const s = p.blackFriday?.runs?.[run.id],
    d = book.daily(p, s, day(at), Math.max(run.startsAt, day(at) * DAY - MSK), at);
  return {
    active: true,
    runId: run.id,
    title: manifest.title,
    startsAt: run.startsAt,
    endsAt: run.endsAt,
    day: day(at),
    resetAt: Math.min(run.endsAt, (day(at) + 1) * DAY - MSK),
    tokens: s?.tokens || 0,
    completedOrders: s?.completedOrders || 0,
    finalTarget: 50,
    finalClaimed: s?.finalAt != null,
    coupon: { price: 50, active: s?.couponAt != null },
    chestEther: { cost: 100, currency: "bucks" },
    chestVipChance: s?.couponAt != null ? 4 : 2,
    chestTokens: chestTokenBonus(p, manager, at, "friday"),
    chestContents: chests.contents(p, run.id, at, manager),
    orders: book
      .rows(d)
      .map((o) => ({ ...o, tokens: o.tokens * (s?.couponAt != null ? 2 : 1), claimed: o.claimed || (s?.completedOrders || 0) >= book.eventLimit })),
    ordersComplete: (s?.completedOrders || 0) >= book.eventLimit,
    dailyCompleted: book.count(d),
    dailyLimit: book.dailyLimit,
    eventLimit: book.eventLimit,
    swapCost: d.swaps ? 3 : 0,
    achievements: achievementView(p, manager, at),
    shop: shop.map((o) => ({ ...o, limit: o.id === "vip" && s?.couponAt != null ? null : o.limit, bought: s?.purchases?.[o.id] || 0 })),
    exchanges: exchanges.map((o) => ({ ...o, tokens: o.tokens * (s?.couponAt != null ? 2 : 1), used: d.exchanges[o.id] || 0 })),
    history: Object.entries(s?.days || {}).map(([date, v]) => ({
      day: Number(date),
      count: book.count(v),
    })),
  };
}
function mutate(store, token, input, random = randomInt) {
  if (
    !input ||
    !["order", "swap", "buy", "exchange", "final", "chest-ether", "prepare", "open"].includes(input.action) ||
    typeof input.runId !== "string" ||
    input.runId.length > 80 ||
    (input.id !== undefined && (typeof input.id !== "string" || input.id.length > 80)) ||
    !integer(input.day)
  )
    throw new BoosterError("Неверная операция лавки.");
  const result = store.transactProfile(
    token,
    input.requestId,
    JSON.stringify(["black-friday", input.runId, input.day, input.action, input.id || null]),
    (p) => {
      const at = store.now(),
        run = runAt(store.events, at);
      if (["prepare", "open"].includes(input.action)) {
        chests.act(p, input, at, random);
        if (input.action === "open") {
          require("../accounts/lite-account").chestOpened(p, store.rouletteConfig, at);
          rewardChest(p, store.events, at, "friday");
          if (run?.id === input.runId) {
            const s = state(p, run);
            s.openedChests = add(s.openedChests || 0, 1);
            award(p, s);
          }
        }
        validate(p);
        return;
      }
      if (!run || run.id !== input.runId)
        throw new BoosterError("Лавка закрыта. Событие завершилось.", 409);
      if (input.day !== day(at)) throw new BoosterError("Начался новый день. Обнови лавку.", 409);
      const s = state(p, run),
        d = book.ensure(p, s, day(at), Math.max(run.startsAt, day(at) * DAY - MSK), at);
      if (input.action === "order" || input.action === "swap") {
        if (s.completedOrders >= book.eventLimit)
          throw new BoosterError("Все 84 заказа события выполнены.", 409);
        const o = book.rows(d).find((o) => o.id === input.id),
          swap = input.action === "swap";
        if (!o || o.claimed || (!swap && o.progress < o.target))
          throw new BoosterError("Заказ изменился, ещё не выполнен или уже получен.", 409);
        book.advance(p, d, day(at), o, at, random, swap);
        if (!swap) {
          s.completedOrders = add(s.completedOrders, 1);
          credit(s, d, o.tokens);
        }
      } else if (input.action === "buy") {
        const o = shop.find((o) => o.id === input.id);
        const limit = o?.id === "vip" && s.couponAt != null ? null : o?.limit;
        if (!o || s.tokens < o.tokens || (limit && (s.purchases[o.id] || 0) >= limit))
          throw new BoosterError("Не хватает жетонов или достигнут лимит покупки.", 409);
        s.tokens -= o.tokens;
        s.purchases[o.id] = add(s.purchases[o.id] || 0, 1);
        if (o.chest) chests.grant(p, run.id, at);
        if (o.currency) {
          const transactions = require("../profiles/transaction-history");
          const before = transactions.snapshot(p);
          p.wallet[o.currency] = add(p.wallet[o.currency], o.count);
          transactions.record(p, before, at, {
            ...transactions.operation(JSON.stringify(["black-friday", input.runId, input.day, input.action, input.id]), input.requestId, p.id),
            reward: { [o.currency]: o.count },
          });
        }
        if (o.vipMs) {
          p.account ||= require("../accounts/account-benefits").fresh();
          p.account.vipUntil = add(Math.max(p.account.vipUntil || 0, at), o.vipMs);
        }
        if (o.tier) {
          const pool = pools[o.tier];
          const items = {};
          for (let i = 0; i < o.count; i++) {
            const id = pool[random(pool.length)];
            if (!id) throw Error("Не удалось выбрать бустер.");
            p.inventory[id] = add(p.inventory[id] || 0, 1);
            items[id] = (items[id] || 0) + 1;
          }
          // Persist the exact draw with the debit. A lost response must show
          // the same items, even after another purchase or a server restart.
          s.boosterRewards ||= {};
          s.boosterRewards[input.requestId] = { offerId: o.id, at, count: o.count, items };
        }
      } else if (input.action === "exchange") {
        const o = exchanges.find((o) => o.id === input.id);
        if (
          !o ||
          p.wallet[o.currency] < o.cost ||
          (o.limit != null && (d.exchanges[o.id] || 0) >= o.limit)
        )
          throw new BoosterError("Не хватает валюты или исчерпан обмен на сегодня.", 409);
        p.wallet[o.currency] -= o.cost;
        require("../progression/activity-achievements").spend(p, o.currency, o.cost, at);
        credit(s, d, o.tokens);
        d.exchanges[o.id] = add(d.exchanges[o.id] || 0, 1);
      } else if (input.action === "chest-ether") {
        if (p.wallet.bucks < 100) throw new BoosterError("Нужно 100 эфира.", 409);
        p.wallet.bucks -= 100;
        require("../progression/activity-achievements").spend(p, "bucks", 100, at);
        s.purchases.chestEther = add(s.purchases.chestEther || 0, 1);
        chests.grant(p, run.id, at);
      } else {
        if (s.finalAt !== null || s.completedOrders < 50)
          throw new BoosterError("Выполни 50 заказов. Итоговая награда выдаётся один раз.", 409);
        s.finalAt = at;
        s.finalTarget = 50;
      }
      award(p, s);
      // Activity replaces the run with a copy when an order advances. Finish
      // its receipt and awards first, so they remain in the published run.
      const boughtBoosters = input.action === "buy" && shop.find(o => o.id === input.id && o.tier);
      if (boughtBoosters) activity(p, store.events, { purchasedBoosters: boughtBoosters.count }, at);
      validate(p);
    },
  );
  const reward = input.action === "buy"
    ? store.find(token).blackFriday?.runs[input.runId]?.boosterRewards?.[input.requestId]
    : null;
  const currency = input.action === "buy" && shop.find(o => o.id === input.id)?.currency;
  if (currency) return { ...result, currencyReward: require("../profiles/transaction-history")
    .currencyReward(store.find(token), input.requestId, currency) };
  return reward ? { ...result, reward: { ...reward, requestId: input.requestId } } : result;
}
function validate(p) {
  if (p.blackFriday === undefined) return;
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  const validMap = (v, ids) =>
    object(v) && Object.entries(v).every(([k, n]) => ids.includes(k) && integer(n));
  if (!object(p.blackFriday) || !object(p.blackFriday.runs))
    throw Error("Повреждена история лавки.");
  chests.validate(p);
  for (const [id, s] of Object.entries(p.blackFriday.runs)) {
    if (
      !id ||
      !object(s) ||
      !integer(s.tokens) ||
      !integer(s.completedOrders) ||
      (s.finalAt !== null && !integer(s.finalAt)) ||
      !object(s.days) ||
      !validMap(
        s.purchases,
        [...shop.map((o) => o.id), "chestEther"],
      )
    )
      throw Error("Повреждены награды лавки.");
    if (s.finalTarget !== undefined && s.finalTarget !== 50) throw Error("Повреждена цель лавки.");
    if (s.boosterRewards !== undefined) {
      if (!object(s.boosterRewards) || Object.keys(s.boosterRewards).length > 100)
        throw Error("Повреждены квитанции бустеров лавки.");
      const counts = {};
      for (const [requestId, reward] of Object.entries(s.boosterRewards)) {
        const offer = shop.find(o => o.id === reward?.offerId && o.tier);
        if (!/^[a-f0-9-]{36}$/i.test(requestId) || !offer || !integer(reward.at) ||
            !integer(reward.count) || reward.count < 1 || reward.count > 1000 ||
            !validMap(reward.items, pools[offer.tier]) ||
            Object.values(reward.items).some(n => n === 0) ||
            Object.values(reward.items).reduce((sum, n) => sum + n, 0) !== reward.count)
          throw Error("Повреждён состав бустеров лавки.");
        counts[offer.id] = (counts[offer.id] || 0) + 1;
      }
      if (Object.entries(counts).some(([id, count]) => count > (s.purchases[id] || 0)))
        throw Error("Квитанции лавки не соответствуют покупкам.");
    }
    if ((s.couponAt !== undefined && !integer(s.couponAt)) ||
        (s.arenaLevels !== undefined && !integer(s.arenaLevels)) ||
        (s.openedChests !== undefined && !integer(s.openedChests))) throw Error("Повреждён купон или счётчики лавки.");
    const legacy = s.legacyAchievementClaims || {}, values = metrics(s);
    if (!validMap(legacy, achievements.map(a => a.id)) || achievements.some(a =>
      (legacy[a.id] || 0) > (oldThresholds[a.id] || a.thresholds).filter(n => n <= values[a.id]).length))
      throw Error("Повреждена история достижений лавки.");
    if (
      s.achievementClaims !== undefined &&
      (!validMap(
        s.achievementClaims,
        achievements.map((a) => a.id),
      ) ||
        achievements.some(
          (a) =>
            (s.achievementClaims[a.id] || 0) >
            Math.max(legacy[a.id] || 0, (s.achievementVersion === 2 ? a.thresholds : oldThresholds[a.id] || a.thresholds).filter((n) => n <= values[a.id]).length),
        ))
    )
      throw Error("Повреждены достижения лавки.");
    stages.validate(achievementState(s), achievements, (a) => values[a.id]);
    let count = 0;
    for (const [date, d] of Object.entries(s.days)) {
      if (
        !/^\d+$/.test(date) ||
        !object(d) ||
        ([2, 3].includes(d.version)
          ? !book.validate(d)
          : !orders.every((o) => integer(d[o.id]) && d[o.id] <= o.target) ||
            !Array.isArray(d.claimed) ||
            new Set(d.claimed).size !== d.claimed.length ||
            !d.claimed.every((id) => orders.some((o) => o.id === id && d[id] >= o.target))) ||
        !validMap(
          d.exchanges,
          exchanges.map((o) => o.id),
        ) ||
        !exchanges.every((o) => o.limit == null || (d.exchanges[o.id] || 0) <= o.limit)
      )
        throw Error("Повреждены заказы лавки.");
      count += book.count(d);
    }
    if (
      !integer(s.testOrderCredits ?? 0) ||
      (s.testOrderCredits ?? 0) > 49 ||
      count + (s.testOrderCredits ?? 0) !== s.completedOrders ||
      (s.finalAt !== null && s.completedOrders < (s.finalTarget || 15))
    )
      throw Error("Повреждён прогресс лавки.");
  }
}
module.exports = {
  usesQuestSession,
  activity,
  captureOrders,
  manifest,
  achievements,
  achievementView,
  runAt,
  progress,
  arena,
  activateCoupon,
  chestTokenBonus,
  rewardChest,
  rewardCurrencyPack,
  rewardRoulette,
  recover,
  recoveryDue,
  view,
  arenaOrders,
  mutate,
  validate,
  migrate,
  regalia,
  albumPictures,
  orders,
  shop,
  exchanges,
  day,
};
