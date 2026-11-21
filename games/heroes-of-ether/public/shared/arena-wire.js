/* Compact state transport. The game receives the same complete player objects. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexArenaWire = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const platform = typeof module === "object" && module.exports
    ? require("./platform-contract") : globalThis.KillexPlatform;
  const PROTOCOL = platform.stateProtocol(8);
  const PRIVATE_STATE_PROTOCOL = platform.stateProtocol(7);
  const HUD_PROTOCOL = platform.stateProtocol(6);
  const MOTION_PROTOCOL = platform.stateProtocol(5);
  const PRESENTATION_PROTOCOL = platform.stateProtocol(4);
  const ENTITY_PROTOCOL = platform.stateProtocol(3);
  const LEGACY_PROTOCOL = platform.stateProtocol(2);
  const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
  function packPlayer(player) {
    const value = { ...player };
    for (const key of ["x", "y", "radius", "viewRadius"])
      if (key in value) value[key] = round(value[key]);
    if (player.parts)
      value.parts = player.parts.map((p) => {
        const row = [
          p.id,
          round(p.x),
          round(p.y),
          p.mass,
          round(p.radius),
          p.mergeVersion || 0,
          round(p.mergeMs || 0),
          round(p.burnMs || 0),
        ];
        if (p.birth) row.push(p.birth);
        return row;
      });
    return value;
  }
  const partKeys = ["x", "y", "mass", "radius", "mergeVersion", "mergeMs", "burnMs", "birth"];
  function partDelta(next, previous) {
    const sameOrder =
      previous?.length === next.length && next.every((row, i) => row[0] === previous[i][0]);
    const rows = [];
    next.forEach((row, i) => {
      let mask = 0;
      const values = [];
      for (let k = 1; k <= partKeys.length; k++) {
        const value = row[k] ?? null;
        const old = sameOrder ? (previous[i][k] ?? null) : undefined;
        if (
          !sameOrder ||
          (value !== old && (k !== 8 || JSON.stringify(value) !== JSON.stringify(old)))
        ) {
          mask |= 1 << (k - 1);
          values.push(value);
        }
      }
      if (mask) rows.push([i, mask, ...values]);
    });
    return { ...(sameOrder ? {} : { ids: next.map((row) => row[0]) }), rows };
  }
  function unpackParts(delta, previous) {
    const parts = delta.ids ? delta.ids.map((id) => ({ id })) : previous.slice();
    for (const [index, mask, ...values] of delta.rows) {
      const part = { ...parts[index] };
      let cursor = 0;
      partKeys.forEach((key, k) => {
        if (!(mask & (1 << k))) return;
        const value = values[cursor++];
        if (value === null) delete part[key];
        else part[key] = value;
      });
      parts[index] = part;
    }
    return parts;
  }
  // A moving formation usually changes only position and the merge countdown.
  // One mask per part keeps its established order. Births and reorders use
  // the self-describing JSON format so a new baseline is always complete.
  const fieldUnits = [100, 100, 0, 100, 1, 100, 100];
  function base64Bytes(data) {
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(data);
    const raw = atob(data), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function motionDelta(next, previous, ignoreBirth = false) {
    if (!previous || previous.length !== next.length) return;
    const bytes = Buffer.allocUnsafe(next.length * 40);
    let offset = 0, changed = false;
    for (let i = 0; i < next.length; i++) {
      const row = next[i], old = previous[i];
      if (row[0] !== old[0] || (!ignoreBirth && row[8] !== old[8] && JSON.stringify(row[8]) !== JSON.stringify(old[8]))) return;
      const maskAt = offset++;
      let mask = 0;
      for (let k = 0; k < fieldUnits.length; k++) {
        const value = row[k + 1], baseline = old[k + 1];
        if (value === baseline) continue;
        if (!Number.isFinite(value) || !Number.isFinite(baseline)) return;
        mask |= 1 << k;
        if (k === 2) {
          bytes.writeDoubleLE(value, offset);
          offset += 8;
          continue;
        }
        const units = fieldUnits[k], scaled = Math.round(value * units);
        const delta = scaled - Math.round(baseline * units);
        if (scaled / units !== value || Math.abs(delta) > 0x3fffffff) return;
        let bits = delta < 0 ? -2 * delta - 1 : 2 * delta;
        while (bits >= 128) {
          bytes[offset++] = (bits & 127) | 128;
          bits >>>= 7;
        }
        bytes[offset++] = bits;
      }
      bytes[maskAt] = mask;
      if (mask) changed = true;
    }
    return changed ? bytes.toString("base64", 0, offset) : "";
  }
  // Splits, absorption and expiry of birth metadata must not force every
  // surviving part back to a full JSON baseline. Indices refer only to this
  // receiver's preceding formation, never to a room-global history.
  function formationDelta(next, previous) {
    const moving = motionDelta(next, previous);
    if (moving !== undefined) return moving;
    const prior = new Map((previous || []).map((row, index) => [row[0], { row, index }]));
    const order = [], aligned = [], births = [];
    let reordered = !previous || previous.length !== next.length;
    for (let i = 0; i < next.length; i++) {
      const row = next[i], entry = prior.get(row[0]);
      if (!entry && typeof row[0] !== "string") return;
      order.push(entry ? entry.index : row[0]);
      aligned.push(entry ? entry.row : [row[0], 0, 0, 0, 0, 0, 0, 0]);
      reordered ||= !entry || entry.index !== i;
      const birth = row[8] ?? null, old = entry?.row[8] ?? null;
      if (birth !== old && JSON.stringify(birth) !== JSON.stringify(old)) births.push([i, birth]);
    }
    const data = motionDelta(next, aligned, true);
    if (data === undefined) return;
    return { ...(reordered ? { order } : {}), data, ...(births.length ? { births } : {}) };
  }
  function readFormation(delta, previous) {
    const aligned = delta.order ? delta.order.map(value => typeof value === "number" ? previous[value] : {
      id: value, x: 0, y: 0, mass: 0, radius: 0, mergeVersion: 0, mergeMs: 0, burnMs: 0,
    }) : previous;
    const parts = delta.data ? readMotion(delta.data, aligned) : aligned.slice();
    for (const [index, birth] of delta.births || []) {
      parts[index] = { ...parts[index] };
      if (birth === null) delete parts[index].birth;
      else parts[index].birth = birth;
    }
    return parts;
  }
  function readMotion(data, previous) {
    const bytes = base64Bytes(data);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    return previous.map((old) => {
      const mask = bytes[offset++];
      if (!mask) return old;
      const part = { ...old };
      for (let k = 0; k < fieldUnits.length; k++) {
        if (!(mask & (1 << k))) continue;
        const key = partKeys[k];
        if (k === 2) {
          part[key] = view.getFloat64(offset, true);
          offset += 8;
          continue;
        }
        let bits = 0, shift = 0, byte;
        do {
          byte = bytes[offset++];
          bits |= (byte & 127) << shift;
          shift += 7;
        } while (byte & 128);
        const delta = (bits >>> 1) ^ -(bits & 1);
        part[key] = (Math.round(old[key] * fieldUnits[k]) + delta) / fieldUnits[k];
      }
      return part;
    });
  }
  class Decoder {
    constructor() {
      this.players = new Map();
      this.food = new Map();
      this.projectiles = new Map();
      this.hazards = new Map();
      this.self = null;
    }
    entities(kind, delta) {
      const items = this[kind];
      for (const id of delta.removed) items.delete(id);
      for (const change of delta.upsert) {
        const value = { ...items.get(change.id), ...change };
        for (const key of value.unset || []) delete value[key];
        delete value.unset;
        items.set(change.id, value);
      }
      // Preserve snapshot/render order when shots are added before held swords.
      if (delta.ids) this[kind] = new Map(delta.ids.map((id) => [id, items.get(id)]));
      const ordered = [...this[kind].values()];
      if (delta.moves) {
        const bytes = base64Bytes(delta.moves);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < bytes.length; i += 18) {
          const index = view.getUint16(i, true), old = ordered[index];
          const moved = { ...old, x: view.getFloat64(i + 2, true), y: view.getFloat64(i + 10, true) };
          this[kind].set(old.id, moved);
          ordered[index] = moved;
        }
      }
      return ordered;
    }
    decode(packet) {
      if (packet.stateReset) {
        this.players.clear(); this.food.clear(); this.projectiles.clear(); this.hazards.clear();
        this.self = null;
      }
      if (!packet.playersDelta) return packet;
      const upsert = [];
      for (const id of packet.foodDelta?.removed || []) this.food.delete(id);
      for (const row of packet.foodDelta?.upsert || []) {
        const orb = { ...(row[3] || this.food.get(row[0])), id: row[0], x: row[1], y: row[2] };
        this.food.set(orb.id, orb);
        upsert.push(orb);
      }
      if (packet.foodDelta?.moves) {
        const moves = packet.foodDelta.moves;
        const bytes = base64Bytes(moves);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < bytes.length; i += 8) {
          const id = "e" + view.getUint32(i, true).toString(36);
          const orb = {
            ...this.food.get(id),
            id,
            x: view.getUint16(i + 4, true) / 10,
            y: view.getUint16(i + 6, true) / 10,
          };
          this.food.set(id, orb);
          upsert.push(orb);
        }
      }
      for (const id of packet.playersDelta.removed) this.players.delete(id);
      for (const change of packet.playersDelta.upsert) {
        const value = { ...this.players.get(change.id), ...change };
        for (const key of value.unset || []) delete value[key];
        delete value.unset;
        if (typeof change.parts === "string")
          value.parts = readMotion(change.parts, this.players.get(change.id).parts);
        else if (change.parts && typeof change.parts.data === "string")
          value.parts = readFormation(change.parts, this.players.get(change.id)?.parts || []);
        else if (change.parts && !Array.isArray(change.parts))
          value.parts = unpackParts(change.parts, this.players.get(change.id)?.parts || []);
        else if (change.parts)
          value.parts = change.parts.map((row) => ({
            id: row[0],
            x: row[1],
            y: row[2],
            mass: row[3],
            radius: row[4],
            mergeVersion: row[5],
            mergeMs: row[6],
            burnMs: row[7],
            ...(row[8] ? { birth: row[8] } : {}),
          }));
        this.players.set(change.id, value);
      }
      return {
        ...packet,
        players: this.withSelf(packet),
        ...(packet.projectilesDelta
          ? { projectiles: this.entities("projectiles", packet.projectilesDelta) }
          : {}),
        ...(packet.hazardsDelta ? { hazards: this.entities("hazards", packet.hazardsDelta) } : {}),
        ...(packet.foodDelta ? { etherDelta: { removed: packet.foodDelta.removed, upsert } } : {}),
        ...(packet.stateReset ? { ether: [...this.food.values()] } : {}),
      };
    }
  }
  // Overlay the owner's HUD without mutating the shared baseline or older
  // frames retained by interpolation. Opponents need only the public state.
  Decoder.prototype.withSelf = function (packet) {
    if (Object.hasOwn(packet, "selfDelta")) {
      const delta = packet.selfDelta;
      if (!delta) this.self = null;
      else {
        this.self = { ...(this.self?.id === delta.id ? this.self : {}), ...delta };
        for (const key of this.self.unset || []) delete this.self[key];
        delete this.self.unset;
      }
    }
    return [...this.players.values()].map(player =>
      player.id === this.self?.id ? { ...player, ...this.self } : player);
  };
  function mergeProfile(profile, patch) {
    if (!profile || !patch || profile.id !== patch.id || patch.revision < profile.revision)
      return profile;
    return {
      ...profile,
      ...patch,
      ...(patch.easter ? { easter: { ...profile.easter, ...patch.easter } } : {}),
      progress: { ...profile.progress, ...patch.progress },
    };
  }
  return { PROTOCOL, PRIVATE_STATE_PROTOCOL, HUD_PROTOCOL, MOTION_PROTOCOL, PRESENTATION_PROTOCOL, ENTITY_PROTOCOL, LEGACY_PROTOCOL, packPlayer, partDelta, motionDelta, formationDelta, Decoder, mergeProfile };
});
