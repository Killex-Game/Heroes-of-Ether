"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { recover } = require("../../src/server/profiles/profile-journal");
const B = require("../../src/server/events/black-friday");
const transactions = require("../../src/server/profiles/transaction-history");
const catalog = require("../../public/shared/virtual-product-catalog");
const order = (id, extra = {}) => ({
  productId: id,
  requestId: randomUUID(),
  confirmed: true,
  ...extra,
});

test("Every currency package: votes x 10 tokens, unchanged by coupon or both accounts; exact receipt and daily score", () => {
  for (const coupon of [false, true])
    for (const product of catalog.products.filter((p) => p.type === "currency")) {
      const f = fixture();
      if (coupon)
        f.store.confirmMockPurchase(
          f.user.token,
          order("event:manya-coupon", { eventId: f.run.id }),
        );
      for (const kind of ["vip", "premium"])
        f.store.activateAccount(f.user.token, { kind, requestId: randomUUID() });
      const before = f.view().tokens,
        earned = f.p().blackFriday?.runs[f.run.id]?.days[B.day(f.now())]?.earned || 0;
      const input = order(product.id, {
        currencyPromoRunId: f.run.id,
        fridayTokens: 999999,
        amount: 999999,
      });
      const result = f.store.confirmMockPurchase(f.user.token, input);
      assert.deepEqual(result.reward, {
        requestId: input.requestId,
        [product.currency]: product.amount * 2,
        fridayTokens: product.votes * 10,
      });
      assert.equal(f.view().tokens - before, product.votes * 10);
      assert.equal(
        f.p().blackFriday.runs[f.run.id].days[B.day(f.now())].earned - earned,
        product.votes * 10,
      );
      const after = structuredClone(f.p());
      assert.deepEqual(f.store.confirmMockPurchase(f.user.token, input).reward, result.reward);
      assert.deepEqual(f.p(), after);
      transactions.validate(f.p());
      B.validate(f.p());
    }
});

test("Regular purchases have currency-only receipts; replay during event never adds tokens retrospectively", () => {
  for (const product of catalog.products.filter((p) => p.type === "currency")) {
    const f = fixture();
    f.time(f.run.startsAt - 60000);
    const input = order(product.id, { currencyPromoRunId: null });
    const result = f.store.confirmMockPurchase(f.user.token, input);
    assert.deepEqual(result.reward, {
      requestId: input.requestId,
      [product.currency]: product.amount,
    });
    f.time(f.run.startsAt + 1000);
    const before = f.view().tokens;
    assert.deepEqual(f.store.confirmMockPurchase(f.user.token, input).reward, result.reward);
    assert.equal(f.view().tokens, before);
  }
});

test("Paid package and token exchange receipts survive journal recovery and event expiry", async (t) => {
  const filePath = path.join(temporary(t, "currency-receipts"), "profiles.json");
  const f = fixture({ filePath, journal: true });
  let restored;
  try {
    const input = order("crystals:source", { currencyPromoRunId: f.run.id });
    const paid = f.store.confirmMockPurchase(f.user.token, input);
    const exchanges = ["coins", "crystals", "bucks"].map((id) => {
      const input = f.input("buy", id);
      const result = B.mutate(f.store, f.user.token, input);
      const offer = B.shop.find((o) => o.id === id);
      assert.deepEqual(result.currencyReward, { requestId: input.requestId, [id]: offer.count });
      assert.equal(result.reward, undefined);
      return { input, reward: result.currencyReward };
    });
    const durable = Object.values(recover(filePath).data.profiles).find((p) => p.id === f.p().id);
    assert.deepEqual(durable.transactions, f.p().transactions);
    await f.store.close();
    restored = new ProfileStore({ filePath, journal: true, now: () => f.now() });
    restored.events = f.manager;
    f.time(f.run.endsAt + 1);
    const replay = restored.confirmMockPurchase(f.user.token, input);
    assert.equal(replay.replay, true);
    assert.deepEqual(replay.reward, paid.reward);
    for (const { input, reward } of exchanges) {
      const before = structuredClone(restored.find(f.user.token).wallet);
      const result = B.mutate(restored, f.user.token, input);
      assert.equal(result.replay, true);
      assert.deepEqual(result.currencyReward, reward);
      assert.deepEqual(restored.find(f.user.token).wallet, before);
    }
    transactions.validate(restored.find(f.user.token));
  } finally {
    await restored?.close();
    await f.store.close();
  }
});

test("Failed save grants neither wallet nor tokens nor receipt; retry succeeds once", () => {
  const f = fixture(),
    input = order("coins:handful");
  assert.ok(catalog.get(input.productId));
  const before = structuredClone(f.p()),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => f.store.confirmMockPurchase(f.user.token, input), /disk failure/);
  assert.deepEqual(f.p(), before);
  f.store.save = save;
  const result = f.store.confirmMockPurchase(f.user.token, input);
  assert.equal(result.reward.fridayTokens, 10);
  const saved = structuredClone(f.p());
  f.store.confirmMockPurchase(f.user.token, input);
  assert.deepEqual(f.p(), saved);
});

test("Free VIP/Premium daily currency bonuses give no package tokens; legacy receipts only show saved wallet credit", () => {
  const f = fixture();
  for (const kind of ["vip", "premium"]) {
    f.store.activateAccount(f.user.token, { kind, requestId: randomUUID() });
    for (const currency of ["coins", "crystals", "bucks"]) {
      const before = f.view().tokens;
      f.store.claimAccountCurrencyBonus(f.user.token, { kind, currency, requestId: randomUUID() });
      assert.equal(f.view().tokens, before);
    }
  }
  const input = order("crystals:vein"),
    result = f.store.confirmMockPurchase(f.user.token, input);
  const entry = f.p().transactions.entries.find((e) => e.requestId === input.requestId);
  delete entry.reward;
  assert.deepEqual(f.store.confirmMockPurchase(f.user.token, input).reward, {
    crystals: result.reward.crystals,
    requestId: input.requestId,
  });
});
