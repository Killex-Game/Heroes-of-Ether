"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  roulette = require("../../src/server/roulette/roulette-service"),
  lite = require("../../src/server/accounts/lite-account"),
  rules = require("../../public/shared/roulette-rules"),
  journal = require("../../src/server/profiles/transaction-history"),
  titles = require("../../src/server/progression/title-chest-rewards"),
  chests = require("../../src/server/clans/clan-chest-rewards");
const NOW = Date.UTC(2026, 9, 23, 12);
function fixture(filePath = null, config = { testEnabled: true }) {
  let at = NOW;
  const store = new ProfileStore({ filePath, now: () => at, rouletteConfig: config }),
    auth = store.open();
  const p = () => store.find(auth.token),
    scope = () => store.view(p()).roulette.lite.eventId;
  const order = (extra = {}) => ({
    productId: "account:lite",
    confirmed: true,
    requestId: randomUUID(),
    eventId: scope(),
    ...extra,
  });
  const purchase = (input = order()) => store.confirmMockPurchase(auth.token, input);
  const action = (name, extra = {}, rng) =>
    roulette.mutate(
      store,
      auth.token,
      { action: name, rulesVersion: rules.version, requestId: randomUUID(), ...extra },
      rng,
    );
  const buy = (currency, quantity, extra = {}) =>
    action("tickets", { currency, quantity, eventId: scope(), ...extra });
  const fund = () => {
    p().wallet = { coins: 1000000, crystals: 1000000, bucks: 1000000 };
    store.save(store.data);
  };
  return {
    store,
    auth,
    p,
    scope,
    order,
    purchase,
    action,
    buy,
    fund,
    time: (value) => {
      at = value;
    },
  };
}
test("Lite: цена 50 голосов, 50 билетов единожды, сохранение прежних билетов и журнал покупки", (t) => {
  const file = path.join(temporary(t, "lite-purchase"), "profiles.json"),
    f = fixture(file);
  lite.grantTickets(f.p(), 200);
  const before = structuredClone(f.p()),
    request = f.order({ votes: 0, amount: 9999 });
  const response = f.purchase(request);
  assert.equal(response.payment.votes, 50);
  assert.equal(response.profile.roulette.tickets, 250);
  assert.equal(response.profile.roulette.lite.endsAt, null);
  assert.equal(response.profile.roulette.lite.active, true);
  assert.deepEqual(f.p().wallet, before.wallet);
  assert.deepEqual(f.p().account, before.account);
  assert.equal(journal.page(f.p(), 1, "payment").entries[0].payment.productId, "account:lite");
  assert.equal(journal.page(f.p(), 1, "account").total, 1);
  journal.validate(f.p());
  const saved = structuredClone(f.p());
  assert.equal(f.purchase(request).replay, true);
  assert.throws(() => f.purchase(), /уже куплен/);
  assert.deepEqual(f.p(), saved);
  const restored = new ProfileStore({
    filePath: file,
    now: () => NOW,
    rouletteConfig: { testEnabled: true },
  });
  assert.equal(restored.confirmMockPurchase(f.auth.token, request).replay, true);
  assert.deepEqual(restored.find(f.auth.token), saved);
});
test("Два независимых лимита по 50, эфир без лимита события; точная стоимость и повтор", () => {
  const f = fixture();
  f.purchase();
  f.fund();
  const wallet = structuredClone(f.p().wallet),
    req = randomUUID();
  f.buy("coins", 49, { requestId: req });
  assert.equal(f.buy("coins", 49, { requestId: req }).replay, true);
  assert.throws(() => f.buy("coins", 2), /Лимит/);
  f.buy("coins", 1);
  f.buy("crystals", 50);
  assert.throws(() => f.buy("coins", 1), /Лимит/);
  assert.throws(() => f.buy("crystals", 1), /Лимит/);
  f.buy("bucks", 10000);
  f.buy("bucks", 10000);
  assert.equal(f.p().wallet.coins, wallet.coins - 5000);
  assert.equal(f.p().wallet.crystals, wallet.crystals - 500);
  assert.equal(f.p().wallet.bucks, wallet.bucks - 40000);
  assert.equal(f.p().activity.values.spendthrift, 5000);
  assert.equal(f.p().activity.values.spendthrift_i, 500);
  assert.equal(f.p().activity.values.spendthrift_ii, 40000);
  assert.equal(f.p().roulette.tickets, 20150);
  assert.deepEqual(f.store.view(f.p()).roulette.lite.remaining, {
    coins: 0,
    crystals: 0,
    bucks: null,
  });
  const saved = structuredClone(f.p());
  for (const quantity of [0, -1, 1.5, "1", null, Infinity, 10001])
    assert.throws(() => f.buy("bucks", quantity));
  assert.throws(() => f.buy("__proto__", 1));
  assert.throws(() => f.buy(["coins"], 1));
  assert.throws(() => f.buy(["crystals"], 1));
  assert.throws(() => f.buy("bucks", 1, { eventId: "old-event" }));
  assert.deepEqual(f.p(), saved);
});
test("Ивент завершён: Lite скрыт, купить и пользоваться нельзя; новый ивент даёт новые лимиты", () => {
  const config = {
      testEnabled: true,
      events: [
        { id: "autumn", startsAt: NOW, endsAt: NOW + 1000 },
        { id: "winter", startsAt: NOW + 2000, endsAt: NOW + 3000 },
      ],
    },
    f = fixture(null, config);
  const first = f.order();
  f.purchase(first);
  f.fund();
  f.buy("coins", 50);
  f.buy("crystals", 50);
  f.action("prepare");
  const offerId = f.p().roulette.offer.id;
  f.time(NOW + 1000);
  assert.equal(f.store.view(f.p()).roulette.lite.available, false);
  assert.equal(f.store.view(f.p()).roulette.lite.active, false);
  assert.throws(() => f.purchase(), /закончилось/);
  assert.throws(() => f.buy("bucks", 1), /активный Lite/);
  assert.equal(f.action("spin-five", { offerId }).result.spins.length, 5);
  const tickets = f.p().roulette.tickets;
  lite.chestOpened(f.p(), f.store.rouletteConfig, NOW + 1000);
  assert.equal(f.p().roulette.tickets, tickets);
  assert.equal(f.purchase(first).replay, true);
  f.time(NOW + 2000);
  assert.throws(() => f.purchase(f.order({ eventId: "autumn" })), /изменилось/);
  f.purchase();
  assert.equal(f.p().roulette.tickets, tickets + 50);
  f.buy("coins", 50);
  f.buy("crystals", 50);
  assert.equal(Object.keys(f.p().lite.events).length, 2);
  assert.equal(f.p().activity.values.spendthrift, 10000);
  assert.equal(f.p().activity.values.spendthrift_i, 1000);
  f.time(NOW + 3000);
  assert.equal(
    f.store.view(f.p()).roulette.lite.available,
    false,
    "testEnabled не возобновляет Lite после ивента",
  );
});
test("Lite: билет за клановые сундуки, исключение для сундуков званий, без дублей", () => {
  const f = fixture();
  f.purchase();
  f.p().account = {
    vipUntil: NOW + 100000,
    premiumUntil: NOW + 100000,
    dailyDay: null,
    dailyAmount: 0,
  };
  f.p().greatness = 10000;
  titles.awardTitles(f.p(), NOW);
  let expected = 50;
  for (const tier of ["high", "medium", "low"]) {
    const id = chests.grant(f.p(), tier, NOW, { claimRequired: true }).id;
    const action = (action, requestId = randomUUID()) =>
      f.store.clanChestAction(f.auth.token, { action, chestId: id, requestId });
    action("claim");
    action("prepare");
    assert.equal(f.p().roulette.tickets, expected);
    const req = randomUUID();
    action("open", req);
    expected++;
    action("open", req);
    assert.throws(() => action("open"), /открыт/);
    assert.equal(f.p().roulette.tickets, expected);
  }
  f.store.prepareChest(f.auth.token, "novice", randomUUID());
  assert.equal(f.p().roulette.tickets, expected);
  const req = randomUUID();
  f.store.openChest(f.auth.token, "novice", req);
  f.store.openChest(f.auth.token, "novice", req);
  assert.throws(() => f.store.openChest(f.auth.token, "novice", randomUUID()), /открыт/);
  assert.equal(f.p().roulette.tickets, expected);
  chests.award(f.p(), { coins: 100 }, NOW, { multiply: false });
  assert.equal(f.p().roulette.tickets, expected, "Прямая награда не является сундуком");
});
test("Пять вращений без Lite: пять отдельных розыгрышей, ровно пять билетов, повтор после перезапуска", (t) => {
  const file = path.join(temporary(t, "lite-five"), "profiles.json"),
    f = fixture(file);
  lite.grantTickets(f.p(), 50);
  f.action("prepare");
  const requestId = randomUUID(),
    offerId = f.p().roulette.offer.id;
  // Все пять попадают в VIP: 5 независимых выборов категории и 4 новых состава.
  let categoryRolls = 0;
  const result = f.action("spin-five", { requestId, offerId }, (n) => {
    if (n === 6000) categoryRolls++;
    return 0;
  });
  assert.equal(categoryRolls, 5);
  assert.equal(result.result.spins.length, 5);
  assert.equal(new Set(result.result.spins.map((s) => s.offer.id)).size, 5);
  assert.equal(f.p().roulette.tickets, 45);
  assert.equal(f.p().roulette.spent, 5);
  assert.equal(f.p().account.vipUntil, NOW + 5 * 3600000);
  assert.equal(f.action("spin-five", { requestId, offerId }).replay, true);
  f.action("prepare");
  f.action("spin", { offerId: f.p().roulette.offer.id });
  const saved = structuredClone(f.p());
  const disk = new ProfileStore({
    filePath: file,
    now: () => NOW,
    rouletteConfig: { testEnabled: true },
  });
  const replay = roulette.mutate(disk, f.auth.token, {
    action: "spin-five",
    requestId,
    offerId,
    rulesVersion: rules.version,
  });
  assert.deepEqual(replay.result, result.result);
  assert.deepEqual(disk.find(f.auth.token), saved);
  assert.equal(saved.roulette.spent, 6);
});
test("Без Lite пять вращений доступны; без пяти билетов и на арене имущество не меняется", () => {
  const f = fixture();
  lite.grantTickets(f.p(), 5);
  f.action("prepare");
  assert.equal(f.action("spin-five", { offerId: f.p().roulette.offer.id }).result.spins.length, 5);
  assert.equal(f.p().roulette.tickets, 0);
  f.action("prepare");
  const offerId = f.p().roulette.offer.id;
  lite.grantTickets(f.p(), 4);
  const saved = structuredClone(f.p());
  assert.throws(() => f.action("spin-five", { offerId }), /5 билетов/);
  assert.deepEqual(f.p(), saved);
  f.p().progress.session = { id: randomUUID() };
  assert.throws(() => f.buy("bucks", 1), /лобби/);
  assert.throws(() => f.action("spin-five", { offerId }), /лобби/);
});
test("Ошибка записи при покупке Lite, билетов, открытии сундука и пяти вращениях ничего не списывает и не выдаёт", (t) => {
  const file = path.join(temporary(t, "lite-disk"), "profiles.json"),
    f = fixture(file);
  const failure = (operation) => {
    const before = structuredClone(f.p()),
      bytes = fs.readFileSync(file, "utf8"),
      rename = fs.renameSync;
    fs.renameSync = () => {
      throw Error("disk offline");
    };
    try {
      assert.throws(operation, /disk offline/);
    } finally {
      fs.renameSync = rename;
    }
    assert.deepEqual(f.p(), before);
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
    operation();
    const after = structuredClone(f.p());
    operation();
    assert.deepEqual(f.p(), after);
  };
  const order = f.order();
  failure(() => f.purchase(order));
  f.fund();
  const buyId = randomUUID();
  failure(() => f.buy("coins", 50, { requestId: buyId }));
  f.action("prepare");
  const offerId = f.p().roulette.offer.id,
    spinId = randomUUID();
  failure(() => f.action("spin-five", { offerId, requestId: spinId }));
  const chestId = chests.grant(f.p(), "high", NOW).id;
  f.store.clanChestAction(f.auth.token, { action: "claim", chestId, requestId: randomUUID() });
  f.store.clanChestAction(f.auth.token, { action: "prepare", chestId, requestId: randomUUID() });
  const req = randomUUID();
  failure(() => f.store.clanChestAction(f.auth.token, { action: "open", chestId, requestId: req }));
});
test("Нехватка средств и переполнение билетов не расходуют валюту или лимит", () => {
  const f = fixture();
  f.purchase();
  f.p().wallet.coins = 0;
  const before = structuredClone(f.p());
  assert.throws(() => f.buy("coins", 1), /Недостаточно/);
  assert.deepEqual(f.p(), before);
  f.fund();
  f.p().roulette.tickets = f.p().roulette.earned = Number.MAX_SAFE_INTEGER;
  const overflow = structuredClone(f.p());
  assert.throws(() => f.buy("coins", 1), /баланс билетов/);
  assert.deepEqual(f.p(), overflow);
});
test("Закрытая рулетка, неверное расписание и повреждённые данные Lite не принимаются", () => {
  const f = fixture(null, {});
  assert.equal(f.store.view(f.p()).roulette.lite.available, false);
  assert.throws(() => f.purchase(), /закончилось/);
  for (const events of [
    [{ id: "__proto__", startsAt: 1, endsAt: 2 }],
    [
      { id: "one", startsAt: 1, endsAt: 3 },
      { id: "two", startsAt: 2, endsAt: 4 },
    ],
    [
      { id: "one", startsAt: 1, endsAt: 2 },
      { id: "one", startsAt: 3, endsAt: 4 },
    ],
  ])
    assert.throws(() => roulette.configuration({ events }));
  const active = fixture();
  active.purchase();
  active.p().lite.events[active.scope()].coinTickets = 51;
  assert.throws(() => roulette.validate(active.p()), /Lite/);
});
