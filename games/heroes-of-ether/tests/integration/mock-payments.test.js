/* Тестовые покупки: выдача по каталогу, повтор запроса, запись и запреты HTTP. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  catalog = require("../../public/shared/virtual-product-catalog"),
  accounts = require("../../src/server/accounts/account-benefits"),
  { temporary } = require("../temp");
const NOW = Date.UTC(2026, 9, 20, 12);
const order = (productId, extra = {}) => ({
  productId,
  confirmed: true,
  requestId: randomUUID(),
  ...extra,
});

test("Кристальная жила выдаёт 375 + 40 кристаллов; повтор не начисляет их снова", () => {
  const store = new ProfileStore({ now: () => NOW }),
    { token } = store.open();
  const before = store.find(token).wallet.crystals;
  const purchase = order("crystals:vein");
  store.confirmMockPurchase(token, purchase);
  assert.equal(store.find(token).wallet.crystals, before + 415);
  assert.equal(store.find(token).activity.values.miner, 415);
  assert.equal(store.confirmMockPurchase(token, purchase).replay, true);
  assert.equal(store.find(token).wallet.crystals, before + 415);
});

test("Каждая новая покупка одного пакета двигает достижения; повтор номера не даёт второй прогресс или награду", (t) => {
  let now = NOW;
  const filePath = path.join(temporary(t, "purchase-achievements"), "profiles.json");
  const store = new ProfileStore({ filePath, now: () => now }),
    { token } = store.open();
  for (const [productId, achievement, paidAmount] of [
    ["coins:treasury", "wealthy", 37500],
    ["crystals:source", "miner", 1875],
    ["bucks:bank", "banker", 2500],
  ]) {
    now += 86400000;
    const first = order(productId);
    store.confirmMockPurchase(token, first);
    assert.equal(store.find(token).activity.values[achievement], paidAmount);
    assert.ok(store.find(token).activity.claimed[achievement] >= 1);
    const before = structuredClone(store.find(token));
    store.confirmMockPurchase(token, first);
    assert.deepEqual(store.find(token), before);
    const second = order(productId);
    store.confirmMockPurchase(token, second);
    assert.equal(store.find(token).activity.values[achievement], paidAmount * 2);
    assert.throws(() => store.confirmMockPurchase(token, order(productId, { confirmed: false })));
    assert.equal(store.find(token).activity.values[achievement], paidAmount * 2);
    const restored = new ProfileStore({ filePath, now: () => now });
    const saved = structuredClone(restored.find(token));
    restored.confirmMockPurchase(token, second);
    assert.deepEqual(restored.find(token), saved);
  }
  for (const kind of ["vip", "premium"]) {
    now += 86400000;
    store.confirmMockPurchase(token, order("account:" + kind));
    store.confirmMockPurchase(token, order("account:" + kind));
    assert.equal(store.find(token).activity.values[kind], 2);
  }
});

test("Все 24 продукта: полная выдача пакета с процентным бонусом в кошелёк и достижения, без множителей аккаунтов", () => {
  assert.equal(catalog.products.length, 24);
  for (const product of catalog.products) {
    const store = new ProfileStore({
        now: () => NOW,
        rouletteConfig: { testEnabled: true },
        promotionConfig: require("../../config/promotions.json"),
      }),
      { token } = store.open();
    if (product.type === "promotion")
      store.setPersonal(token, {
        name: "Новичок",
        expectedName: store.find(token).name,
        gender: "unspecified",
        requestId: randomUUID(),
      });
    if (product.type === "currency") {
      store.activateAccount(token, { kind: "vip", requestId: randomUUID() });
      store.activateAccount(token, { kind: "premium", requestId: randomUUID() });
    }
    let couponRun;
    if (product.type === "manya-coupon") {
      const { EventManager } = require("../../src/server/events/event-manager");
      store.events = new EventManager({ now: () => NOW });
      store.events.apply("test", "start", { eventId: "black-friday", revision: 0, requestId: randomUUID() });
      couponRun = store.events.active().id;
    }
    const before = structuredClone(store.find(token).wallet),
      input = order(product.id, product.type === "lite" ? { eventId: "test:unlimited" } :
        couponRun ? { eventId: couponRun } : {});
    const result = store.confirmMockPurchase(token, input);
    assert.equal(result.payment.simulated, true);
    assert.equal(result.payment.votes, product.votes);
    if (product.type === "currency") {
      before[product.currency] += product.amount;
      assert.deepEqual(result.profile.wallet, before);
      const pack = catalog.currencies[product.currency].packages.find(
          (p) => product.id === product.currency + ":" + p.id,
        ),
        achievement = { coins: "wealthy", crystals: "miner", bucks: "banker" }[product.currency];
      assert.equal(store.find(token).activity.values[achievement], pack.base + pack.bonus);
    } else if (product.type === "promotion") {
      assert.equal(result.profile.wallet.coins, before.coins + product.wallet.coins);
      assert.equal(result.profile.wallet.crystals, before.crystals + product.wallet.crystals);
      assert.ok(!result.profile.promotions.includes(product.id));
    } else if (product.type === "manya-coupon") {
      assert.equal(result.profile.blackFriday.tokens, 500);
      assert.equal(result.profile.blackFriday.coupon.active, true);
      assert.equal(result.profile.fridayChests.length, 1);
      assert.deepEqual(result.profile.wallet, before);
    } else if (product.type === "lite") {
      assert.equal(result.profile.roulette.tickets, 50);
      assert.equal(result.profile.roulette.lite.active, true);
      assert.deepEqual(result.profile.wallet, before);
    } else {
      assert.equal(result.profile.account[product.kind + "Until"], NOW + accounts.WEEK);
      assert.equal(store.find(token).activity.values[product.kind], 1);
    }
    const saved = structuredClone(store.find(token));
    assert.equal(store.confirmMockPurchase(token, input).replay, true);
    assert.deepEqual(store.find(token), saved);
  }
});

test("Процентный бонус пакета открывает степень; клиент не меняет состав, повтор не дублирует награду", () => {
  for (const [id, achievement, initial, expected] of [
    ["coins:casket", "wealthy", 2000, 10250],
    ["crystals:mountain", "miner", 200, 1100],
    ["bucks:gift", "banker", 475, 1025],
  ]) {
    const store = new ProfileStore({ now: () => NOW }),
      { token } = store.open();
    store.find(token).activity.values[achievement] = initial;
    const input = order(id, { baseAmount: 999999, amount: 999999, bonus: 0 });
    store.confirmMockPurchase(token, input);
    const p = store.find(token);
    assert.equal(p.activity.values[achievement], expected);
    assert.equal(p.activity.claimed[achievement], 1);
    assert.ok(p.greatness > 0);
    store.confirmMockPurchase(token, order(id));
    assert.equal(store.find(token).activity.claimed[achievement], 1);
    const saved = structuredClone(store.find(token));
    store.confirmMockPurchase(token, input);
    assert.deepEqual(store.find(token), saved);
  }
});

test("Подтверждение обязательно; клиент не задаёт цену, количество или получателя", () => {
  const store = new ProfileStore({ now: () => NOW }),
    { token } = store.open(),
    other = store.open(),
    before = structuredClone(store.find(token));
  for (const input of [
    order("coins:handful", { confirmed: false }),
    order("coins:handful", { confirmed: undefined }),
    order("coins:handful", { confirmed: "true" }),
    order("__proto__"),
    order("missing"),
  ])
    assert.throws(() => store.confirmMockPurchase(token, input));
  assert.deepEqual(store.find(token), before);
  const input = order("coins:handful", {
    amount: 999999,
    baseAmount: 999999,
    votes: 0,
    currency: "crystals",
    recipientId: other.profile.id,
  });
  const result = store.confirmMockPurchase(token, input);
  assert.equal(result.profile.wallet.coins, before.wallet.coins + 300);
  assert.equal(result.profile.wallet.crystals, before.wallet.crystals);
  assert.equal(store.find(other.token).wallet.coins, other.profile.wallet.coins);
  assert.throws(
    () => store.confirmMockPurchase(token, { ...input, productId: "bucks:change" }),
    /номер уже/,
  );
});

test("VIP и Premium: продление остатка, новый срок после истечения и сохранение повторов", (t) => {
  let now = NOW;
  const filePath = path.join(temporary(t, "mock-payments"), "profiles.json"),
    store = new ProfileStore({ filePath, now: () => now }),
    { token } = store.open();
  for (const kind of ["vip", "premium"]) {
    store.confirmMockPurchase(token, order("account:" + kind));
    const input = order("account:" + kind);
    store.confirmMockPurchase(token, input);
    assert.equal(store.find(token).account[kind + "Until"], NOW + 2 * accounts.WEEK);
    const restored = new ProfileStore({ filePath, now: () => now });
    assert.equal(restored.confirmMockPurchase(token, input).replay, true);
    assert.equal(restored.find(token).activity.values[kind], 2);
  }
  now += 3 * accounts.WEEK;
  const result = store.confirmMockPurchase(token, order("account:vip"));
  assert.equal(result.profile.account.vipUntil, now + accounts.WEEK);
  const currencyOrder = order("crystals:vein");
  store.confirmMockPurchase(token, currencyOrder);
  const restored = new ProfileStore({ filePath, now: () => now });
  assert.equal(restored.confirmMockPurchase(token, currencyOrder).replay, true);
  assert.equal(restored.find(token).wallet.crystals, store.find(token).wallet.crystals);
});

test("Ошибка сохранения и переполнение не выдают товар и не расходуют номер операции", () => {
  for (const productId of ["coins:treasury", "crystals:source", "bucks:bank", "account:vip"]) {
    const store = new ProfileStore({ now: () => NOW }),
      { token } = store.open(),
      before = structuredClone(store.find(token)),
      input = order(productId);
    const save = store.save.bind(store);
    store.save = () => {
      throw Error("disk");
    };
    assert.throws(() => store.confirmMockPurchase(token, input), /disk/);
    assert.deepEqual(store.find(token), before);
    store.save = save;
    assert.equal(store.confirmMockPurchase(token, input).replay, false);
  }
  const store = new ProfileStore({ now: () => NOW }),
    { token } = store.open();
  store.find(token).wallet.coins = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(store.find(token));
  assert.throws(() => store.confirmMockPurchase(token, order("coins:handful")), /баланс/);
  assert.deepEqual(store.find(token), before);
});

test("HTTP: сессия, источник, JSON, подтверждение, повтор и запрет в арене", async (t) => {
  const app = createGameServer({ arena: new Arena({ etherCount: 0 }), autoTick: false });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`,
    response = await fetch(url + "/api/profile"),
    cookie = response.headers.get("set-cookie").split(";")[0],
    initial = (await response.json()).profile,
    input = order("coins:handful");
  const send = (body = input, headers = {}) =>
    fetch(url + "/api/mock-payments/confirm", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await send(input, { Cookie: "" })).status, 401);
  assert.equal((await send(input, { Origin: "http://elsewhere.test" })).status, 403);
  assert.equal((await send(input, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await send({ ...input, confirmed: false })).status, 400);
  const paid = await (await send()).json();
  assert.equal(paid.profile.wallet.coins, initial.wallet.coins + 300);
  assert.equal((await (await send()).json()).replay, true);
  const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      if (JSON.parse(raw).type === "welcome") resolve();
    });
  });
  const blocked = await send(order("account:vip"));
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "ARENA_ACTIVE");
  assert.equal(app.profiles.byId(initial.id).account?.vipUntil || 0, 0);
});
