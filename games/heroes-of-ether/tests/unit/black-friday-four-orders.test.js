const test = require("node:test"),
  assert = require("node:assert/strict");
const book = require("../../src/server/events/black-friday-orders");
const fixture = require("../helpers/black-friday-fixture");
const B = require("../../src/server/events/black-friday");

test("initial order inspection is deterministic after cache churn and never shares writable books", () => {
  const p = { id: "cached-orders" }, expected = book.daily(p, {}, 20770, 1000);
  const draft = book.daily(p, {}, 20770, 1000);
  draft.slots[0].current.progress = 999;
  draft.lanes.common.issued = 999;
  assert.deepEqual(book.daily(p, {}, 20770, 1000), expected);
  for (let i = 0; i < 2300; i++) book.daily({ id: "cache-churn-" + i }, {}, 20771, 2000);
  assert.deepEqual(book.daily(p, {}, 20770, 1000), expected);
  const later = book.daily(p, {}, 20770, 2000);
  assert.deepEqual(later.slots.map(s => [s.tier, s.current.template]), expected.slots.map(s => [s.tier, s.current.template]));
  assert(later.slots.every(s => s.current.assignedAt === 2000));
});

test("four random slots are stable on refresh, vary across players and finish exactly 4/4/4", () => {
  const patterns = new Set();
  for (let player = 0; player < 30; player++) {
    const p = { id: "player-" + player },
      s = { days: {} },
      d = book.ensure(p, s, 1, 1000);
    assert.deepEqual(book.daily(p, {}, 1, 1000), d);
    assert.equal(book.rows(d).length, 4);
    patterns.add(d.slots.map((s) => s.tier).join(","));
    const counts = { common: 0, important: 0, secret: 0 };
    let reward = 0;
    while (book.count(d) < 12) {
      const row = book.rows(d).find((r) => !r.claimed);
      counts[row.tier]++;
      reward += row.tokens;
      book.advance(p, d, 1, row, 2000, (max) => (player + 2) % max, false);
      book.validate(d);
    }
    assert.deepEqual(counts, { common: 4, important: 4, secret: 4 });
    assert.equal(reward, 240);
    assert.ok(book.rows(d).every((r) => r.claimed));
  }
  assert.ok(patterns.size > 10, "No fixed tier lanes");
});

function legacy(p, date, done = [1, 2, 1]) {
  const lanes = {};
  for (const [i, t] of book.tiers.entries()) {
    const sequence = Math.min(done[i], [4, 3, 3][i] - 1);
    lanes[t.id] = {
      done: done[i],
      current: {
        id: `${t.id}:${sequence}:1`,
        template: 7,
        revision: 1,
        assignedAt: 1234,
        progress: 2,
        opponents: ["opponent-1", "opponent-2"],
      },
    };
  }
  return { version: 2, earned: 80, swaps: 2, exchanges: { coins: 3 }, lanes };
}
test("V2 migration keeps every current ID, progress, opponents, currency and swap history", () => {
  const p = { id: "legacy" },
    old = legacy(),
    s = { days: { 1: old } },
    before = structuredClone(old);
  const d = book.daily(p, s, 1, 1000, 3000);
  book.validate(d);
  assert.deepEqual(old, before);
  assert.equal(d.slots.length, 4);
  assert.equal(book.count(d), 4);
  for (const [tier, lane] of Object.entries(old.lanes))
    assert.deepEqual(d.slots.find((s) => s.current.id === lane.current.id).current, lane.current);
  assert.equal(d.swaps, 2);
  assert.equal(d.earned, 80);
  assert.deepEqual(d.exchanges, { coins: 3 });
  assert.equal(d.slots.find((s) => s.current.assignedAt !== 1234).current.assignedAt, 3000);
});
test("completed V2 day adds only two missing tasks, without reviving ten paid orders", () => {
  const p = { id: "finished" },
    d = book.daily(p, { days: { 1: legacy(p, 1, [4, 3, 3]) } }, 1, 1000, 3000);
  book.validate(d);
  assert.equal(book.count(d), 10);
  assert.equal(d.slots.length, 2);
  assert.deepEqual(d.slots.map((s) => s.tier).sort(), ["important", "secret"]);
  for (const row of book.rows(d)) book.advance(p, d, 1, row, 4000, () => 0, false);
  assert.equal(book.count(d), 12);
  book.validate(d);
});
test("four-slot claims reject stale requests and rollback assignment as well as tokens on failed write", () => {
  const f = fixture();
  f.p().wallet.bucks = 30;
  f.act("exchange", "bucks");
  const d = f.p().blackFriday.runs[f.run.id].days[B.day(f.now())],
    row = f.view().orders[0];
  d.slots[0].current.progress = row.target;
  const request = f.input("order", row.id),
    before = structuredClone(f.p()),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => B.mutate(f.store, f.user.token, request), /disk failure/);
  assert.deepEqual(f.p(), before);
  f.store.save = save;
  B.mutate(f.store, f.user.token, request, () => 0);
  const after = structuredClone(f.p());
  assert.equal(B.mutate(f.store, f.user.token, request).replay, true);
  assert.deepEqual(f.p(), after);
  assert.throws(() => f.act("order", row.id));
  B.validate(f.p());
});
