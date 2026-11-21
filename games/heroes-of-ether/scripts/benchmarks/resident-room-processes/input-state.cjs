"use strict";
// Headless movement bots consume only these public/own fields. The optional
// full-browser decoder remains a separate, more expensive client workload.
const FIELDS = Object.freeze(['id', 'x', 'y', 'spawnSerial', 'dead', 'departure']);
function project(change, previous) {
  const next = { ...previous };
  for (const key of FIELDS) if (Object.hasOwn(change, key)) next[key] = change[key];
  for (const key of change.unset || []) delete next[key];
  return next;
}
class InputState {
  constructor() { this.players = new Map(); this.self = null; }
  decode(packet) {
    if (packet.stateReset) { this.players.clear(); this.self = null; }
    if (!packet.playersDelta) {
      if (Array.isArray(packet.players)) this.players = new Map(packet.players.map(p => [p.id, project(p)]));
      return this.players;
    }
    for (const id of packet.playersDelta.removed) this.players.delete(id);
    for (const change of packet.playersDelta.upsert)
      this.players.set(change.id, project(change, this.players.get(change.id)));
    if (Object.hasOwn(packet, 'selfDelta')) {
      const delta = packet.selfDelta;
      this.self = delta ? project(delta, this.self?.id === delta.id ? this.self : null) : null;
    }
    if (!this.self || !this.players.has(this.self.id)) return this.players;
    const result = new Map(this.players);
    result.set(this.self.id, { ...result.get(this.self.id), ...this.self });
    return result;
  }
}
module.exports = { InputState, FIELDS };
