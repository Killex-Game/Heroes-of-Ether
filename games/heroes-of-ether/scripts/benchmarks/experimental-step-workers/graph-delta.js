"use strict";

// Private, lossless, bidirectional checkpoint transport. This is deliberately
// not a client protocol. Objects keep their identity on both sides, including
// shared player/body references used by combat. Only changed fields cross the
// worker boundary. Each endpoint owns one parity of monotonically allocated IDs.
class GraphDelta {
  constructor(parity = 0) {
    this.nextId = parity + 2;
    this.ids = new WeakMap();
    this.nodes = new Map();
    this.tokens = new Map();
  }
  token(id) {
    let token = this.tokens.get(id);
    if (!token) this.tokens.set(id, token = { r: id });
    return token;
  }
  reference(value) {
    if (value === null || typeof value !== "object") return value;
    const id = this.ids.get(value);
    if (!id) throw Error("Unregistered graph reference");
    return this.token(id);
  }
  shape(object) {
    if (Array.isArray(object)) return ["a", Object.keys(object), Object.values(object), object.length];
    if (object instanceof Map) return ["m", null, [...object.entries()].flat()];
    if (object instanceof Set) return ["s", null, [...object]];
    if (object instanceof Date) return ["d", null, [object.getTime()]];
    if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer ||
        object instanceof WeakMap || object instanceof WeakSet) throw Error("Unsupported checkpoint node");
    return ["o", Object.keys(object), Object.values(object)];
  }
  encode(root) {
    const visited = new Set(), updates = [];
    const visit = object => {
      if (object === null || typeof object !== "object") {
        if (typeof object === "function" || typeof object === "symbol") throw Error("Unsupported checkpoint value");
        return object;
      }
      let id = this.ids.get(object);
      if (!id) { id = this.nextId; this.nextId += 2; this.ids.set(object, id); }
      if (visited.has(id)) return this.token(id);
      visited.add(id);
      const [kind, keys, raw, length] = this.shape(object);
      const values = raw.map(visit), old = this.nodes.get(id);
      const sameShape = old && old.kind === kind && old.length === length &&
        (keys ? old.keys?.length === keys.length && keys.every((key, i) => key === old.keys[i]) : true);
      if (!sameShape) updates.push([id, kind, keys, values, length, true]);
      else if (keys) {
        const changedKeys = [], changedValues = [];
        for (let i = 0; i < keys.length; i++) if (!Object.is(values[i], old.values[i])) {
          changedKeys.push(keys[i]); changedValues.push(values[i]);
        }
        if (changedKeys.length) updates.push([id, kind, changedKeys, changedValues, length, false]);
      } else if (old.values.length !== values.length || values.some((value, i) => !Object.is(value, old.values[i])))
        updates.push([id, kind, null, values, length, true]);
      this.nodes.set(id, { object, kind, keys, values, length });
      return this.token(id);
    };
    const result = visit(root), removed = [];
    for (const id of this.nodes.keys()) if (!visited.has(id)) {
      removed.push(id); this.nodes.delete(id); this.tokens.delete(id);
    }
    return { root: result, updates, removed };
  }
  decode(packet) {
    // Allocate before resolving references: Maps, cycles and forward aliases
    // must resolve to the same object, rather than copies of its contents.
    for (const id of packet.removed) { this.nodes.delete(id); this.tokens.delete(id); }
    for (const [id, kind] of packet.updates) {
      const old = this.nodes.get(id);
      if (old && old.kind !== kind) throw Error("Checkpoint node changed type");
      if (old) continue;
      const object = kind === "a" ? [] : kind === "m" ? new Map() :
        kind === "s" ? new Set() : kind === "d" ? new Date() : {};
      this.ids.set(object, id);
      this.nodes.set(id, { object, kind });
    }
    const resolve = value => {
      if (value === null || typeof value !== "object") return value;
      const node = this.nodes.get(value.r);
      if (!node) throw Error("Missing checkpoint reference");
      return node.object;
    };
    for (const [id, kind, keys, values, length, reset] of packet.updates) {
      const node = this.nodes.get(id), object = node.object;
      if (kind === "m") {
        object.clear();
        for (let i = 0; i < values.length; i += 2) object.set(resolve(values[i]), resolve(values[i + 1]));
      } else if (kind === "s") {
        object.clear(); for (const value of values) object.add(resolve(value));
      } else if (kind === "d") object.setTime(values[0]);
      else {
        if (reset) for (const key of Object.keys(object)) delete object[key];
        if (kind === "a") object.length = length;
        for (let i = 0; i < keys.length; i++)
          Object.defineProperty(object, keys[i], { value: resolve(values[i]), writable: true, enumerable: true, configurable: true });
      }
    }
    // Adopt the received checkpoint as the reverse direction's baseline.
    for (const [id] of packet.updates) {
      const node = this.nodes.get(id);
      const [kind, keys, raw, length] = this.shape(node.object);
      Object.assign(node, { kind, keys, values: raw.map(value => this.reference(value)), length });
    }
    return resolve(packet.root);
  }
}
module.exports = { GraphDelta };
