/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { cooldown, label } = require("../../public/shared/booster-cooldowns");
const { publicCatalog } = require("../../src/server/boosters/booster-catalog");
const catalog = publicCatalog(),
  item = (id) => catalog.items.find((b) => b.id === id);
test("Таймер щита независим от срока эффекта, плавно убывает и учитывает серверный сброс", () => {
  const me = {
    shieldCooldowns: { sphere: 15000 },
    effects: [{ id: "sphere", remainingMs: 40000 }],
    boosterCooldownMs: 1000,
  };
  assert.deepEqual(cooldown(item("sphere"), me, 1234, catalog.rules), {
    ms: 13766,
    duration: 15000,
  });
  assert.equal(cooldown(item("colorful_shield"), me, 0, catalog.rules).ms, 0);
  assert.equal(cooldown(item("sphere"), me, 15000, catalog.rules).ms, 0);
  me.effects = []; // Broken shield is immediately available on the server.
  assert.equal(cooldown(item("sphere"), me, 0, catalog.rules).ms, 0);
  me.effects = [{ id: "golden_shield", remainingMs: 35000 }];
  assert.equal(cooldown(item("sphere"), me, 0, catalog.rules).ms, 0);
  me.shieldCooldowns = {};
  me.boosterCooldownMs = 0;
  assert.equal(cooldown(item("sphere"), me, 0, catalog.rules).ms, 0);
});
test("Масса без видимой перезарядки; яд ждёт общую секунду, ускорение и Губка — свой эффект", () => {
  const me = {
    boosterCooldownMs: 1000,
    effects: [
      { id: "speed", remainingMs: 12000 },
      { id: "sponge", remainingMs: 3000 },
    ],
  };
  assert.equal(cooldown(item("candy"), me).ms, 0);
  assert.deepEqual(cooldown(item("poison"), me, 400, catalog.rules), { ms: 600, duration: 1000 });
  assert.deepEqual(cooldown(item("speed"), me, 500, catalog.rules), { ms: 11500, duration: 15000 });
  assert.deepEqual(cooldown(item("sponge"), me, 500, catalog.rules), { ms: 2500, duration: 5000 });
  assert.equal(cooldown(item("speed"), me, 12001, catalog.rules).ms, 0);
  assert.equal(label(14999), "15");
  assert.equal(label(999), "1.0");
  assert.equal(label(230), "0.3");
});
