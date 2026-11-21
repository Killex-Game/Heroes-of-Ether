"use strict";

// Arena profiles are validated, persisted JSON trees. Copy their mutable data
// without allocating a UTF-16 JSON string and parsing it again on every cast or
// progress batch. Keep JSON's treatment of omitted fields and array holes.
function copyArenaData(value) {
  if (typeof value === "bigint") throw new TypeError("BigInt is not persisted JSON data");
  if (value === null || typeof value !== "object")
    return typeof value === "number"
      ? !Number.isFinite(value)
        ? null
        : value === 0
          ? 0
          : value
      : value;
  if (Array.isArray(value)) {
    const result = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      result[i] =
        item === undefined || typeof item === "function" || typeof item === "symbol"
          ? null
          : copyArenaData(item);
    }
    return result;
  }
  // Persisted fields are plain objects. Preserve the old conversion for an
  // exceptional value introduced by a future migration (for example a Date).
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || typeof value.toJSON === "function")
    return JSON.parse(JSON.stringify(value));
  const result = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
    const copied = copyArenaData(item);
    if (key === "__proto__")
      Object.defineProperty(result, key, {
        value: copied,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else result[key] = copied;
  }
  return result;
}

// Reconcile a PRIVATE draft with its published base. Equal descendants keep
// their identity even when a sibling counter changed. This avoids resending or
// rechecking an entire history after a one-field update; neither input base nor
// arrays visible to a previous snapshot are ever mutated.
function shareArenaData(previous, draft) {
  if (previous === draft) return previous;
  if (!previous || !draft || typeof previous !== "object" || typeof draft !== "object") return draft;
  if (Array.isArray(previous) !== Array.isArray(draft)) return draft;
  const beforePrototype = Object.getPrototypeOf(previous), afterPrototype = Object.getPrototypeOf(draft);
  if (beforePrototype !== afterPrototype ||
      (!Array.isArray(draft) && afterPrototype !== Object.prototype && afterPrototype !== null)) return draft;
  const keys = Object.keys(draft);
  let same = keys.length === Object.keys(previous).length &&
    (!Array.isArray(draft) || previous.length === draft.length);
  for (const key of keys) {
    if (!Object.hasOwn(previous,key)) { same = false; continue; }
    const before = previous[key], after = draft[key];
    if (before === after) continue;
    // Counters, flags and strings dominate arena drafts. Descend only for
    // different object branches; primitive changes need no recursive call.
    const shared = before && after && typeof before === "object" && typeof after === "object"
      ? shareArenaData(before, after) : after;
    if (shared !== before) same = false;
    if (shared !== after) draft[key] = shared;
  }
  return same ? previous : draft;
}

module.exports = { copyArenaData, shareArenaData };
