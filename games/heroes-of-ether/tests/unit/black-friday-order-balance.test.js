"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const book = require("../../src/server/events/black-friday-orders");
const B = require("../../src/server/events/black-friday");
const fixture = require("../helpers/black-friday-fixture");

function oneOrder(tier, template, progress = 0, legacy = false) {
  const current = { id: `${tier}:0:0`, revision: 0, template, progress, assignedAt: 1000 };
  if (!legacy) current.catalogVersion = 2;
  return { version: 3, ...(legacy ? {} : { catalogVersion: 2 }), earned: 0, swaps: 0, exchanges: {},
    lanes: Object.fromEntries(book.tiers.map(t => [t.id, { done: 0, issued: t.id === tier ? 1 : 0 }])),
    slots: [{ tier, complete: false, current }] };
}

test("all 22 order targets match the approved ordinary/important/secret table", () => {
  assert.deepEqual(book.templates.map((_, i) => book.tiers.map(t => t.targets[i])), [
    [100,250,500], [10,25,50], [5,10,15], [10,25,50], [10,25,50],
    [5,10,15], [5,10,15], [5,10,15], [5000,15000,40000], [100,200,300],
    [50,150,300], [25,50,100], [null,200,null], [100,null,null], [null,null,300],
    [null,150,null], [75,150,300], [5,15,30], [3,5,10], [1,3,5], [null,null,5000], [500,1000,1500],
  ]);
});

for (const tier of book.tiers) for (const template of [1, 2]) {
  test(`${tier.id}/${template}: completed minute-long games accumulate, not elapsed seconds`, () => {
    const d = oneOrder(tier.id, template), target = tier.targets[template], p = { id: "player" };
    const session = { id: "life", startedAt: 1000, sampledAt: 1000 };
    book.progress(p, d, { type: "questSample", lifeId: "life", food: 0 }, 241000, 1000, session);
    book.progress(p, d, { type: "lifeEnded", lifeId: "other", durationSeconds: 240 }, 241000, 1000, session);
    book.progress(p, d, { type: "lifeEnded", lifeId: "life", durationSeconds: 59 }, 60000, 1000, session);
    book.progress(p, d, { type: "lifeEnded", lifeId: "life", durationSeconds: 60, reason: "recovered" }, 61000, 1000, session);
    assert.equal(d.slots[0].current.progress, 0);
    for (let i = 0; i <= target; i++) {
      const startedAt = 1000 + i * 61000, lifeId = "life-" + i;
      book.progress(p, d, { type: "lifeEnded", lifeId, durationSeconds: 60, reason: "exit" },
        startedAt + 60000, 1000, { id: lifeId, startedAt, sampledAt: startedAt });
      assert.equal(d.slots[0].current.progress, Math.min(target, i + 1));
    }
    assert.equal(book.rows(d)[0].metric, "life");
    assert.equal(book.rows(d)[0].icon, "assets/events/black-friday/order-timer.webp");
    book.validate(d);
  });
}

test("legacy seconds are not games; partial game counts and ready rewards survive immutable migration", () => {
  for (const [i, tier] of book.tiers.entries()) for (const template of [1, 2]) {
    const oldTarget = template === 1 ? [60,120,240][i] : [1,2,3][i];
    for (const ready of [false, true]) {
      const old = oneOrder(tier.id, template, oldTarget - (ready ? 0 : 1), true);
      old.swaps = 2; old.exchanges.coins = 3; old.earned = 60;
      const before = structuredClone(old), s = { days: { 1: old } };
      book.validate(old);
      const d = book.daily({ id: "p" }, s, 1, 1000, 5000), row = book.rows(d)[0];
      assert.deepEqual(old, before);
      assert.equal(d.earned, 60); assert.equal(d.swaps, 2); assert.deepEqual(d.exchanges, { coins: 3 });
      assert.equal(row.id, old.slots[0].current.id);
      assert.equal(row.target, ready ? oldTarget : tier.targets[template]);
      assert.equal(row.progress, ready ? oldTarget : template === 1 ? 0 : oldTarget - 1);
      assert.equal(row.metric, ready && template === 1 ? "survival" : "life");
      book.validate(d);
      const restored = JSON.parse(JSON.stringify(d));
      book.validate(restored);
      assert.equal(book.daily({ id: "p" }, { days: { 1: restored } }, 1, 1000, 6000), restored);
    }
  }
});

