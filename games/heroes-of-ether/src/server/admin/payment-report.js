"use strict";
const { setImmediate: yieldTurn } = require("node:timers/promises");
const { BoosterError } = require("../boosters/booster-catalog");
const DAY = 86400000;
const CATEGORIES = Object.freeze({ promotions: "Акции", coins: "Монеты", crystals: "Кристаллы", bucks: "Эфир", statuses: "Статусы", eventSubscriptions: "Событийные подписки", coupons: "Купоны", other: "Прочее" });
function category(id) {
  if (id.startsWith("promotion:")) return "promotions";
  if (id === "event:manya-coupon") return "coupons";
  if (id === "account:lite") return "eventSubscriptions";
  if (id.startsWith("account:")) return "statuses";
  const prefix = id.split(":")[0];
  return ["coins", "crystals", "bucks"].includes(prefix) ? prefix : "other";
}
function options(input, now) {
  const from = input.from === undefined ? now - 30 * DAY : Number(input.from);
  const to = input.to === undefined ? now + 1 : Number(input.to);
  const mode = input.mode || "real", group = input.category || "all", query = input.q || "";
  const page = input.page === undefined ? 1 : Number(input.page), offset = Number(input.offset || 0);
  if (![from, to, page, offset].every(Number.isSafeInteger) || from < 0 || to <= from || to - from > 367 * DAY || page < 1 || Math.abs(offset) > 840 ||
      !["real", "test"].includes(mode) || (group !== "all" && !Object.hasOwn(CATEGORIES, group)) || typeof query !== "string" || query.length > 64)
    throw new BoosterError("Проверь период (не более года) и фильтры отчёта.", 400);
  return { from, to, mode, category: group, page, offset, q: query.trim().normalize("NFKC").toLocaleLowerCase("ru") };
}
const add = (a, b) => { const value = a + b; if (!Number.isSafeInteger(value)) throw new BoosterError("Сумма отчёта превысила допустимый предел.", 422); return value; };
async function ordered(rows) {
  const compare = (a,b) => b.at - a.at || a.id.localeCompare(b.id) || a.playerId.localeCompare(b.playerId);
  let source = rows, destination = new Array(rows.length), work = 0;
  for (let width = 1; width < rows.length; width *= 2) {
    for (let left = 0; left < rows.length; left += width * 2) {
      const middle = Math.min(left + width, rows.length), right = Math.min(left + width * 2, rows.length);
      let a = left, b = middle;
      for (let i = left; i < right; i++) {
        destination[i] = b >= right || (a < middle && compare(source[a], source[b]) <= 0) ? source[a++] : source[b++];
        if (++work % 512 === 0) await yieldTurn();
      }
    }
    [source, destination] = [destination, source];
  }
  return source;
}
class PaymentReport {
  constructor(profiles, now = Date.now) { this.profiles = profiles; this.now = now; this.cache = new Map(); this.running = false; }
  async read(input = {}) {
    const filters = options(input, this.now());
    if (this.running) throw new BoosterError("Отчёт уже формируется. Повтори через несколько секунд.", 429);
    this.running = true;
    try {
      // Capture immutable profile references; yield during long histories rather than blocking arena ticks.
      const players = Object.values(this.profiles.data.profiles), liveIds = new Set(players.map(p => p.id));
      for (const id of this.cache.keys()) if (!liveIds.has(id)) this.cache.delete(id);
      const rows = [], buyers = new Set(), days = new Map();
      const groups = Object.entries(CATEGORIES).map(([id, name]) => ({ id, name, votes: 0, count: 0 }));
      const byGroup = new Map(groups.map(g => [g.id, g]));
      let votes = 0, operations = 0, earliest = null;
      for (const player of players) {
        const log = player.transactions, entries = log?.entries || [];
        if (log) earliest = earliest === null ? log.startedAt : Math.min(earliest, log.startedAt);
        let cached = this.cache.get(player.id);
        if (!cached || entries.length < cached.length || (cached.length && entries[cached.length - 1] !== cached.last)) cached = { rows: [], length: 0 };
        if (cached.entries !== entries) {
          const collected = cached.rows.slice();
          for (let i = cached.length; i < entries.length; i++) {
            const entry = entries[i], payment = entry.payment;
            // The current payment integration is mock-only. Never infer real revenue from a label or a receipt signature.
            if (payment?.provider === "mock" && payment.simulated === true && payment.status === "confirmed" && typeof payment.productId === "string" && Number.isSafeInteger(payment.votes) && payment.votes >= 0) {
              collected.push({ id: entry.id, at: entry.at, requestId: entry.requestId || null, productId: payment.productId,
                product: entry.label.replace(/^Тестовая покупка: /, ""), votes: payment.votes, category: category(payment.productId), provider: "mock", simulated: true, status: "confirmed" });
            }
            if (++operations % 500 === 0) await yieldTurn();
          }
          cached = { entries, rows: collected, length: entries.length, last: entries.at(-1) };
          this.cache.set(player.id, cached);
        }
        const matchesPlayer = !filters.q || (player.name + " " + player.id).normalize("NFKC").toLocaleLowerCase("ru").includes(filters.q);
        for (const row of cached.rows) {
          if (++operations % 500 === 0) await yieldTurn();
          if (filters.mode !== "test" || !matchesPlayer || row.at < filters.from || row.at >= filters.to || (filters.category !== "all" && row.category !== filters.category)) continue;
          rows.push({ ...row, playerId: player.id, playerName: player.name });
          buyers.add(player.id); votes = add(votes, row.votes);
          const group = byGroup.get(row.category); group.votes = add(group.votes, row.votes); group.count++;
          const day = new Date(row.at + filters.offset * 60000).toISOString().slice(0, 10);
          days.set(day, add(days.get(day) || 0, row.votes));
        }
        if (++operations % 50 === 0) await yieldTurn();
      }
      const pages = Math.max(1, Math.ceil(rows.length / 10)), page = Math.min(filters.page, pages);
      const sorted = await ordered(rows);
      const series = [];
      const firstDay = Math.floor((filters.from + filters.offset * 60000) / DAY), lastDay = Math.floor((filters.to - 1 + filters.offset * 60000) / DAY);
      for (let d = firstDay; d <= lastDay; d++) { const day = new Date(d * DAY).toISOString().slice(0, 10); series.push({ day, votes: days.get(day) || 0 }); }
      return { capturedAt: this.now(), filters, realPaymentsAvailable: false, historyStartedAt: earliest,
        summary: { votes, purchases: rows.length, buyers: buyers.size, averageVotes: rows.length ? votes / rows.length : 0, netProfit: null },
        categories: groups, series, entries: sorted.slice((page - 1) * 10, page * 10), page, pages, total: rows.length,
        limitations: ["Подключена только тестовая оплата. Реальные Голоса не списываются; тестовые покупки не являются выручкой.", "Комиссии, возвраты и расходы пока не учитываются: чистая прибыль не рассчитана.", "Отчёт использует сохранённые записи оплаты. Старые покупки без такой записи не восстанавливаются по сегодняшним ценам."] };
    } finally { this.running = false; }
  }
}
module.exports = { PaymentReport, CATEGORIES, category };
