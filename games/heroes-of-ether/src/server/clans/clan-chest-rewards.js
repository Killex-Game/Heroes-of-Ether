/* Выдача, получение, хранение и открытие клановых сундуков. */
"use strict";
const { randomInt, randomUUID, createHash } = require("node:crypto");
const { BoosterError, BOOSTERS } = require("../boosters/booster-catalog");
const accounts = require("../accounts/account-benefits"),
  { randomItems, awardTitles, POOLS } = require("../progression/title-chest-rewards");
const { CHESTS, DAY } = require("../../../public/shared/clan-competition-rules");
// Prepared prizes are immutable promises: validate older rolls against their own ranges.
const LEGACY_RANGES = {
  low: { coins: [100, 200], crystals: [10, 30] },
  medium: { coins: [200, 350], crystals: [20, 40] },
  high: { coins: [300, 500], crystals: [30, 50] },
};
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const history = require("../profiles/transaction-history");
const treasury = require("../progression/treasury-capacity");
const bonuses = require("../progression/chest-bonuses");
const { capacity } = treasury;
function add(a, b) {
  if (!integer(a) || !integer(b) || !integer(a + b))
    throw new BoosterError("Награда превышает допустимый баланс.", 409);
  return a + b;
}
function inventory(p) {
  return (p.clanChests ||= { items: [], notices: [] });
}
// Rebalance unopened rewards without rerolling items or reading a newer account state.
function currentReward(item) {
  const r = item.reward;
  if (!r || r.version !== 2) return r;
  const greatnessBonus = r.greatnessBonus / 2;
  return {
    ...r,
    version: 3,
    greatnessBonus,
    greatness: CHESTS[item.tier].greatness + greatnessBonus,
  };
}
function notice(p, text, at, kind = "reward") {
  const c = inventory(p);
  c.notices.push({ id: randomUUID(), text, at, kind });
  c.notices = c.notices.slice(-40);
}
function resultNotice(p, result, text, at) {
  const c = inventory(p);
  if (c.notices.some(n => n.result?.sourceId === result.sourceId)) return;
  notice(p, text, at);
  // Stable UUIDv5: identical settlement/recovery paths produce identical data.
  const bytes = createHash("sha1").update(Buffer.alloc(16)).update(JSON.stringify([p.id,result.sourceId])).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString("hex");
  c.notices[c.notices.length - 1].id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
  c.notices[c.notices.length - 1].result = {...result};
}
const liveNotice = (n, at) => (n.result && n.notifiedAt === undefined) || n.at + DAY > at;
function needsExpiry(p, at) {
  return treasury.needsFill(p, at) || !!p.clanChests?.notices.some((n) => !liveNotice(n, at));
}
function expire(p, at) {
  const notices = (p.clanChests?.notices || []).filter((n) => liveNotice(n, at));
  const noticesChanged = notices.length !== (p.clanChests?.notices.length || 0);
  if (noticesChanged) p.clanChests.notices = notices;
  return treasury.fill(p, at) || noticesChanged;
}
function grant(p, tier, at, { clanId = null } = {}) {
  treasury.fill(p, at);
  const c = inventory(p),
    stored = false;
  const item = {
    id: "clan-" + randomUUID(),
    tier,
    earnedAt: at,
    receivedAt: null,
    stored,
  };
  treasury.queue(p, item, at);
  if (clanId) item.sourceClanId = clanId;
  c.items.push(item);
  notice(
    p,
    CHESTS[tier].name +
      (stored
        ? " уже в Сокровищнице. Хранится без срока открытия."
        : " доступен. Нажми «Получить». Срок вне Сокровищницы: " + item.waitingHours + " ч."),
    at,
  );
  c.notices[c.notices.length - 1].chestId = item.id;
  return item;
}
function award(p, reward, at, { multiply = true, label = "", result = null } = {}) {
  const before = history.snapshot(p);
  const benefits = accounts.benefits(p, at),
    factor = multiply ? benefits.weeklyRewardMultiplier : 1;
  for (const currency of ["coins", "crystals", "bucks"])
    p.wallet[currency] = add(p.wallet[currency], (reward[currency] || 0) * factor);
  p.greatness = add(
    p.greatness,
    (reward.greatness || 0) * (multiply ? benefits.greatnessMultiplier : 1),
  );
  awardTitles(p, at);
  history.record(p, before, at, { kind: "reward", label: label || "Награда клана" });
  if (label) {
    if (result) resultNotice(p, result, label, at);
    else notice(p, label, at);
  }
}
function chestNotice(n) {
  return n.kind !== "expired" && n.text.startsWith("Клановый сундук");
}
function noticeChest(n, items) {
  return items.find((c) => n.chestId
    ? c.id === n.chestId
    : c.earnedAt === n.at && n.text.startsWith(CHESTS[c.tier].name));
}
function noticeText(n, items) {
  let text = require("../profiles/legacy-currency-text").currencyText(n.text);
  if (!chestNotice(n)) return text;
  const item = noticeChest(n, items);
  if (item)
    return (
      CHESTS[item.tier].name +
      (item.stored
        ? " уже в Сокровищнице. Хранится без срока открытия."
        : item.receivedAt === null
          ? " доступен. Нажми «Получить». Срок вне Сокровищницы: " +
            (item.waitingHours ?? 48) +
            " ч."
          : " ожидает свободного места в Сокровищнице. Срок ожидания: " +
            (item.waitingHours ?? 48) +
            " ч.")
    );
  // Old notification text must not imply a deadline for safe storage.
  return text
    .replace(/ Нажми «Получить», чтобы зачислить его в Сокровищницу\./g, "")
    .replace(/ Открой в течение 48 часов\./g, " Срок ожидания вне Сокровищницы указан в очереди.");
}
function view(p, at, config, manager) {
  const c = p.clanChests || { items: [], notices: [] };
  const available = c.items.filter((x) => x.stored || x.expiresAt > at);
  return {
    capacity: capacity(p, at),
    waitingHours: treasury.waitingHours(p, at),
    stored: c.items.filter((x) => x.stored).length,
    queued: c.items.filter((x) => !x.stored && x.expiresAt > at).length,
    totalStored: treasury.stored(p, at),
    battleReward: structuredClone(c.battleReward || null),
    notices: c.notices
      // Availability is not history: an old notice cannot advertise a consumed chest.
      .filter((n) => liveNotice(n, at) && (!chestNotice(n) || noticeChest(n, available)))
      .map((n) => ({
        ...structuredClone(n),
        text: noticeText(n, available),
      })),
    items: available
      .map((x) => ({
        ...structuredClone(x),
        expiresAt: x.stored ? null : x.expiresAt,
        ...CHESTS[x.tier],
        chestName: CHESTS[x.tier].name,
        ...(x.reward ? { reward: bonuses.preview(currentReward(x), p, config, at, manager, "clan") } : {}),
      })),
  };
}
function act(p, action, id, at) {
  treasury.fill(p, at);
  const c = inventory(p);
  if (action === "dismiss") {
    c.notices = c.notices.filter((x) => x.id !== id);
    return;
  }
  const item = c.items.find((x) => x.id === id);
  if (!item || (!item.stored && item.expiresAt <= at))
    throw new BoosterError("Сундук уже открыт или срок хранения закончился.", 409);
  if (action === "claim") {
    if (item.stored) return;
    item.receivedAt ??= at;
    treasury.fill(p, at);
    return;
  }
  if (!item.stored) throw new BoosterError("Сначала забери сундук в инвентарь.", 409);
  if (item.reward && ["prepare", "open"].includes(action)) item.reward = currentReward(item);
  if (action === "prepare") {
    if (item.reward) return;
    const spec = CHESTS[item.tier],
      benefits = accounts.benefits(p, at),
      multiplier = bonuses.multiplier(p, at);
    item.reward = {
      id: item.id,
      version: 5,
      multiplier,
      greatnessBonus: benefits.clanChestGreatnessBonus,
      coins: (spec.coins[0] + randomInt(spec.coins[1] - spec.coins[0] + 1)) * multiplier,
      crystals:
        (spec.crystals[0] + randomInt(spec.crystals[1] - spec.crystals[0] + 1)) * multiplier,
      bucks: 0,
      greatness: spec.greatness + benefits.clanChestGreatnessBonus,
      items: Object.fromEntries(
        Object.entries(randomItems(spec)).map(([id, n]) => [id, n * multiplier]),
      ),
    };
    return;
  }
  if (action !== "open") throw new BoosterError("Неизвестное действие сундука.");
  if (!item.reward) throw new BoosterError("Сначала подтверди открытие сундука.", 409);
  const r = item.reward;
  for (const currency of ["coins", "crystals", "bucks"])
    p.wallet[currency] = add(p.wallet[currency], r[currency]);
  p.greatness = add(p.greatness, r.greatness);
  for (const [key, n] of Object.entries(r.items)) p.inventory[key] = add(p.inventory[key] || 0, n);
  c.items = c.items.filter((x) => x.id !== id);
  c.notices = c.notices.filter((n) => !chestNotice(n) || noticeChest(n, c.items));
  if (c.battleReward?.chestId === id) c.battleReward.status = "opened";
  treasury.fill(p, at);
  awardTitles(p, at);
}
// Переход сохранений v9 → v10: сохраняем случайный состав, меняем только бонусы.
function rebalanceAccountBonuses(p) {
  validate(p);
  for (const item of p.clanChests?.items || []) {
    const reward = item.reward;
    if (!reward || [2, 3, 4, 5].includes(reward.version)) continue;
    const oldMultiplier = reward.multiplier;
    const bonus =
      oldMultiplier === 4
        ? 15
        : reward.greatnessMultiplier === 3
          ? 10
          : reward.greatnessMultiplier === 2
            ? 5
            : 0;
    if (oldMultiplier === 4) {
      for (const currency of ["coins", "crystals"]) reward[currency] = (reward[currency] / 4) * 3;
      for (const id of Object.keys(reward.items)) reward.items[id] = (reward.items[id] / 4) * 3;
      reward.multiplier = 3;
    }
    reward.version = 3;
    reward.greatnessBonus = bonus;
    reward.greatness = CHESTS[item.tier].greatness + bonus;
    delete reward.greatnessMultiplier;
  }
  validate(p);
}
function validate(p) {
  if (!p.clanChests) return;
  const c = p.clanChests,
    broken = () => {
      throw Error("Повреждены клановые сундуки. Сохранение не перезаписано.");
    };
  if (
    !Array.isArray(c.items) ||
    !Array.isArray(c.notices) ||
    c.notices.length > 40 ||
    new Set(c.items.map((x) => x.id)).size !== c.items.length
  )
    broken();
  const b = c.battleReward;
  if (b !== undefined) {
    if (!b || typeof b.clanId !== "string" || !integer(b.endedAt)) broken();
    if (b.tier === "fixed") {
      if (b.status !== "credited" || b.chestId !== null || b.expiresAt !== null) broken();
      if (
        b.fixedReward !== undefined &&
        (!b.fixedReward ||
          ["coins", "crystals", "greatness"].some((key) => !integer(b.fixedReward[key])))
      )
        broken();
    } else {
      if (
        !CHESTS[b.tier] ||
        !/^clan-[a-f0-9-]{36}$/.test(b.chestId) ||
        !(
          integer(b.expiresAt) ||
          (b.expiresAt === null && ["stored", "opened"].includes(b.status))
        ) ||
        !["available", "stored", "opened", "expired"].includes(b.status)
      )
        broken();
      if (
        ["available", "stored"].includes(b.status) &&
        !c.items.some(
          (x) => x.id === b.chestId && x.tier === b.tier && (b.status !== "stored" || x.stored),
        )
      )
        broken();
    }
  }
  for (const x of c.items) {
    if (
      !/^clan-[a-f0-9-]{36}$/.test(x.id) ||
      !CHESTS[x.tier] ||
      !integer(x.earnedAt) ||
      !treasury.validStorage(x) ||
      !(integer(x.expiresAt) || (x.stored && x.expiresAt === null)) ||
      typeof x.stored !== "boolean" ||
      (x.receivedAt !== undefined && x.receivedAt !== null && !integer(x.receivedAt))
    )
      broken();
    if (x.sourceClanId !== undefined && typeof x.sourceClanId !== "string") broken();
    if (x.reward) {
      const r = x.reward,
        s = [4, 5].includes(r.version) ? CHESTS[x.tier] : { ...CHESTS[x.tier], ...LEGACY_RANGES[x.tier] },
        m = r.multiplier;
      const validGreatness = r.version === 5
        ? ((m === 1 && [0, 10].includes(r.greatnessBonus)) ||
            (m === 2 && [5, 15].includes(r.greatnessBonus))) &&
          r.greatness === s.greatness + r.greatnessBonus && r.greatnessMultiplier === undefined
        : [2, 3, 4].includes(r.version)
        ? [1, 2, 3].includes(m) &&
          (m === 1
            ? r.greatnessBonus === 0
            : m === 2
              ? r.greatnessBonus === (r.version >= 3 ? 5 : 10)
              : (r.version >= 3 ? [10, 15] : [20, 30]).includes(r.greatnessBonus)) &&
          r.greatness === s.greatness + r.greatnessBonus &&
          r.greatnessMultiplier === undefined
        : r.version === undefined &&
          [1, 2, 3, 4].includes(m) &&
          r.greatnessMultiplier === Math.min(m, 3) &&
          r.greatness === s.greatness * r.greatnessMultiplier;
      if (r.id !== x.id || !validGreatness || r.bucks !== 0 || !r.items) broken();
      for (const currency of ["coins", "crystals"])
        if (
          !integer(r[currency]) ||
          r[currency] % m ||
          r[currency] < s[currency][0] * m ||
          r[currency] > s[currency][1] * m
        )
          broken();
      const totals = {};
      for (const [id, n] of Object.entries(r.items)) {
        const tier = Object.keys(POOLS).find((t) => POOLS[t].includes(id));
        if (!BOOSTERS.has(id) || !tier || !integer(n) || !n || n % m) broken();
        totals[tier] = (totals[tier] || 0) + n;
      }
      if (
        Object.keys(totals).length !== Object.keys(s.rarityShares).length ||
        Object.entries(s.rarityShares).some(
          ([tier, share]) => totals[tier] !== ((s.boosters * share) / 100) * m,
        )
      )
        broken();
    }
  }
  for (const n of c.notices)
    if (
      typeof n.id !== "string" ||
      typeof n.text !== "string" ||
      !integer(n.at) ||
      (n.notifiedAt !== undefined && !integer(n.notifiedAt)) ||
      (n.result !== undefined && (!n.result || typeof n.result !== "object" ||
        !["battle","quests","season","league"].includes(n.result.kind) ||
        typeof n.result.positive !== "boolean" ||
        ["sourceId","title","headline","detail","clanName"].some(key =>
          typeof n.result[key] !== "string" || n.result[key].length > 500)))
    )
      broken();
}
module.exports = {
  inventory,
  capacity,
  notice,
  resultNotice,
  needsExpiry,
  expire,
  grant,
  award,
  view,
  act,
  validate,
  rebalanceAccountBonuses,
};
