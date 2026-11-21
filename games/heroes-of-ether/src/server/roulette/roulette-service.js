"use strict";
const crypto = require("node:crypto");
const { BOOSTERS, BoosterError } = require("../boosters/booster-catalog");
const accounts = require("../accounts/account-benefits");
const lite = require("../accounts/lite-account");
const R = require("../../../public/shared/roulette-rules");
const friday = require("../events/black-friday");
// Старые составы нужны для проверки сохранённых выигрышей и безопасного повтора запроса.
// Новые колёса и новые списания всегда используют текущую версию правил.
const legacyRules = {
  slots: [
    "vip",
    "common",
    "coins",
    "advanced",
    "rare",
    "crystals",
    "common",
    "coins",
    "advanced",
    "rare",
    "crystals",
    "common",
    "advanced",
    "rare",
  ],
  categories: [
    { id: "common", min: 10, max: 20 },
    { id: "rare", min: 5, max: 10 },
    { id: "advanced", min: 7, max: 15 },
  ],
};
const versionTwoRules = {
  slots: [
    "vip",
    "rare",
    "coins",
    "advanced",
    "clan",
    "crystals",
    "rare",
    "coins",
    "advanced",
    "clan",
    "crystals",
    "rare",
    "advanced",
    "clan",
  ],
  categories: [
    { id: "rare", min: 10, max: 20 },
    { id: "clan", min: 5, max: 10 },
    { id: "advanced", min: 7, max: 15 },
  ],
};
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const object = (o) => o && typeof o === "object" && !Array.isArray(o);
function add(a, b) {
  if (!integer(a) || !integer(b) || !integer(a + b))
    throw new BoosterError("Превышен допустимый баланс.", 409);
  return a + b;
}
function fresh(level = 1) {
  return {
    tickets: 0,
    earned: 0,
    spent: 0,
    levelGrantedThrough: level,
    offer: null,
    results: {},
    lastRequestId: null,
  };
}
function grantLevels(p, previousLevel) {
  const r = (p.roulette ||= fresh(previousLevel));
  const count = Math.max(0, p.level - r.levelGrantedThrough);
  r.tickets = add(r.tickets, count);
  r.earned = add(r.earned, count);
  r.levelGrantedThrough = Math.max(p.level, r.levelGrantedThrough);
}
function configuration(config = {}) {
  if (
    !object(config) ||
    (config.testEnabled !== undefined && typeof config.testEnabled !== "boolean") ||
    (config.events !== undefined && !Array.isArray(config.events))
  )
    throw Error("Неверное расписание рулетки.");
  const events = config.events || [];
  const ids = new Set();
  for (const e of events) {
    if (
      !object(e) ||
      !integer(e.startsAt) ||
      !integer(e.endsAt) ||
      e.endsAt <= e.startsAt ||
      (e.lite !== undefined && typeof e.lite !== "boolean") ||
      (e.id !== undefined &&
        (typeof e.id !== "string" ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(e.id) ||
          ["__proto__", "constructor", "prototype"].includes(e.id)))
    )
      throw Error("Неверные даты события рулетки.");
    const id = e.id || `event:${e.startsAt}:${e.endsAt}`;
    if (
      ids.has(id) ||
      events.some((other) => other !== e && other.startsAt < e.endsAt && e.startsAt < other.endsAt)
    )
      throw Error("События рулетки не должны повторяться или пересекаться.");
    ids.add(id);
  }
  return { testEnabled: config.testEnabled === true, events: structuredClone(events) };
}
function available(config, at) {
  return config.testEnabled || config.events.some((e) => e.startsAt <= at && at < e.endsAt);
}
function validReward(item, category, rules) {
  if (!object(item) || item.category !== category || !integer(item.amount) || item.amount < 1)
    return false;
  if (category === "vip") return item.amount === R.vipMs;
  if (category === "coins") return [50, 100].includes(item.amount);
  if (category === "crystals") return [10, 15].includes(item.amount);
  if (category === "fridayTokens") return item.amount >= 5 && item.amount <= 10 && !item.boosterId;
  const spec = rules.categories.find((c) => c.id === category);
  return (
    spec &&
    BOOSTERS.get(item.boosterId)?.tier === category &&
    item.amount >= spec.min &&
    item.amount <= spec.max
  );
}
function validOffer(offer) {
  const rules =
    offer?.rulesVersion === undefined || offer?.rulesVersion === 1
      ? legacyRules
      : offer?.rulesVersion === 2
        ? versionTwoRules
        : offer?.rulesVersion === 3
          ? R
          : offer?.rulesVersion === R.version
          ? R.forEvent(offer.variant)
          : null;
  return (
    rules &&
    object(offer) &&
    typeof offer.id === "string" &&
    (offer.variant === undefined || (offer.rulesVersion === R.version &&
      offer.variant === "black-friday" && typeof offer.eventId === "string" && offer.eventId.length > 0)) &&
    integer(offer.at) &&
    Array.isArray(offer.slots) &&
    offer.slots.length === rules.slots.length &&
    offer.slots.every((s, i) => validReward(s, rules.slots[i], rules))
  );
}
const checkedArchives = new WeakMap();
function validate(p, reuseArchive = false) {
  lite.validate(p);
  const r = p.roulette;
  if (
    !object(r) ||
    ![r.tickets, r.earned, r.spent, r.levelGrantedThrough].every(integer) ||
    r.levelGrantedThrough < 1 ||
    r.earned - r.spent !== r.tickets ||
    !object(r.results) ||
    (r.offer !== null && !validOffer(r.offer))
  )
    throw Error("Повреждены данные рулетки. Сохранение не перезаписано.");
  if (r.lastRequestId !== null && !Object.hasOwn(r.results, r.lastRequestId))
    throw Error("Не найден последний результат рулетки.");
  if (reuseArchive && checkedArchives.get(r.results) === r.spent) return;
  let spent = 0;
  for (const [id, result] of Object.entries(r.results)) {
    if (
      !/^[a-zA-Z0-9_-]{16,80}$/.test(id) ||
      !object(result) ||
      result.requestId !== id ||
      !validOffer(result.offer) ||
      !integer(result.at) ||
      !integer(result.index) ||
      result.index >= R.slots.length
    )
      throw Error("Повреждён результат рулетки.");
    if (
      result.extraSpins !== undefined &&
      (!Array.isArray(result.extraSpins) ||
        result.extraSpins.length !== 4 ||
        result.extraSpins.some(
          (spin) =>
            !object(spin) ||
            !validOffer(spin.offer) ||
            !integer(spin.index) ||
            spin.index >= R.slots.length,
        ))
    )
      throw Error("Повреждены результаты пяти вращений.");
    spent += 1 + (result.extraSpins?.length || 0);
  }
  if (spent !== r.spent) throw Error("Не совпадает число вращений рулетки.");
  checkedArchives.set(r.results, spent);
}
function describe(reward) {
  if (reward.category === "fridayTokens") return { ...reward,
    name: "Жетоны Мани × " + reward.amount,
    icon: "assets/events/black-friday/token-v2.webp", label: String(reward.amount) };
  if (reward.category === "vip")
    return { ...reward, name: "1 час VIP", icon: "assets/accounts/vip.png", label: "1 ч" };
  if (["coins", "crystals"].includes(reward.category))
    return {
      ...reward,
      name: reward.amount + (reward.category === "coins" ? " монет" : " кристаллов"),
      icon: "assets/menu-icons/128/currency_" + reward.category + ".webp",
      label: String(reward.amount),
    };
  const b = BOOSTERS.get(reward.boosterId);
  return {
    ...reward,
    name: b.name + " × " + reward.amount,
    icon: b.icon,
    label: "×" + reward.amount,
  };
}
function offerView(offer) {
  return offer ? { ...offer, slots: offer.slots.map(describe) } : null;
}
function resultView(result) {
  return result
    ? {
        ...result,
        offer: offerView(result.offer),
        reward: describe(result.offer.slots[result.index]),
        ...(result.extraSpins
          ? {
              spins: [result, ...result.extraSpins].map((spin) => ({
                offer: offerView(spin.offer),
                index: spin.index,
                reward: describe(spin.offer.slots[spin.index]),
              })),
            }
          : {}),
      }
    : null;
}
function currentOffer(offer, run) {
  return offer?.rulesVersion === R.version &&
    (run ? offer.variant === "black-friday" && offer.eventId === run.id : !offer.variant);
}
function view(p, config, at, manager) {
  const r = p.roulette;
  const run = friday.runAt(manager, at);
  return {
    tickets: r.tickets,
    available: available(config, at),
    testing: config.testEnabled,
    lite: lite.view(p, config, at),
    variant: run ? "black-friday" : "default",
    offer: currentOffer(r.offer, run) ? offerView(r.offer) : null,
    lastSpin: resultView(r.results[r.lastRequestId]),
  };
}
function makeOffer(at, randomInt, run = null) {
  const rules = R.forEvent(run ? "black-friday" : "default");
  const pools = Object.fromEntries(
    R.categories
      .filter((c) => c.min)
      .map(({ id: tier }) => [
        tier,
        [...BOOSTERS.values()].filter((b) => b.ready && b.tier === tier).map((b) => b.id),
      ]),
  );
  let coins = 0,
    crystals = 0;
  return {
    id: crypto.randomUUID(),
    rulesVersion: R.version,
    ...(run ? { variant: "black-friday", eventId: run.id } : {}),
    at,
    slots: rules.slots.map((category) => {
      if (category === "fridayTokens") return { category, amount: 5 + randomInt(6) };
      if (category === "vip") return { category, amount: R.vipMs };
      if (category === "coins") return { category, amount: coins++ ? 50 : 100 };
      if (category === "crystals") return { category, amount: crystals++ ? 15 : 10 };
      const spec = R.categories.find((c) => c.id === category),
        pool = pools[category];
      const [boosterId] = pool.splice(randomInt(pool.length), 1);
      return { category, boosterId, amount: spec.min + randomInt(spec.max - spec.min + 1) };
    }),
  };
}
function pick(offer, randomInt) {
  if (offer.rulesVersion !== R.version)
    throw new BoosterError("Состав рулетки обновился. Открой её заново.", 409);
  let roll = randomInt(R.totalWeight);
  const category = R.forEvent(offer.variant).categories.find((c) => {
    roll -= c.weight;
    return roll < 0;
  });
  const indexes = offer.slots.flatMap((s, i) => (s.category === category.id ? [i] : []));
  return indexes[randomInt(indexes.length)];
}
function mutate(store, token, input, randomInt = crypto.randomInt) {
  if (
    !object(input) ||
    !["prepare", "spin", "spin-five", "tickets"].includes(input.action) ||
    (["spin", "spin-five"].includes(input.action) &&
      (typeof input.offerId !== "string" || input.offerId.length > 80))
  )
    throw new BoosterError("Неверное действие рулетки.");
  const result = store.transactProfile(
    token,
    input.requestId,
    JSON.stringify(
      input.action === "tickets"
        ? ["roulette", "tickets", input.currency, input.quantity, input.eventId]
        : [
            "roulette",
            input.action,
            ["spin", "spin-five"].includes(input.action) ? input.offerId : null,
          ],
    ),
    (p) => {
      const at = store.now(),
        r = p.roulette,
        run = friday.runAt(store.events, at);
      if (input.rulesVersion !== R.version)
        throw new BoosterError("Состав рулетки обновился. Обнови страницу через Ctrl+F5.", 409);
      if (p.progress.session) throw new BoosterError("Рулетка доступна в лобби.", 409);
      if (!available(store.rouletteConfig, at))
        throw new BoosterError("Рулетка откроется в дни события.", 409);
      if (input.action === "tickets") {
        lite.buyTickets(p, store.rouletteConfig, at, input);
        return;
      }
      if (input.action === "prepare") {
        if (!currentOffer(r.offer, run)) r.offer = makeOffer(at, randomInt, run);
        return;
      }
      if (!currentOffer(r.offer, run) || r.offer.id !== input.offerId)
        throw new BoosterError("Колесо уже обновилось. Открой рулетку заново.", 409);
      const count = input.action === "spin-five" ? 5 : 1;
      if (r.tickets < count)
        throw new BoosterError(
          count === 5
            ? "Для пяти вращений нужны 5 билетов."
            : "Нужен билет. Каждый новый уровень даёт один билет.",
          409,
        );
      const spins = [];
      for (let i = 0; i < count; i++) {
        const offer = i === 0 ? r.offer : makeOffer(at, randomInt, run),
          index = pick(offer, randomInt),
          reward = offer.slots[index];
        if (reward.category === "vip") {
          p.account ||= accounts.fresh();
          p.account.vipUntil = add(Math.max(at, p.account.vipUntil), R.vipMs);
        } else if (reward.category === "fridayTokens")
          friday.rewardRoulette(p, run, reward.amount, at);
        else if (["coins", "crystals"].includes(reward.category))
          p.wallet[reward.category] = add(p.wallet[reward.category], reward.amount);
        else p.inventory[reward.boosterId] = add(p.inventory[reward.boosterId] || 0, reward.amount);
        require("../events/lucky-week").spin(p, store.events, reward, at);
        friday.activity(p, store.events, { rouletteSpins: 1 }, at);
        spins.push({ offer, index });
      }
      r.tickets -= count;
      r.spent = add(r.spent, count);
      r.results = { ...r.results, [input.requestId]: {
        requestId: input.requestId,
        at,
        ...spins[0],
        ...(count === 5 ? { extraSpins: spins.slice(1) } : {}),
      } };
      r.lastRequestId = input.requestId;
      r.offer = null;
    },
  );
  return {
    ...result,
    result: ["spin", "spin-five"].includes(input.action)
      ? resultView(store.find(token).roulette.results[input.requestId])
      : null,
  };
}
module.exports = {
  fresh,
  grantLevels,
  configuration,
  available,
  validate,
  view,
  mutate,
  makeOffer,
  pick,
};
