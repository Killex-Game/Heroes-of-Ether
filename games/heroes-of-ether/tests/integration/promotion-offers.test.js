"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { temporary } = require("../temp");
const { POOLS } = require("../../src/server/progression/title-chest-rewards");
const catalog = require("../../public/shared/virtual-product-catalog");
const promotions = require("../../src/server/shop/promotion-offers");
const config = require("../../config/promotions.json");
const now = () => Date.UTC(2026, 9, 25, 10);
const order = (productId) => ({ productId, requestId: randomUUID(), confirmed: true });
let playerNumber = 0;
function named(store) {
  const session = store.open();
  store.setPersonal(session.token, {
    name: "Новичок " + ++playerNumber,
    expectedName: session.profile.name,
    gender: "unspecified",
    requestId: randomUUID(),
  });
  return { ...session, profile: store.view(store.find(session.token)) };
}

test("Акционные наборы: точный состав без множителей, случайные бустеры только нужного качества, один раз на профиль", (t) => {
  const filePath = path.join(temporary(t, "promotion-rewards"), "profiles.json");
  const store = new ProfileStore({ filePath, now, promotionConfig: config });
  const { token } = named(store),
    other = named(store);
  store.activateAccount(token, { kind: "vip", requestId: randomUUID() });
  store.activateAccount(token, { kind: "premium", requestId: randomUUID() });
  for (const id of config.productIds) {
    const product = catalog.get(id),
      before = structuredClone(store.find(token));
    const input = {
      ...order(id),
      votes: 0,
      amount: 9999999,
      wallet: { coins: 9999999 },
      recipientId: other.profile.id,
    };
    const result = store.confirmMockPurchase(token, input),
      p = store.find(token);
    assert.equal(result.payment.votes, product.votes);
    for (const currency of ["coins", "crystals"])
      assert.equal(p.wallet[currency] - before.wallet[currency], product.wallet[currency]);
    for (const rarity of Object.keys(POOLS)) {
      const total = POOLS[rarity].reduce(
        (sum, id) => sum + (p.inventory[id] || 0) - (before.inventory[id] || 0),
        0,
      );
      assert.equal(total, product.boosters[rarity] || 0);
    }
    assert.equal(p.activity.values.wealthy - before.activity.values.wealthy, product.wallet.coins);
    assert.equal(p.activity.values.miner - before.activity.values.miner, product.wallet.crystals);
    assert.equal(store.find(other.token).wallet.coins, other.profile.wallet.coins);
    const committed = structuredClone(p);
    assert.equal(store.confirmMockPurchase(token, input).replay, true);
    assert.throws(() => store.confirmMockPurchase(token, order(id)), /уже куплен/);
    assert.deepEqual(store.find(token), committed);
    const restored = new ProfileStore({ filePath, now, promotionConfig: config });
    assert.equal(restored.confirmMockPurchase(token, input).replay, true);
    assert.deepEqual(restored.find(token), committed);
    assert.throws(() => restored.confirmMockPurchase(token, order(id)), /уже куплен/);
  }
  assert.deepEqual(store.view(store.find(token)).promotions, []);
  assert.deepEqual(store.view(store.find(other.token)).promotions, config.productIds);
});
test("Закрытая акция отклоняет новую покупку, но позволяет восстановить подтверждение уже выданного набора", () => {
  const store = new ProfileStore({ now, promotionConfig: config }),
    { token } = named(store);
  const input = order(config.productIds[0]);
  store.confirmMockPurchase(token, input);
  const committed = structuredClone(store.find(token));
  store.promotionConfig = promotions.configuration();
  assert.deepEqual(store.view(store.find(token)).promotions, []);
  assert.equal(store.confirmMockPurchase(token, input).replay, true);
  assert.throws(() => store.confirmMockPurchase(token, order(config.productIds[1])), /недоступна/);
  assert.deepEqual(store.find(token), committed);
  for (const bad of [
    { enabled: "true" },
    { enabled: true, productIds: ["coins:handful"] },
    { enabled: true, productIds: [config.productIds[0], config.productIds[0]] },
  ])
    assert.throws(() => promotions.configuration(bad));
});
test("Ошибка записи или переполнение не выдаёт часть набора и не расходует разовое предложение", () => {
  const store = new ProfileStore({ now, promotionConfig: config }),
    { token } = named(store);
  const input = order(config.productIds[0]),
    before = structuredClone(store.find(token));
  const save = store.save;
  store.save = () => {
    throw Error("disk failed");
  };
  assert.throws(() => store.confirmMockPurchase(token, input), /disk failed/);
  assert.deepEqual(store.find(token), before);
  assert.deepEqual(store.view(store.find(token)).promotions, config.productIds);
  store.save = save;
  assert.equal(store.confirmMockPurchase(token, input).replay, false);
  store.find(token).wallet.crystals = Number.MAX_SAFE_INTEGER;
  const overflow = structuredClone(store.find(token));
  assert.throws(() => store.confirmMockPurchase(token, order(config.productIds[1])), /баланс/);
  assert.deepEqual(store.find(token), overflow);
});

