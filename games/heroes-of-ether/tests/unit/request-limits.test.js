/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { RequestLimits } = require("../../src/server/http/request-rate-limits");

test("Бюджеты запросов независимы; время восстанавливает токены, откат часов не даёт лишних", () => {
  let time = 0;
  const limiter = new RequestLimits({
    now: () => time,
    limits: { read: { capacity: 2, perSecond: 1 }, write: { capacity: 1, perSecond: 0.5 } },
  });
  assert.ok(limiter.take("a", "read").allowed);
  assert.ok(limiter.take("a", "read").allowed);
  assert.deepEqual(limiter.take("a", "read"), { allowed: false, retryAfter: 1 });
  assert.ok(limiter.take("a", "write").allowed);
  assert.deepEqual(limiter.take("a", "write"), { allowed: false, retryAfter: 2 });
  assert.ok(limiter.take("b", "read").allowed);
  time = 1000;
  assert.ok(limiter.take("a", "read").allowed);
  time = 0;
  assert.equal(limiter.take("a", "read").allowed, false);
  time = 1000;
  assert.equal(limiter.take("a", "read").allowed, false);
  time = 2000;
  assert.ok(limiter.take("a", "read").allowed);
});

test("Таблица адресов ограничена; наплыв новых адресов не сбрасывает активные ограничения", () => {
  let time = 0;
  const limiter = new RequestLimits({
    now: () => time,
    maxAddresses: 2,
    idleMs: 1000,
    limits: { read: { capacity: 1, perSecond: 1 } },
  });
  limiter.take("a", "read");
  limiter.take("b", "read");
  for (let i = 0; i < 10000; i++) assert.equal(limiter.take(`new-${i}`, "read").allowed, false);
  assert.equal(limiter.addresses.size, 2);
  assert.equal(limiter.take("a", "read").allowed, false);
  time = 1000;
  assert.ok(limiter.take("c", "read").allowed);
  assert.equal(limiter.addresses.size, 1);
});

test("Срок хранения не короче полного восстановления самого медленного бюджета", () => {
  let time = 0;
  const limiter = new RequestLimits({
    now: () => time,
    idleMs: 10,
    limits: { read: { capacity: 2, perSecond: 0.1 } },
  });
  limiter.take("a", "read");
  limiter.take("a", "read");
  time = 100;
  assert.equal(limiter.take("a", "read").allowed, false);
  assert.throws(() => limiter.take("a", "unknown"), RangeError);
});
