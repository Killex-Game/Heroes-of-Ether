/* История экономики сохраняется атомарно вместе с балансом и receipts. */
"use strict";
const { copyRecord } = require("./copy-record");
const tableDeltas = require("./immutable-table-delta");
const { randomUUID } = require("node:crypto");
const products = require("../../../public/shared/virtual-product-catalog");
const fields = ["coins", "crystals", "bucks", "vipUntil", "premiumUntil"];
const snapshot = (p) => ({
  coins: p.wallet.coins,
  crystals: p.wallet.crystals,
  bucks: p.wallet.bucks || 0,
  vipUntil: p.account?.vipUntil || 0,
  premiumUntil: p.account?.premiumUntil || 0,
});
const equal = (a, b) => fields.every((key) => a[key] === b[key]);
const validBalance = (value) =>
  value && fields.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
const validReward = (value) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length > 0 && Object.entries(value).every(([key, n]) =>
    ["coins", "crystals", "bucks", "fridayTokens"].includes(key) && Number.isSafeInteger(n) && n > 0);
const system = { kind: "server", label: "Изменение экономики сервером" };
function initialize(p, at) {
  p.transactions ||= { version: 1, startedAt: at, opening: snapshot(p), entries: [] };
}
function validate(p) {
  const log = p.transactions;
  if (!log) return;
  const invalid = () => {
    throw Error("Повреждён журнал транзакций. Сохранение не перезаписано.");
  };
  if (
    log.version !== 1 ||
    !Number.isSafeInteger(log.startedAt) ||
    log.startedAt < 0 ||
    !validBalance(log.opening) ||
    !Array.isArray(log.entries)
  )
    invalid();
  let balance = log.opening;
  const ids = new Set();
  for (const e of log.entries) {
    if (
      !e ||
      typeof e.id !== "string" ||
      ids.has(e.id) ||
      !Number.isSafeInteger(e.at) ||
      e.at < 0 ||
      typeof e.kind !== "string" ||
      typeof e.label !== "string" ||
      !validBalance(e.before) ||
      !validBalance(e.after) ||
      !equal(e.before, balance) ||
      (equal(e.before, e.after) && !e.payment)
    )
      invalid();
    if (
      e.payment &&
      (e.payment.provider !== "mock" ||
        e.payment.simulated !== true ||
        e.payment.status !== "confirmed" ||
        typeof e.payment.productId !== "string" ||
        !Number.isSafeInteger(e.payment.votes) ||
        e.payment.votes < 0)
    )
      invalid();
    if (e.reward !== undefined && !validReward(e.reward)) invalid();
    ids.add(e.id);
    balance = e.after;
  }
  if (!equal(balance, snapshot(p))) invalid();
}
function append(p, before, after, at, context) {
  if (equal(before, after)) {
    const last = p.transactions?.entries.at(-1);
    // Coupons and event subscriptions may change neither wallet nor status.
    // Currency purchases already captured inside their transaction must not be recorded twice.
    if (!context.payment || (context.requestId && last?.payment && last.requestId === context.requestId)) return;
  }
  if (!validBalance(before) || !validBalance(after)) throw Error("Недопустимый баланс транзакции.");
  if (context.reward !== undefined && !validReward(context.reward)) throw Error("Недопустимая награда транзакции.");
  const entry = {
    id: randomUUID(),
    at,
    kind: context.kind,
    label: context.label,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.actorId ? { actorId: context.actorId } : {}),
    ...(context.detail ? { detail: context.detail } : {}),
    ...(context.payment ? { payment: { ...context.payment } } : {}),
    ...(context.reward ? { reward: { ...context.reward } } : {}),
    before: { ...before },
    after: { ...after },
  };
  p.transactions = { ...p.transactions, entries: [...p.transactions.entries, entry] };
}
function record(p, before, at, context = system) {
  // Не меняем историю в исходном профиле при отказе последующей записи на диск.
  p.transactions ||= { version: 1, startedAt: at, opening: { ...before }, entries: [] };
  const last = p.transactions.entries.at(-1)?.after || p.transactions.opening;
  append(p, last, before, at, system);
  append(p, before, snapshot(p), at, context);
}
function syncWorld(world, at, context = system, keys = Object.keys(world.profiles)) {
  let profiles = world.profiles;
  for (const key of keys) {
    const p = world.profiles[key],
      last = p.transactions?.entries.at(-1)?.after || p.transactions?.opening;
    // Most arena progress changes neither wallet nor account. Check the same
    // five values without allocating a balance object for every idle profile.
    if (last && last.coins === p.wallet.coins && last.crystals === p.wallet.crystals &&
        last.bucks === (p.wallet.bucks || 0) && last.vipUntil === (p.account?.vipUntil || 0) &&
        last.premiumUntil === (p.account?.premiumUntil || 0)) continue;
    const draft = { ...p };
    record(
      draft,
      last || Object.fromEntries(fields.map((field) => [field, 0])),
      at,
      last ? context : { kind: "registration", label: "Начальный баланс нового игрока" },
    );
    // Даже новый профиль с нулевым балансом получает точку начала истории.
    if (profiles === world.profiles) profiles = copyRecord(profiles);
    profiles[key] = draft;
  }
  if (profiles !== world.profiles) tableDeltas.remember(profiles, world.profiles, keys, true);
  return profiles === world.profiles ? world : { ...world, profiles };
}
function capture(p, at, context) {
  record(
    p,
    p.transactions?.entries.at(-1)?.after || p.transactions?.opening || snapshot(p),
    at,
    context,
  );
}
function operation(signature, requestId, actorId) {
  let parts = [];
  try {
    parts = JSON.parse(signature);
  } catch (_) {
    /* Старый формат покупки бустера. */
  }
  if (!Array.isArray(parts)) parts = [];
  const [kind, action] = parts,
    base = { requestId, actorId };
  if (kind === "promo-code") return { ...base, kind: "reward", label: "Промокод: " + action };
  if (kind === "album-reward") return { ...base, kind: "reward", label: "Награда Альбома" };
  if (signature.startsWith("buy:")) {
    const id = signature.slice(4),
      item = require("../boosters/booster-catalog").BOOSTERS.get(id);
    return { ...base, kind: "purchase", label: "Покупка бустера: " + (item?.name || id) };
  }
  if (kind === "roulette")
    return action === "tickets"
      ? {
          ...base,
          kind: "purchase",
          label: "Покупка билетов рулетки",
          detail: `Билетов: ${parts[3]}`,
        }
      : {
          ...base,
          kind: "reward",
          label: action === "spin-five" ? "Призы рулетки: 5 вращений" : "Приз рулетки",
        };
  if (kind === "pet")
    return {
      ...base,
      kind: "purchase",
      label:
        action === "food"
          ? "Корм питомцам: 1 порция"
          : "Питомец: " +
            (require("../../../public/shared/pet-rules").get(parts[2])?.name || action),
    };
  if (kind === "quest")
    return {
      ...base,
      kind: action === "claim" ? "reward" : "purchase",
      label: action === "claim" ? "Сундук за личное задание" : "Смена личного задания",
      detail: parts[2],
    };
  if (kind === "mock-purchase") {
    const product = products.get(action);
    return {
      ...base,
      kind: "payment",
      label: "Тестовая покупка: " + product.name,
      detail: product.description,
      payment: {
        provider: "mock",
        simulated: true,
        status: "confirmed",
        productId: product.id,
        votes: product.votes,
      },
    };
  }
  if (kind === "account-test-week")
    return { ...base, kind: "account", label: "Тестовая активация " + action.toUpperCase() };
  if (kind === "account-currency-bonus")
    return { ...base, kind: "reward", label: "Ежедневный бонус " + action.toUpperCase() };
  if (kind === "personal") return { ...base, kind: "purchase", label: "Смена ника" };
  if (kind === "appearance" && parts[3] === "buy")
    return {
      ...base,
      kind: "purchase",
      label:
        "Тема интерфейса: " +
        (require("../../../public/shared/league-appearance").interfaceTheme(parts[2])?.name ||
          parts[2]),
    };
  if (kind === "chest")
    return { ...base, kind: "reward", label: "Открытие сундука за титул", detail: action };
  if (kind === "clan-chest")
    return { ...base, kind: "reward", label: "Открытие кланового сундука", detail: parts[2] };
  if (kind === "social" && action === "gift") {
    const gift = require("./player-social").gifts.find((g) => g.id === parts[5]);
    return {
      ...base,
      kind: "purchase",
      label: "Подарок: " + (gift?.name || parts[5]),
      detail: "Получатель: " + parts[2],
    };
  }
  if (kind === "clan") {
    const labels = {
      create: "Создание клана",
      edit: "Изменение герба клана",
      apply: "Заявка в клан",
      deposit: "Взнос в казну клана",
      cancel: "Отмена заявки в клан",
      reject: "Отклонение заявки в клан",
      accept: "Вступление в клан",
      disband: "Роспуск клана",
    };
    return {
      ...base,
      kind: "clan",
      label: labels[action] || "Операция клана",
      detail: parts[2] ? "Клан: " + parts[2] : undefined,
    };
  }
  return { ...base, ...system };
}
function matches(e, filter) {
  return filter === "all" || (fields.includes(filter) && e.before[filter] !== e.after[filter]) ||
    (filter === "account" && (["vipUntil", "premiumUntil"].some(key => e.before[key] !== e.after[key]) ||
      e.payment?.productId === "account:lite")) || (filter === "payment" && !!e.payment);
}
function publicEntry(entry) {
  if (entry.kind !== "reward" && !entry.payment) return entry;
  const { currencyText } = require("./legacy-currency-text");
  return { ...entry, label: currencyText(entry.label),
    ...(entry.payment && entry.detail ? { detail: currencyText(entry.detail) } : {}) };
}
function page(p, number = 1, filter = "all", size = 20) {
  const log = p.transactions;
  const found = (log?.entries || []).filter(
    (e) =>
      filter === "all" ||
      (fields.includes(filter) && e.before[filter] !== e.after[filter]) ||
      (filter === "account" &&
        (["vipUntil", "premiumUntil"].some((key) => e.before[key] !== e.after[key]) ||
          e.payment?.productId === "account:lite")) ||
      (filter === "payment" && e.payment),
  );
  const pages = Math.max(1, Math.ceil(found.length / size));
  number = Math.min(pages, Math.max(1, Math.floor(Number(number) || 1)));
  return {
    playerId: p.id,
    startedAt: log?.startedAt || null,
    opening: log?.opening || null,
    entries: found
      .slice()
      .reverse()
      .slice((number - 1) * size, number * size)
      .map((entry) => {
        // Награды и описания продуктов заданы сервером; имена игроков и кланов
        // в прочих операциях оставляем как есть.
        if (entry.kind !== "reward" && !entry.payment) return entry;
        const { currencyText } = require("./legacy-currency-text");
        return {
          ...entry,
          label: currencyText(entry.label),
          ...(entry.payment && entry.detail ? { detail: currencyText(entry.detail) } : {}),
        };
      }),
    total: found.length,
    page: number,
    pages,
  };
}
// Read the saved credit, never infer it from today's event, coupon or balance.
// Old currency receipts have exact wallet deltas but no token reward.
function currencyReward(p, requestId, currency) {
  const entry = p.transactions?.entries.findLast(e => e.requestId === requestId);
  if (!entry) return null;
  const reward = entry.reward || { [currency]: entry.after[currency] - entry.before[currency] };
  return validReward(reward) ? { ...reward, requestId } : null;
}
module.exports = { snapshot, initialize, validate, record, capture, syncWorld, operation, page, currencyReward, matches, publicEntry };
