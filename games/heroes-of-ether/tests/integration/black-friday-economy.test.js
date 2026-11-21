const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture"),
  B = require("../../src/server/events/black-friday"),
  R = require("../../src/server/rankings/event-leaderboards"),
  catalog = require("../../public/shared/virtual-product-catalog");
test("all paid currency bundles double at unchanged price; receipts and achievement totals agree, expiry rejects stale quotes", () => {
  for (const product of catalog.products.filter((p) => p.type === "currency")) {
    const f = fixture(),
      old = f.p().wallet[product.currency],
      input = {
        productId: product.id,
        confirmed: true,
        requestId: randomUUID(),
        currencyPromoRunId: f.run.id,
      };
    const result = f.store.confirmMockPurchase(f.user.token, input);
    assert.equal(f.p().wallet[product.currency] - old, 2 * product.amount);
    assert.equal(result.payment.votes, product.votes);
    const metric = { coins: "wealthy", crystals: "miner", bucks: "banker" }[product.currency];
    assert.equal(f.p().activity.values[metric], 2 * product.amount);
    const after = structuredClone(f.p());
    assert.equal(f.store.confirmMockPurchase(f.user.token, input).replay, true);
    assert.deepEqual(f.p(), after);
    f.time(f.run.endsAt);
    assert.equal(f.store.confirmMockPurchase(f.user.token, input).replay, true);
    assert.throws(
      () => f.store.confirmMockPurchase(f.user.token, { ...input, requestId: randomUUID() }),
      /Условия акции/,
    );
    // Expiry can also settle ordinary daily rankings. Measure this purchase separately.
    const beforeRegular = f.p().wallet[product.currency];
    f.store.confirmMockPurchase(f.user.token, {
      ...input,
      requestId: randomUUID(),
      currencyPromoRunId: null,
    });
    assert.equal(f.p().wallet[product.currency] - beforeRegular, product.amount);
  }
});
test("token score includes exchanges but not spending, resets at Moscow midnight; payout tiers 3/2/1/0 tickets once", () => {
  const f = fixture();
  f.p().wallet.bucks = 300;
  f.act("exchange", "bucks");
  f.act("exchange", "bucks");
  f.act("buy", "common");
  assert.equal(R.view(f.store, f.p()).mine.score, 20);
  assert.equal(f.view().tokens, 10);
  const date = B.day(f.now()),
    users = [f.p(), ...Array.from({ length: 101 }, () => f.store.find(f.store.open().token))];
  for (const [i, p] of users.entries()) {
    const d = structuredClone(f.p().blackFriday.runs[f.run.id].days[date]);
    d.earned = 200 - i;
    d.exchanges = { bucks: 200 - i };
    p.blackFriday = {
      runs: {
        [f.run.id]: {
          tokens: d.earned,
          completedOrders: 0,
          purchases: {},
          finalAt: null,
          days: { [date]: d },
        },
      },
    };
  }
  users[101].testBot = true;
  users[101].blackFriday.runs[f.run.id].days[date].earned = 99999;
  const before = structuredClone(f.store.data);
  assert.equal(R.view(f.store, f.p()).title, "Топ исполнителей");
  assert.equal(R.view(f.store, f.p()).total, 101);
  const midnight = R.dayEnd(date);
  assert.equal(R.settle(before, f.manager, midnight - 1), before);
  const paid = R.settle(before, f.manager, midnight);
  R.validate(paid);
  const entries = paid.eventDailyRankingResults[R.resultKey(f.run.id, date)].entries;
  for (const e of entries) {
    const old = Object.values(before.profiles).find((p) => p.id === e.id),
      p = Object.values(paid.profiles).find((p) => p.id === e.id),
      tier =
        e.rank <= 3
          ? [30, 100, 15, 3]
          : e.rank <= 10
            ? [20, 75, 10, 2]
            : e.rank <= 50
              ? [10, 50, 5, 1]
              : e.rank <= 100
                ? [5, 25, 0, 0]
                : [0, 0, 0, 0];
    assert.equal(p.greatness - old.greatness, tier[0]);
    assert.equal(p.wallet.coins - old.wallet.coins, tier[1]);
    assert.equal(p.wallet.crystals - old.wallet.crystals, tier[2]);
    assert.equal((p.roulette?.tickets || 0) - (old.roulette?.tickets || 0), tier[3]);
  }
  assert.equal(R.settle(paid, f.manager, midnight + 1), paid);
  f.time(midnight);
  assert.equal(R.view(f.store, f.p()).total, 0);
  assert.ok(f.view().tokens > 0);
});
