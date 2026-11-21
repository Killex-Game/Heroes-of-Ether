"use strict";
const { keysForCopy } = require("./immutable-table-delta");
// Preserve object-spread semantics without V8's costly generic CopyDataProperties
// path on large dictionary-mode profile tables. Values remain shared; callers
// still replace individual immutable rows rather than mutate earlier snapshots.
function copyRecord(source) {
  const keys = keysForCopy(source);
  // Large profile tables are dictionary records. Populate them without a
  // prototype first, then restore the public spread-compatible prototype.
  // Small records keep the old path, which measured faster for 35 entries.
  const large = keys.length >= 128;
  const next = large ? Object.create(null) : {};
  for (const key of keys) {
    if (key === "__proto__") Object.defineProperty(next, key, {
      value: source[key], writable: true, enumerable: true, configurable: true,
    });
    else next[key] = source[key];
  }
  for (const key of Object.getOwnPropertySymbols(source))
    if (Object.prototype.propertyIsEnumerable.call(source, key)) next[key] = source[key];
  return large ? Object.setPrototypeOf(next, Object.prototype) : next;
}
module.exports = { copyRecord };
