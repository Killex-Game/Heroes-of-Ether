"use strict";
const { BoosterError } = require("../boosters/booster-catalog");
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const object = (o) => o && typeof o === "object" && !Array.isArray(o);
const PRICES = Object.freeze({ coins: 100, crystals: 10, bucks: 2 });
const LIMIT = 50;
// Расписание с реальными событиями отключает бессрочный тестовый доступ,
// даже если для самой рулетки оставлен testEnabled.
function event(config, at) {
  const current = config.events.find((e) => e.startsAt <= at && at < e.endsAt);
  if (current?.lite === false) return null;
  if (current)
    return {
      id: current.id || `event:${current.startsAt}:${current.endsAt}`,
      endsAt: current.endsAt,
    };
  return config.testEnabled && config.events.length === 0
    ? { id: "test:unlimited", endsAt: null }
    : null;
}
function view(p, config, at) {
  const scope = event(config, at),
    owned = scope && p.lite?.events[scope.id];
  // The current run defines the term, including an owner's extension or shortening.
  // The purchase record retains its original term and per-run limits for audit/replays.
  const active = !!owned;
  return {
    available: !!scope,
    eventId: scope?.id || null,
    endsAt: scope?.endsAt ?? null,
    active,
    prices: PRICES,
    remaining: {
      coins: LIMIT - (owned?.coinTickets || 0),
      crystals: LIMIT - (owned?.crystalTickets || 0),
      bucks: null,
    },
  };
}
function grantTickets(p, amount) {
  const r = p.roulette;
  if (!integer(amount) || !integer(r.tickets + amount) || !integer(r.earned + amount))
    throw new BoosterError("Превышен допустимый баланс билетов.", 409);
  r.tickets += amount;
  r.earned += amount;
}
function activate(p, config, at, eventId) {
  const scope = event(config, at);
  if (!scope || scope.id !== eventId)
    throw new BoosterError(
      "Предложение Lite закончилось или изменилось. Открой окно статусов заново.",
      409,
    );
  if (p.progress.session) throw new BoosterError("Покупка Lite доступна в лобби.", 409);
  if (p.lite?.events[scope.id]) throw new BoosterError("Lite уже куплен для этого события.", 409);
  p.lite ||= { events: {} };
  p.lite.events[scope.id] = {
    activatedAt: at,
    endsAt: scope.endsAt,
    coinTickets: 0,
    crystalTickets: 0,
  };
  grantTickets(p, 50);
}
function buyTickets(p, config, at, input) {
  const { currency, quantity, eventId } = input;
  if (
    typeof currency !== "string" ||
    !Object.hasOwn(PRICES, currency) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 10000
  )
    throw new BoosterError("Выбери валюту и количество билетов от 1 до 10 000.");
  const status = view(p, config, at);
  if (!status.active || status.eventId !== eventId)
    throw new BoosterError("Для покупки билетов нужен активный Lite текущего события.", 409);
  if (status.remaining[currency] !== null && quantity > status.remaining[currency])
    throw new BoosterError("Лимит покупки за эту валюту - 50 билетов за событие.", 409);
  const cost = PRICES[currency] * quantity;
  if (p.wallet[currency] < cost)
    throw new BoosterError("Недостаточно валюты для покупки билетов.", 409);
  p.wallet[currency] -= cost;
  const record = p.lite.events[eventId];
  if (currency === "coins") record.coinTickets += quantity;
  if (currency === "crystals") record.crystalTickets += quantity;
  grantTickets(p, quantity);
  require("../progression/activity-achievements").spend(p, currency, cost, at);
}
function chestOpened(p, config, at) {
  if (view(p, config, at).active) grantTickets(p, 1);
}
function validate(p) {
  if (p.lite === undefined) return;
  if (!object(p.lite) || !object(p.lite.events)) throw Error("Повреждены данные Lite.");
  for (const [id, item] of Object.entries(p.lite.events))
    if (
      !/^[a-zA-Z0-9:_-]{1,100}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id) ||
      !object(item) ||
      ![item.activatedAt, item.coinTickets, item.crystalTickets].every(integer) ||
      item.coinTickets > LIMIT ||
      item.crystalTickets > LIMIT ||
      !(item.endsAt === null || (integer(item.endsAt) && item.endsAt > item.activatedAt))
    )
      throw Error("Повреждены сроки или лимиты Lite.");
}
module.exports = { event, view, activate, buyTickets, chestOpened, grantTickets, validate };
