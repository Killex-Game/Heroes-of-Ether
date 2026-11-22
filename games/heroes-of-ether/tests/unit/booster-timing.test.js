/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { cooldown, label } = require("../../public/shared/booster-cooldowns");
const { publicCatalog } = require("../../src/server/boosters/booster-catalog");
const catalog = publicCatalog();
const
  item = (id) => catalog.items.find((b) => b.id === id);
test("Таймер щита независим от срока эффекта, плавно убывает и учитывает серверный сброс", () => {
  const me = {
    boosterCooldowns: { sphere: 500 },
    effects: [{ id: "sphere", remainingMs: 40000 }],
    boosterCooldownMs: 1000,
  };
  assert.deepEqual(cooldown(item("sphere"), me, 234, catalog.rules), {
    ms: 266,
    duration: 500,
  });
  assert.equal(cooldown(item("colorful_shield"), me, 0, catalog.rules).ms, 0);
  assert.equal(cooldown(item("sphere"), me, 15000, catalog.rules).ms, 0);
  me.effects = []; // Breaking an effect must not bypass its reuse timer.
  assert.equal(cooldown(item("sphere"), me, 0, catalog.rules).ms, 500);
  me.effects = [{ id: "golden_shield", remainingMs: 35000 }];
  assert.equal(cooldown(item("sphere"), me, 0, catalog.rules).ms, 500);
  me.boosterCooldowns = {};
  me.boosterCooldownMs = 0;
  assert.equal(cooldown(item("sphere"), me, 0, catalog.rules).ms, 0);
});
test("Еда показывает свой таймер; эффекты и общий старый таймер не блокируют другие предметы", () => {
  const me = {
    boosterCooldownMs: 1000,
    boosterCooldowns: { candy: 200, poison: 500, speed: 500, sponge: 500 },
    effects: [
      { id: "speed", remainingMs: 12000 },
      { id: "sponge", remainingMs: 3000 },
    ],
  };
  assert.equal(cooldown(item("candy"), me).ms, 200);
  assert.deepEqual(cooldown(item("poison"), me, 400, catalog.rules), { ms: 100, duration: 500 });
  assert.deepEqual(cooldown(item("speed"), me, 500, catalog.rules), { ms: 0, duration: 500 });
  assert.deepEqual(cooldown(item("sponge"), me, 500, catalog.rules), { ms: 0, duration: 500 });
  assert.equal(cooldown(item("speed"), me, 12001, catalog.rules).ms, 0);
  assert.equal(label(14999), "15");
  assert.equal(label(999), "1.0");
  assert.equal(label(230), "0.3");
});
