"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { GlobalTransactions } = require("../../src/server/admin/global-transactions");
const { matches } = require("../../src/server/profiles/transaction-history");
const compare = (a, b) => b.at - a.at || a.id.localeCompare(b.id) || a.playerId.localeCompare(b.playerId);
function fixture() {
  const profiles = { data: { profiles: {} } }, oracle = [];
  for (let p = 0; p < 5; p++) {
    const id = "player" + p, entries = [];
    for (let i = 0; i < 37; i++) {
      const before = { coins: 100, crystals: 10, bucks: 0, vipUntil: 0, premiumUntil: 0 }, after = { ...before };
      after[["coins", "crystals", "bucks", "vipUntil"][i % 4]] += 1;
      const e = { id: "entry" + i, at: (i * 19 + p) % 31, kind: "server", label: "test", before, after,
        ...(i % 7 === 0 ? { payment: { productId: "account:lite" } } : {}) };
      entries.push(e); oracle.push({ ...e, playerId: id, playerName: id, testBot: p === 0 });
    }
    profiles.data.profiles[id] = { id, name: id, testBot: p === 0, transactions: { startedAt: 1, entries } };
  }
  return { profiles, oracle, journal: new GlobalTransactions(profiles) };
}
test("All-player journal matches an independent ordering, filters and every page including ties and clock reversal", async () => {
  const f = fixture(), before = structuredClone(f.profiles.data);
  for (const filter of ["all", "coins", "crystals", "bucks", "account", "payment"]) {
    const expected = f.oracle.filter(e => matches(e, filter)).sort(compare);
    for (let page = 1; page <= Math.ceil(expected.length / 10); page++) {
      const result = await f.journal.read(page, filter);
      assert.equal(result.total, expected.length); assert.equal(result.opening, null);
      assert.deepEqual(result.entries, expected.slice((page - 1) * 10, page * 10));
    }
  }
  assert.deepEqual(f.profiles.data, before);
});
test("Journal sees replacements, renames and deletions without retaining removed players", async () => {
  const f = fixture(); await f.journal.read();
  const p = f.profiles.data.profiles.player1;
  f.profiles.data = { profiles: { renamed: { ...p, name: "Новое имя", transactions: { ...p.transactions,
    entries: [...p.transactions.entries, { ...p.transactions.entries[0], id: "latest", at: 100 }] } } } };
  const result = await f.journal.read();
  assert.equal(result.total, 38); assert.equal(result.entries[0].id, "latest");
  assert(result.entries.every(e => e.playerName === "Новое имя"));
  const end = await f.journal.read(Infinity); assert.equal(end.page, 4);
  f.profiles.data = { profiles: {} }; assert.equal((await f.journal.read()).total, 0);
});
test("Large reads yield to the event loop and reject concurrent unbounded builds", async () => {
  const f = fixture(), p = f.profiles.data.profiles.player1;
  p.transactions.entries = Array.from({ length: 5000 }, (_, i) => ({ ...p.transactions.entries[0], id: String(i), at: i }));
  let yielded = false; setImmediate(() => { yielded = true; });
  const reading = f.journal.read();
  await assert.rejects(f.journal.read(), e => e.status === 429);
  await reading; assert(yielded);
});
