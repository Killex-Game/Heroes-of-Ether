"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"), { once } = require("node:events");
const path = require("node:path");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const quota = require("../../src/server/shop/mock-purchase-limit");
const { loginRewardResetAt } = require("../../src/server/accounts/account-benefits");
const NOW = Date.UTC(2026, 10, 22, 10);
const order = (productId = "coins:handful") => ({ productId, confirmed: true, requestId: randomUUID() });

test("Five purchases across products and sessions; durable replay and next-day reset", t => {
  let now = NOW;
  const filePath = path.join(temporary(t, "mock-limit"), "profiles.json");
  let store = new ProfileStore({ filePath, now: () => now });
  const { token } = store.open();
  const orders = ["coins:handful", "crystals:sparks", "bucks:change", "account:vip", "account:premium"].map(order);
  for (const input of orders) store.confirmMockPurchase(token, input);
  assert.equal(quota.used(store.find(token), now), 5);
  const before = structuredClone(store.find(token)), rejected = order();
  assert.throws(() => store.confirmMockPurchase(token, rejected), e => e.code === "MOCK_DAILY_LIMIT" && e.status === 429);
  assert.deepEqual(store.find(token), before);
  store = new ProfileStore({ filePath, now: () => now });
  assert.throws(() => store.confirmMockPurchase(token, rejected), e => e.code === "MOCK_DAILY_LIMIT");
  assert.equal(store.confirmMockPurchase(token, orders[0]).replay, true);
  assert.throws(() => store.confirmMockPurchase(token, { ...orders[0], productId: "crystals:sparks" }), /номер уже использован/);
  assert.equal(quota.used(store.find(token), now), 5);
  now = loginRewardResetAt(now) - 1;
  assert.throws(() => store.confirmMockPurchase(token, rejected), e => e.code === "MOCK_DAILY_LIMIT");
  now++;
  store.confirmMockPurchase(token, rejected);
  assert.equal(quota.used(store.find(token), now), 1);
  assert.equal(store.confirmMockPurchase(token, orders[0]).replay, true);
  assert.equal(quota.used(store.find(token), now), 1);
});

test("Failed persistence does not consume quota; exhausted account fails before profile copy", () => {
  const store = new ProfileStore({ now: () => NOW }), { token } = store.open();
  const input = order(), save = store.save.bind(store), before = structuredClone(store.find(token));
  store.save = () => { throw Error("disk failure"); };
  assert.throws(() => store.confirmMockPurchase(token, input), /disk failure/);
  assert.deepEqual(store.find(token), before);
  assert.equal(quota.used(store.find(token), NOW), 0);
  store.save = save;
  store.confirmMockPurchase(token, input);
  for (let i = 1; i < 5; i++) store.confirmMockPurchase(token, order());
  store.transactProfile = () => { throw Error("expensive profile draft was reached"); };
  assert.throws(() => store.confirmMockPurchase(token, order()), e => e.code === "MOCK_DAILY_LIMIT");
});

test("Existing journal counts only confirmed mock purchases in the current server day", () => {
  const start = loginRewardResetAt(NOW) - 86400000;
  const entry = (id, at, payment = { provider: "mock", simulated: true, status: "confirmed" }) => ({ id, at, requestId: id, payment });
  const profile = { transactions: { entries: [entry("old", start - 1), entry("today", start),
    entry("today", start + 1), entry("gift", start + 2, null),
    entry("real", start + 3, { provider: "real", simulated: false, status: "confirmed" }),
    entry("failed", start + 4, { provider: "mock", simulated: true, status: "failed" })] } };
  assert.equal(quota.used(profile, NOW), 1);
  assert.equal(quota.used(profile, loginRewardResetAt(NOW)), 0);
});

test("Concurrent HTTP requests cannot exceed five; retry stays idempotent and accounts remain independent", async t => {
  const profiles = new ProfileStore({ now: () => NOW }), a = profiles.open(), b = profiles.open();
  const app = createGameServer({ profiles, autoTick: false, testBots: { enabled: false }, wallNow: () => NOW });
  app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  async function post(token, input) {
    const response = await fetch(url + "/api/mock-payments/confirm", { method: "POST",
      headers: { "content-type": "application/json", cookie: "sferorumiya_session=" + token, origin: url },
      body: JSON.stringify({ ...input, dailyLimit: 999, day: "2099-01-01" }) });
    return { status: response.status, retry: response.headers.get("retry-after"), body: await response.json() };
  }
  const inputs = Array.from({ length: 8 }, () => order()), results = await Promise.all(inputs.map(input => post(a.token, input)));
  assert.equal(results.filter(r => r.status === 200).length, 5);
  assert.equal(results.filter(r => r.status === 429 && r.body.code === "MOCK_DAILY_LIMIT").length, 3);
  for (const r of results.filter(r => r.status === 429)) {
    assert.equal(r.body.nextPurchaseAt, loginRewardResetAt(NOW)); assert(Number(r.retry) > 0);
  }
  const index = results.findIndex(r => r.status === 200);
  assert.equal((await post(a.token, inputs[index])).body.replay, true);
  assert.equal((await post(b.token, order())).status, 200);
  assert.equal(quota.used(profiles.find(a.token), NOW), 5);
  assert.equal(quota.used(profiles.find(b.token), NOW), 1);
});
