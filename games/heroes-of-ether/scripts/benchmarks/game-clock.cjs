"use strict";
// This clock is confined to synthetic game rules. Storage leases, elapsed-time
// measurements, network latency and operating-system clocks remain real.
const DAY = 86400000;
function fromStart(start, realNow = Date.now()) {
  if (start === undefined || start === "") return describe(0, realNow);
  const at = Date.parse(start);
  if (!Number.isSafeInteger(at) || new Date(at).toISOString() !== start)
    throw Error("Use an exact UTC ISO timestamp for CAPACITY_GAME_AT");
  return describe(at - realNow, realNow);
}
function describe(offsetMs, realNow = Date.now()) {
  if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > 366 * DAY)
    throw Error("Synthetic game clock offset exceeds one year");
  return { mode: offsetMs ? "synthetic-offset" : "wall", offsetMs,
    realStartAt: new Date(realNow).toISOString(), gameStartAt: new Date(realNow + offsetMs).toISOString() };
}
function clock(offset = "0", realNow = Date.now) {
  if (!/^-?\d+$/.test(String(offset))) throw Error("Invalid synthetic clock offset");
  const offsetMs = Number(offset);
  describe(offsetMs, realNow());
  return () => realNow() + offsetMs;
}
module.exports = { fromStart, clock };
