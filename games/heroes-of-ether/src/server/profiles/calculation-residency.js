"use strict";
const tableDeltas = require('./immutable-table-delta');

// A calculation lane may retain a small idle working set, but must not grow
// into a replica of every account ever seen. Current inputs always take
// precedence over the idle limit; eviction removes only local replicas.
function retain(prior, incoming, recent, limit) {
  const active = Object.keys(incoming), current = new Set(active);
  const table = { ...prior, ...incoming }, changed = active.slice();
  for (const key of active) { recent.delete(key); recent.set(key, true); }
  const ceiling = Math.max(limit, active.length);
  let size = recent.size, evicted = 0;
  if (size > ceiling) for (const key of recent.keys()) {
    if (size <= ceiling) break;
    if (current.has(key)) continue;
    recent.delete(key);
    if (Object.hasOwn(table, key)) { delete table[key]; changed.push(key); size--; evicted++; }
  }
  tableDeltas.remember(table, prior, changed);
  return { table, size, evicted };
}
module.exports = { retain };
