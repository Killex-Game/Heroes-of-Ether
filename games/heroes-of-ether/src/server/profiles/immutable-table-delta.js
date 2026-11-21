"use strict";
// Internal provenance for sealed copy-on-write tables. Never accept these hints
// from clients, serialized data or unsealed mutable transaction drafts.
const parents = new WeakMap();
const copyKeys = new WeakMap();
const comparisons = new WeakMap();
function remember(next, previous, keys, sameKeyOrder = false) {
  if (!previous || !next || typeof previous!=="object" || typeof next!=="object" || next === previous) return;
  parents.set(next, {previous:new WeakRef(previous), keys:[...new Set(keys)]});
  comparisons.delete(next);
  // Only callers that replace existing rows may assert this. Deletion,
  // insertion or reordering keeps the normal Object.keys path. Arrays are
  // shared between immutable versions, never the tables or their values.
  if (sameKeyOrder && !copyKeys.has(next) && copyKeys.has(previous))
    copyKeys.set(next, copyKeys.get(previous));
}
function keysForCopy(table) {
  const saved = copyKeys.get(table);
  if (saved) return saved;
  const keys = Object.keys(table);
  // Mutable/unsealed input is deliberately never cached.
  if (parents.has(table)) copyKeys.set(table, Object.freeze(keys));
  return keys;
}
function changedKeys(previous, next) {
  if (previous === next) return [];
  // Only sealed immutable tables qualify. A mutable draft must still be
  // inspected after sealing, and callers may sort/mutate their returned list.
  const reusable = parents.has(previous) && parents.has(next);
  const cached = reusable && comparisons.get(next);
  if (cached && cached.previous.deref() === previous) return cached.keys.slice();
  const keys = calculateChangedKeys(previous, next);
  if (reusable && keys !== null)
    comparisons.set(next, { previous: new WeakRef(previous), keys: keys.slice() });
  return keys;
}
function calculateChangedKeys(previous, next) {
  const keys = new Set();
  let current=next;
  for (let depth=0;depth<64;depth++) {
    const delta=parents.get(current), parent=delta?.previous.deref();
    if (!parent) break;
    for (const key of delta.keys) keys.add(key);
    if (parent===previous) return [...keys].filter(key =>
      Object.hasOwn(previous,key)!==Object.hasOwn(next,key) || previous[key]!==next[key]);
    current=parent;
  }
  // A staged write can lose to a lobby transaction, or a settlement can jump
  // over an intermediate draft. Both immutable tables may still have a known
  // common ancestor. Compare the union of their edits instead of rescanning
  // every account. The common linear path above keeps its original cost.
  const ancestors = new Map([[next, 0]]), edits = [];
  current = next;
  for (let depth = 0; depth < 64; depth++) {
    const delta = parents.get(current), parent = delta?.previous.deref();
    if (!parent || ancestors.has(parent)) break;
    edits.push(delta.keys);
    ancestors.set(parent, edits.length);
    current = parent;
  }
  const branch = new Set();
  current = previous;
  for (let depth = 0; depth <= 64; depth++) {
    const steps = ancestors.get(current);
    if (steps !== undefined) {
      for (let i = 0; i < steps; i++) for (const key of edits[i]) branch.add(key);
      return [...branch].filter(key => Object.hasOwn(previous,key)!==Object.hasOwn(next,key) ||
        previous[key]!==next[key]);
    }
    const delta = parents.get(current), parent = delta?.previous.deref();
    if (!parent) return null;
    for (const key of delta.keys) branch.add(key);
    current = parent;
  }
  return null;
}
module.exports={remember,changedKeys,keysForCopy};