test("V2 old seconds validate and migrate without reviving completed lanes", () => {
  const d = { version: 2, earned: 90, swaps: 1, exchanges: {}, lanes: {} };
  for (const [i, tier] of book.tiers.entries()) d.lanes[tier.id] = {
    done: i === 2 ? 3 : 0,
    current: { id: `${tier.id}:${i === 2 ? 2 : 0}:0`, revision: 0, template: 1,
      assignedAt: 1000, progress: [59,120,240][i] },
  };
  book.validate(d);
  const next = book.daily({ id: "old" }, { days: { 1: d } }, 1, 1000, 3000);
  book.validate(next);
  assert.equal(book.count(next), 3);
  assert.equal(book.rows(next).find(r => r.id === "common:0:0").progress, 0);
  assert.equal(book.rows(next).find(r => r.id === "important:0:0").target, 120);
  assert.ok(!book.rows(next).some(r => r.id === "secret:2:0"));
});

for (const template of [1, 2]) test(`server game counter ${template}: replay, late assignment, failed write and retry`, () => {
  const f = fixture();
  f.p().wallet.bucks = 30; f.act("exchange", "bucks");
  const d = f.p().blackFriday.runs[f.run.id].days[B.day(f.now())];
  const selected = fixture.forceOrder(d, template), id = selected.id;
  const row = () => f.view().orders.find(o => o.id === id);
  const start = f.now(), lifeId = randomUUID();
  f.progress({ type: "lifeStarted", lifeId });
  f.time(start + 60000);
  const end = { type: "lifeEnded", lifeId, durationSeconds: 60, reason: "exit" };
  const before = structuredClone(f.p()), save = f.store.save;
  f.store.save = () => { throw Error("write failure"); };
  assert.throws(() => f.progress(end), /write failure/);
  assert.deepEqual(f.p(), before);
  f.store.save = save;
  f.progress(end); assert.equal(row().progress, 1);
  f.progress(end); assert.equal(row().progress, 1);
  const nextLife = randomUUID();
  f.progress({ type: "lifeStarted", lifeId: nextLife });
  f.time(f.now() + 30000);
  f.p().blackFriday.runs[f.run.id].days[B.day(f.now())].slots.find(s => s.current.id === id).current.assignedAt = f.now();
  f.time(f.now() + 30000);
  f.progress({ type: "lifeEnded", lifeId: nextLife, durationSeconds: 60, reason: "exit" });
  assert.equal(row().progress, 1, "Only 30 seconds played after assignment");
  B.validate(f.p());
});

test("old ready order remains claimable once; replacement uses current catalogue", () => {
  const f = fixture(); f.p().wallet.bucks = 30; f.act("exchange", "bucks");
  const d = f.p().blackFriday.runs[f.run.id].days[B.day(f.now())];
  delete d.catalogVersion;
  const c = fixture.forceOrder(d, 1); delete c.catalogVersion; c.progress = 60;
  const before = f.view().tokens, request = f.input("order", c.id);
  assert.equal(f.view().orders[0].target, 60);
  B.mutate(f.store, f.user.token, request, () => 0);
  assert.equal(f.view().tokens, before + 10);
  assert.equal(B.mutate(f.store, f.user.token, request).replay, true);
  assert.equal(f.view().tokens, before + 10);
  assert.equal(f.p().blackFriday.runs[f.run.id].days[B.day(f.now())].slots[0].current.catalogVersion, 2);
  B.validate(f.p());
});
