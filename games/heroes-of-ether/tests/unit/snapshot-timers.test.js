"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { remainingTimers, timerEffects } = require("../../src/server/arena/snapshot-timers");
test("Timer snapshots preserve order, deadlines and independent retained values", () => {
  const timers = Object.assign(Object.create({ inherited: 999 }), { z: 15, a: 10, b: 5, zero: 0, invalid: NaN });
  Object.defineProperty(timers, "__proto__", { value: 20, enumerable: true });
  const result = remainingTimers(timers, 10), effects = timerEffects(timers, 10);
  assert.deepEqual(Object.keys(result), ["z", "__proto__"]);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.__proto__, 10);
  assert.deepEqual(effects, [{ id: "z", remainingMs: 5 }, { id: "__proto__", remainingMs: 10 }]);
  timers.z = 100;
  assert.equal(result.z, 5); assert.equal(effects[0].remainingMs, 5);
  assert.deepEqual(remainingTimers(timers, 100), {});
});
