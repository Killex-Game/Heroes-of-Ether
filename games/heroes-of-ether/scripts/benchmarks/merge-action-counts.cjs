"use strict";
// Drivers report successful actions by their actual IDs, including event-only
// boosters. A static ordinary-booster catalogue must not discard those rows.
function mergeCounts(samples, field, defaults = []) {
  const totals = new Map(defaults.map(id => [id, 0]));
  for (const sample of samples) for (const [id, count] of Object.entries(sample[field] || {})) {
    if (!Number.isSafeInteger(count) || count < 0) throw Error("Invalid driver action count");
    const sum = (totals.get(id) || 0) + count;
    if (!Number.isSafeInteger(sum)) throw Error("Driver action count overflow");
    totals.set(id, sum);
  }
  return Object.fromEntries(totals);
}
module.exports = { mergeCounts };
