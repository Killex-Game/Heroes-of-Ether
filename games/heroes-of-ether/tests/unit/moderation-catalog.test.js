"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const catalog = require("../../public/ui/admin/moderation-catalog");
const { REASONS } = require("../../src/server/chat/chat-rules");

test("legacy automatic sanctions and canonical rule references have explicit categories", () => {
  assert.equal(catalog.forReason(REASONS.flood).id, "2.1");
  assert.equal(catalog.forReason(REASONS.profanity).id, "2.2");
  assert.equal(catalog.forReason("Нарушение правил игры по пункту 3.2").minutes, 259200);
  assert.equal(catalog.forReason("Нарушение правил игры по пункту 3.5. Подделка оплаты").id, "3.5");
  assert.equal(catalog.forReason("Временное ограничение по пункту 5.4").id, "5.4");
  for (const rule of catalog.rules) assert.equal(catalog.forReason(catalog.reasonFor(rule.id)), rule);
});

test("free text, quoted allegations and similar clause numbers are never guessed as offences", () => {
  for (const reason of [undefined, null, "", "Читерство", "Жалоба на мошенничество не подтверждена",
    "Игрок написал: Нарушение правил игры по пункту 3.2", "Нарушение правил игры по пункту 3.20",
    "Нарушение правил игры по пункту 3.2abc", "Нарушение правил игры по пункту 9.9",
    "Флуд и спам в чате? Нет", "<img src=x onerror=alert(1)>"])
    assert.equal(catalog.forReason(reason), null, String(reason));
});

test("handbook is immutable and distinguishes investigation from a proven violation", () => {
  assert(Object.isFrozen(catalog.rules)); assert(catalog.rules.every(Object.isFrozen));
  assert.match(catalog.find("5.4").detail, /Не считается подтверждённым нарушением/u);
  assert.match(catalog.find("2.2").detail, /не растёт выше часа/u);
  assert.equal(catalog.find("4.6").minutes, undefined);
  assert.equal(catalog.reasonFor("unknown"), "");
});
