"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const chests = require("../../src/server/clans/clan-chest-rewards"),
  history = require("../../src/server/profiles/transaction-history");
test("Старые системные уведомления показывают эфир без перезаписи сохранённой награды", () => {
  const p = {
      clanChests: {
        items: [],
        notices: [
          {
            id: "old",
            text: "Клановая битва завершена: 1 бакс и 20 баксов.",
            at: 100,
            kind: "reward",
          },
        ],
      },
    },
    before = structuredClone(p);
  assert.equal(chests.view(p, 200).notices[0].text, "Клановая битва завершена: 1 эфир и 20 эфира.");
  assert.deepEqual(p, before);
  assert.deepEqual(chests.view(p, 200), chests.view(p, 200));
});
test("Журнал переводит старые суммы в эфир, сохраняя баланс, квитанции и пользовательские названия", () => {
  const p = {
      id: "player",
      transactions: {
        startedAt: 1,
        opening: { bucks: 10 },
        entries: [
          {
            id: "reward",
            kind: "reward",
            at: 2,
            label: "Награда: 5 баксов",
            before: { bucks: 10 },
            after: { bucks: 15 },
          },
          {
            id: "payment",
            kind: "payment",
            at: 3,
            label: "Тестовая покупка: Сдача",
            detail: "20 баксов",
            payment: { productId: "bucks:change" },
            before: { bucks: 15 },
            after: { bucks: 35 },
          },
          {
            id: "clan",
            kind: "clan",
            at: 4,
            label: "Операция клана",
            detail: "Клан: Баксы",
            before: { bucks: 35 },
            after: { bucks: 34 },
          },
        ],
      },
    },
    before = structuredClone(p),
    rows = history.page(p).entries;
  assert.equal(rows[2].label, "Награда: 5 эфира");
  assert.equal(rows[1].detail, "20 эфира");
  assert.equal(rows[0].detail, "Клан: Баксы");
  assert.deepEqual(
    rows.map((r) => r.after.bucks),
    [34, 35, 15],
  );
  assert.equal(rows[1].payment.productId, "bucks:change");
  assert.deepEqual(p, before);
});
