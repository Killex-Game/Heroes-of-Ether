/* Ежедневные бонусы аккаунтов: независимые валюты, полночь МСК и атомарная выдача. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { once } = require("node:events");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  accounts = require("../../src/server/accounts/account-benefits"),
  { accountLoginRewards: rewards } = require("../../public/shared/virtual-product-catalog"),
  { temporary } = require("../temp");
const NOW = Date.parse("2026-10-20T20:59:59Z");
const order = (kind, currency, extra = {}) => ({
  kind,
  currency,
  requestId: randomUUID(),
  ...extra,
});
function setup(filePath) {
  let now = NOW;
  const store = new ProfileStore({ filePath, now: () => now }),
    { token } = store.open();
  const activate = (kind) =>
    store.confirmMockPurchase(token, {
      productId: `account:${kind}`,
      confirmed: true,
      requestId: randomUUID(),
    });
  return {
    store,
    token,
    activate,
    at: (value) => {
      now = value;
    },
  };
}
test("Каждому бонусу нужен собственный активный аккаунт; подмена валюты и суммы не работает", () => {
  const { store, token, activate } = setup();
  const saved = structuredClone(store.find(token));
  for (const kind of ["vip", "premium"])
    for (const currency of ["coins", "crystals", "bucks"])
      assert.throws(
        () => store.claimAccountCurrencyBonus(token, order(kind, currency)),
        /активный/,
      );
  assert.deepEqual(store.find(token), saved);
  activate("vip");
  assert.throws(() => store.claimAccountCurrencyBonus(token, order("premium", "coins")), /Premium/);
  for (const [kind, currency] of [
    ["__proto__", "coins"],
    ["vip", "__proto__"],
    ["vip", "votes"],
  ])
    assert.throws(() => store.claimAccountCurrencyBonus(token, order(kind, currency)), /Выбери/);
  const before = store.find(token).wallet.coins;
  store.claimAccountCurrencyBonus(token, order("vip", "coins", { amount: 999999 }));
  assert.equal(store.find(token).wallet.coins, before + 50);
});
test("Все шесть бонусов независимы, сохраняются и не начисляются дважды", (t) => {
  const file = path.join(temporary(t, "account-bonuses"), "profiles.json");
  const { store, token, activate } = setup(file);
  activate("vip");
  activate("premium");
  const before = structuredClone(store.find(token).wallet);
  const purchases = structuredClone(store.find(token).activity.values);
  for (const [kind, currencies] of Object.entries(rewards)) {
    for (const [currency, amount] of Object.entries(currencies)) {
      const input = order(kind, currency);
      store.claimAccountCurrencyBonus(token, input);
      before[currency] += amount;
      assert.deepEqual(store.find(token).wallet, before);
      const saved = structuredClone(store.find(token));
      assert.equal(store.claimAccountCurrencyBonus(token, input).replay, true);
      assert.deepEqual(store.find(token), saved);
      assert.throws(
        () => store.claimAccountCurrencyBonus(token, order(kind, currency)),
        /уже получен/,
      );
      const restored = new ProfileStore({ filePath: file, now: () => NOW });
      assert.equal(restored.claimAccountCurrencyBonus(token, input).replay, true);
      assert.throws(
        () => restored.claimAccountCurrencyBonus(token, order(kind, currency)),
        /уже получен/,
      );
      assert.equal(
        restored.view(restored.find(token)).account.currencyBonuses[kind][currency].claimed,
        true,
      );
    }
  }
  for (const name of ["wealthy", "miner", "banker"])
    assert.equal(store.find(token).activity.values[name], purchases[name]);
});
test("Сброс ровно в 00:00 МСК, продление и откат часов не дают лишний бонус", () => {
  const { store, token, activate, at } = setup();
  activate("vip");
  const first = order("vip", "coins");
  store.claimAccountCurrencyBonus(token, first);
  activate("vip");
  assert.throws(() => store.claimAccountCurrencyBonus(token, order("vip", "coins")), /уже получен/);
  const reset = Date.parse("2026-10-20T21:00:00Z");
  assert.equal(store.view(store.find(token)).account.currencyBonusResetAt, reset);
  at(reset - 1);
  assert.throws(() => store.claimAccountCurrencyBonus(token, order("vip", "coins")), /уже получен/);
  at(reset);
  assert.equal(store.view(store.find(token)).account.currencyBonuses.vip.coins.claimed, false);
  assert.equal(store.claimAccountCurrencyBonus(token, first).replay, true);
  store.claimAccountCurrencyBonus(token, order("vip", "coins"));
  at(NOW);
  assert.throws(() => store.claimAccountCurrencyBonus(token, order("vip", "coins")), /уже получен/);
  at(store.find(token).account.vipUntil);
  assert.throws(() => store.claimAccountCurrencyBonus(token, order("vip", "coins")), /активный/);
});
test("Ошибка записи и переполнение не расходуют бонус, повреждённые отметки не принимаются", () => {
  const { store, token, activate } = setup();
  activate("premium");
  const input = order("premium", "bucks");
  const saved = structuredClone(store.find(token));
  const save = store.save.bind(store);
  store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => store.claimAccountCurrencyBonus(token, input), /disk/);
  assert.deepEqual(store.find(token), saved);
  store.save = save;
  store.claimAccountCurrencyBonus(token, input);
  store.find(token).wallet.coins = Number.MAX_SAFE_INTEGER;
  assert.throws(() => store.claimAccountCurrencyBonus(token, order("premium", "coins")), /баланс/);
  for (const currencyClaims of [[], null, { other: {} }, { vip: [] }, { vip: { coins: -1 } }])
    assert.throws(
      () => accounts.validate({ account: { ...accounts.fresh(), currencyClaims } }),
      /бонусы/,
    );
});
test("HTTP: сессия и собственный аккаунт обязательны, ответ содержит обновлённый баланс", async (t) => {
  const { store, token, activate } = setup();
  const app = createGameServer({
    profiles: store,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const response = await fetch(url + "/api/profile");
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const user = (await response.json()).profile;
  activate("vip");
  const send = (headers = {}) =>
    fetch(url + "/api/profile/account-bonus", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(order("vip", "coins", { recipient: store.find(token).id })),
    });
  assert.equal((await send({ Cookie: "" })).status, 401);
  assert.equal((await send({ Origin: "http://elsewhere.test" })).status, 403);
  assert.equal((await send()).status, 409);
  const p = store.byId(user.id);
  p.account = { ...accounts.fresh(), vipUntil: NOW + accounts.WEEK };
  const result = await send();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).profile.wallet.coins, user.wallet.coins + 50);
});