test("Ровно неделя с первого ника: до ника закрыто, смена ника и перезапуск не продлевают, граница срока строгая", (t) => {
  const week = 7 * 86400000,
    start = now();
  let at = start;
  const filePath = path.join(temporary(t, "promotion-deadline"), "profiles.json");
  const store = new ProfileStore({ filePath, now: () => at, promotionConfig: config }),
    { token } = store.open();
  assert.deepEqual(store.view(store.find(token)).promotions, []);
  assert.throws(() => store.confirmMockPurchase(token, order(config.productIds[0])), /7 дней/);
  at += 2 * 86400000;
  const first = {
    name: "Первый ник",
    expectedName: store.find(token).name,
    gender: "male",
    requestId: randomUUID(),
    firstNameSetAt: 1,
  };
  store.setPersonal(token, first);
  const started = at,
    end = started + week;
  assert.equal(store.find(token).personal.firstNameSetAt, started);
  assert.deepEqual(
    store.view(store.find(token)).promotionEndsAt,
    Object.fromEntries(config.productIds.map((id) => [id, end])),
  );
  at += 86400000;
  assert.equal(store.setPersonal(token, first).replay, true);
  store.setPersonal(token, {
    name: "Второй ник",
    expectedName: "Первый ник",
    gender: "female",
    confirmed: true,
    requestId: randomUUID(),
  });
  assert.equal(store.find(token).personal.firstNameSetAt, started);
  const restored = new ProfileStore({ filePath, now: () => at, promotionConfig: config });
  assert.deepEqual(restored.view(restored.find(token)).promotions, config.productIds);
  at = end - 1;
  const input = order(config.productIds[0]);
  restored.confirmMockPurchase(token, input);
  assert.deepEqual(restored.view(restored.find(token)).promotions, [config.productIds[1]]);
  at = end;
  const committed = structuredClone(restored.find(token));
  assert.deepEqual(restored.view(restored.find(token)).promotions, []);
  assert.throws(() => restored.confirmMockPurchase(token, order(config.productIds[1])), /7 дней/);
  assert.equal(restored.confirmMockPurchase(token, input).replay, true);
  assert.deepEqual(restored.find(token), committed);
  at = end + week;
  assert.deepEqual(
    new ProfileStore({ filePath, now: () => at, promotionConfig: config }).view(committed)
      .promotions,
    [],
  );
});

test("Отказ записи ника не запускает срок; прежний установленный ник без даты не получает новую неделю", () => {
  let at = now();
  const store = new ProfileStore({ now: () => at, promotionConfig: config }),
    { token } = store.open();
  const first = {
    name: "Проверка",
    expectedName: store.find(token).name,
    gender: "unspecified",
    requestId: randomUUID(),
  };
  const save = store.save,
    before = structuredClone(store.find(token));
  store.save = () => {
    throw Error("disk failed");
  };
  assert.throws(() => store.setPersonal(token, first), /disk failed/);
  assert.deepEqual(store.find(token), before);
  store.save = save;
  at += 1000;
  store.setPersonal(token, first);
  assert.equal(store.find(token).personal.firstNameSetAt, at);
  delete store.find(token).personal.firstNameSetAt;
  store.setPersonal(token, {
    name: "Старый игрок",
    expectedName: "Проверка",
    gender: "male",
    confirmed: true,
    requestId: randomUUID(),
  });
  assert.equal(store.find(token).personal.firstNameSetAt, undefined);
  assert.deepEqual(store.view(store.find(token)).promotions, []);
});
