"use strict";
const {isProxy}=require('node:util').types;
// Object.keys already puts array-index keys first in numeric order. Canonical
// object construction only sorts the remaining strings; retain that exact JSON
// order without allocating a temporary object and one pair per key.
function canonicalKeys(value) {
  const keys = Object.keys(value);
  // Caller-owned Proxy objects may override ownKeys order. Pinned JSON never
  // uses this compatibility path, but generic snapshots retain their old order.
  if (isProxy(value)) return Object.keys(Object.fromEntries(keys.sort().map(key=>[key,0])));
  let indexes = 0;
  while (indexes < keys.length) {
    const key = keys[indexes], number = Number(key);
    if (!Number.isInteger(number) || number < 0 || number >= 4294967295 || String(number) !== key) break;
    indexes++;
  }
  if (!indexes) return keys.sort();
  if (indexes === keys.length) return keys;
  const strings = keys.slice(indexes).sort();
  for (let i = 0; i < strings.length; i++) keys[indexes + i] = strings[i];
  return keys;
}
module.exports = { canonicalKeys };
