"use strict";
// Snapshot timer projection. Keep own-key order and the exact deadline test,
// without allocating entry pairs and intermediate filter/map arrays each tick.
function remainingTimers(deadlines, now) {
  const result = {};
  for (const id of Object.keys(deadlines)) {
    const until = deadlines[id];
    if (!(until > now)) continue;
    if (id === "__proto__") {
      Object.defineProperty(result, id, {
        value: until - now, enumerable: true, writable: true, configurable: true,
      });
    } else result[id] = until - now;
  }
  return result;
}
function timerEffects(deadlines, now, clamp = false) {
  const result = [];
  for (const id of Object.keys(deadlines)) {
    const until = deadlines[id];
    if (until > now) result.push({ id, remainingMs: clamp ? Math.max(0, until - now) : until - now });
  }
  return result;
}
module.exports = { remainingTimers, timerEffects };
