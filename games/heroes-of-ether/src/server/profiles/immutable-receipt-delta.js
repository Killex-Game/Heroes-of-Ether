"use strict";
// Process-local provenance for internally constructed immutable receipt buckets.
// Not persisted and never trusted from a client or worker message. A missing or
// distant parent falls back to the complete journal comparison.
const parents = new WeakMap();
function remember(next, previous, set, remove = []) {
  // A long arena life must not retain every obsolete bucket generation.
  if (previous && next !== previous) parents.set(next, { previous: new WeakRef(previous), set, remove });
}
function changes(previous, next) {
  let current = next;
  const keys = new Set();
  for (let depth = 0; depth < 8; depth++) {
    const delta = parents.get(current);
    if (!delta) return null;
    const parent = delta.previous.deref();
    if (!parent) return null;
    for (const key of Object.keys(delta.set)) keys.add(key);
    for (const key of delta.remove) keys.add(key);
    if (parent === previous) {
      const set = Object.create(null), remove = [];
      for (const key of keys) {
        if (!Object.hasOwn(next, key) || next[key] === undefined) {
          if (Object.hasOwn(previous, key)) remove.push(key);
        } else if (!Object.hasOwn(previous, key) || previous[key] !== next[key]) set[key] = next[key];
      }
      return { set: Object.setPrototypeOf(set, Object.prototype), remove };
    }
    current = parent;
  }
  return null;
}
module.exports = { remember, changes };
