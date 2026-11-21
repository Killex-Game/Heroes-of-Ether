"use strict";
const tables = require("./immutable-table-delta");
const indexes = new WeakMap();
let latest;
// Only sealed, immutable profile tables. Ordinary progress replaces rows but
// cannot change their IDs. Unknown ancestry and membership changes rebuild.
function profileKeys(profiles) {
  let index = indexes.get(profiles);
  if (index) return index;
  const changed = latest && tables.changedKeys(latest.profiles, profiles);
  if (changed && changed.every(key => profiles[key] && latest.profiles[key] &&
    profiles[key].id === latest.profiles[key].id)) index = latest.index;
  else index = new Map(Object.entries(profiles).map(([key, p]) => [p.id, key]));
  indexes.set(profiles, index); latest = { profiles, index };
  return index;
}
function remember(profiles, index) { indexes.set(profiles, index); }
module.exports = { profileKeys, remember, has: profiles => indexes.has(profiles) };
