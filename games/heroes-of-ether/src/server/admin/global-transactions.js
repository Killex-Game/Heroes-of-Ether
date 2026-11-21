"use strict";
const { setImmediate: yieldTurn } = require("node:timers/promises");
const { BoosterError } = require("../boosters/booster-catalog");
const { matches, publicEntry } = require("../profiles/transaction-history");
const compare = (a, b) => b.at - a.at || a.id.localeCompare(b.id);
async function ordered(entries, filter) {
  let source = [], work = 0;
  for (const e of entries) {
    if (matches(e, filter)) source.push(e);
    if (++work % 512 === 0) await yieldTurn();
  }
  // A clock adjustment or imported history can be out of order. Stable bounded
  // merges preserve exact dates without a long synchronous Array.sort.
  let target = new Array(source.length);
  for (let width = 1; width < source.length; width *= 2) {
    for (let left = 0; left < source.length; left += 2 * width) {
      const middle = Math.min(left + width, source.length), end = Math.min(left + 2 * width, source.length);
      let a = left, b = middle;
      for (let i = left; i < end; i++) {
        target[i] = b >= end || (a < middle && compare(source[a], source[b]) <= 0) ? source[a++] : source[b++];
        if (++work % 512 === 0) await yieldTurn();
      }
    }
    [source, target] = [target, source];
  }
  return source;
}
const rowCompare = (a, b) => compare(a.rows[a.index], b.rows[b.index]) || a.player.id.localeCompare(b.player.id);
function push(heap, row) {
  let i = heap.length; heap.push(row);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (rowCompare(heap[parent], row) <= 0) break;
    heap[i] = heap[parent]; i = parent;
  }
  heap[i] = row;
}
function pop(heap) {
  const first = heap[0], last = heap.pop();
  if (heap.length) {
    let i = 0;
    while (2 * i + 1 < heap.length) {
      let child = 2 * i + 1;
      if (child + 1 < heap.length && rowCompare(heap[child + 1], heap[child]) < 0) child++;
      if (rowCompare(last, heap[child]) <= 0) break;
      heap[i] = heap[child]; i = child;
    }
    heap[i] = last;
  }
  return first;
}
class GlobalTransactions {
  constructor(profiles) { this.profiles = profiles; this.cache = new WeakMap(); this.running = false; }
  async read(number = 1, filter = "all") {
    if (this.running) throw new BoosterError("Журнал формируется. Повтори через несколько секунд.", 429);
    this.running = true;
    try {
      const players = Object.values(this.profiles.data.profiles), heap = [];
      let total = 0, startedAt = null, work = 0;
      for (const player of players) {
        const log = player.transactions;
        if (!log) continue;
        startedAt = startedAt === null ? log.startedAt : Math.min(startedAt, log.startedAt);
        let filters = this.cache.get(log.entries);
        if (!filters) { filters = new Map(); this.cache.set(log.entries, filters); }
        let rows = filters.get(filter);
        if (!rows) { rows = await ordered(log.entries, filter); filters.set(filter, rows); }
        total += rows.length;
        if (rows.length) push(heap, { player, rows, index: 0 });
        if (++work % 64 === 0) await yieldTurn();
      }
      const pages = Math.max(1, Math.ceil(total / 10));
      const page = Math.min(pages, Math.max(1, Math.floor(Number(number) || 1))), entries = [];
      // Merge only the prefix required for this page, never copy all global
      // entry bodies. The cache dies with the immutable source archives.
      for (let index = 0; heap.length && index < page * 10; index++) {
        const row = pop(heap), e = row.rows[row.index++];
        if (index >= (page - 1) * 10) entries.push({ ...publicEntry(e), playerId: row.player.id,
          playerName: row.player.name, testBot: !!row.player.testBot });
        if (row.index < row.rows.length) push(heap, row);
        if (++work % 512 === 0) await yieldTurn();
      }
      return { playerId: null, scope: "all", startedAt, opening: null, entries, total, page, pages };
    } finally { this.running = false; }
  }
}
module.exports = { GlobalTransactions };
