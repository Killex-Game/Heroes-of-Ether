"use strict";
// Internal worker transport, not the client protocol. Each room keeps only
// the last transferred food list. Camera selections/ACK histories stay in
// ArenaStateStream and never participate in this cache.
const frozenJson = new WeakMap();
function immutableRecord(value, keys = Object.keys(value)) {
  return Object.isFrozen(value) && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const item = descriptor.value;
    return 'value' in descriptor && (item === null ||
      (typeof item !== 'object' && typeof item !== 'function'));
  });
}
function metadataJson(value) {
  const cached = frozenJson.get(value);
  if (cached !== undefined) return cached;
  const result = JSON.stringify(value);
  // Launch metadata is shared by every positional snapshot of an ejected
  // particle. Nested mutable data and getters deliberately bypass this cache.
  if (immutableRecord(value) && !('toJSON' in value)) frozenJson.set(value, result);
  return result;
}
function canonicalKeys(keys) {
  return (keys.length === 6 || keys.length === 8 || keys.length === 9) &&
    keys[0] === 'id' && keys[1] === 'x' && keys[2] === 'y' && keys[3] === 'value' &&
    keys[4] === 'radius' && keys[5] === 'color' && (keys.length === 6 ||
    (keys[6] === 'artValue' && keys[7] === 'ejected' && (keys.length === 8 || keys[8] === 'birth')));
}
function record(row) {
  const keys = Object.keys(row), nested = [];
  const values = keys.map((key, i) => {
    const value = row[key];
    if (value && typeof value === "object") { nested[i] = metadataJson(value); return undefined; }
    return value;
  });
  // Only a frozen primitive record is safe to remember by identity. A shallow
  // freeze with a mutable nested extension must still take the value path.
  const immutable = immutableRecord(row, keys);
  return { source: immutable ? row : null, id: row.id, keys, values, nested, canonical: canonicalKeys(keys) &&
    Object.keys(nested).every(index => Number(index) === 8), x: row.x, y: row.y };
}
function sameMetadata(row, prior) {
  if (!prior) return false;
  if (prior.source === row) return true;
  const keys = Object.keys(row);
  if (keys.length !== prior.keys.length) return false;
  if (prior.canonical && canonicalKeys(keys)) {
    const values = prior.values;
    if (!Object.is(row.id, values[0]) || !Object.is(row.value, values[3]) ||
        !Object.is(row.radius, values[4]) || !Object.is(row.color, values[5]) ||
        (keys.length > 6 && (!Object.is(row.artValue, values[6]) || !Object.is(row.ejected, values[7])))) return false;
    if (keys.length < 9) return true;
    return row.birth && typeof row.birth === 'object'
      ? 8 in prior.nested && metadataJson(row.birth) === prior.nested[8]
      : !(8 in prior.nested) && Object.is(row.birth, values[8]);
  }
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== prior.keys[i]) return false;
    if (key === "x" || key === "y") continue;
    const value = row[key];
    if (value && typeof value === "object") {
      if (!(i in prior.nested) || metadataJson(value) !== prior.nested[i]) return false;
    } else if (i in prior.nested || !Object.is(value, prior.values[i])) return false;
  }
  return true;
}
class FoodTransferEncoder {
  constructor({ packed = false } = {}) { this.rows = []; this.index = new Map(); this.packed = packed; }
  encode(rows) {
    const next = [], index = new Map(), entries = [];
    // One code per output row: even = old row, odd = old row + next exact
    // Float64 coordinate pair, negative = new full object in added[]. The
    // buffers are single-use and transferred, never held by ACK baselines.
    const refs = this.packed ? new Int32Array(rows.length) : null;
    const positions = [], added = [];
    let identical = rows.length === this.rows.length;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], ordinal = this.index.get(row.id), prior = this.rows[ordinal];
      let cached;
      if (sameMetadata(row, prior)) {
        if (Object.is(row.x, prior.x) && Object.is(row.y, prior.y)) {
          if (refs) refs[i] = ordinal * 2; else entries.push(ordinal);
          cached = prior;
          if (ordinal !== i) identical = false;
        } else {
          if (refs) { refs[i] = ordinal * 2 + 1; positions.push(row.x, row.y); }
          else entries.push([ordinal, row.x, row.y]);
          // Keep a fixed record shape in the moving-food hot path. Metadata
          // stays shared; every positional record remains independent.
          cached = { source: prior.source, id: prior.id, keys: prior.keys,
            values: prior.values, nested: prior.nested, canonical: prior.canonical,
            x: row.x, y: row.y }; identical = false;
        }
      } else {
        if (refs) { added.push(row); refs[i] = -added.length; } else entries.push(row);
        cached = record(row); identical = false;
      }
      next.push(cached); index.set(row.id, i);
    }
    this.rows = next; this.index = index;
    return identical ? null : refs ? { refs, positions: Float64Array.from(positions), added } : entries;
  }
}
class FoodTransferDecoder {
  constructor() { this.rows = []; }
  decode(entries) {
    if (entries === null) return this.rows;
    const previous = this.rows;
    if (!Array.isArray(entries)) {
      const { refs, positions, added } = entries || {};
      if (!(refs instanceof Int32Array) || !(positions instanceof Float64Array) || !Array.isArray(added))
        throw Error("Invalid packed worker food");
      let cursor = 0;
      const rows = Array.from(refs, ref => {
        if (ref < 0) {
          const index = -ref - 1;
          if (index >= added.length) throw Error("Invalid worker food reference");
          return added[index];
        }
        const index = Math.floor(ref / 2);
        if (index >= previous.length) throw Error("Invalid worker food reference");
        if (!(ref & 1)) return previous[index];
        if (cursor + 2 > positions.length) throw Error("Invalid worker food coordinates");
        return { ...previous[index], x: positions[cursor++], y: positions[cursor++] };
      });
      if (cursor !== positions.length) throw Error("Invalid worker food coordinates");
      this.rows = rows;
      return rows;
    }
    const rows = entries.map(entry => {
      if (typeof entry === "number" || Array.isArray(entry)) {
        const index = Array.isArray(entry) ? entry[0] : entry;
        if (!Number.isSafeInteger(index) || index < 0 || index >= previous.length)
          throw Error("Invalid worker food reference");
        return Array.isArray(entry) ? { ...previous[index], x: entry[1], y: entry[2] } : previous[index];
      }
      return entry;
    });
    this.rows = rows;
    return rows;
  }
}
module.exports = { FoodTransferEncoder, FoodTransferDecoder };
