"use strict";
const rules = require("../../../public/shared/arena-emotes");
// Weak room/player ownership bounds memory to live arena objects. No timers,
// persistence, deferred sends, extra snapshots or scans of other rooms.
class ArenaEmotes {
  constructor() { this.peers = new WeakMap(); this.accepted = new WeakMap(); }
  join(room, ws) {
    let peers = this.peers.get(room);
    if (!peers) this.peers.set(room, peers = new Set());
    peers.add(ws);
  }
  leave(room, ws) { this.peers.get(room)?.delete(ws); }
  send(room, player, input, at, send, premium = false) {
    if (!player?.profileId || player.dead || player.isRemnant ||
        (player.parts ? !player.parts.length : !(player.mass > 0)) || !rules.valid(input?.index) ||
        !Number.isSafeInteger(input.spawnSerial) || input.spawnSerial !== player.spawnSerial ||
        !Number.isFinite(at)) return false;
    const previous = this.accepted.get(player);
    if (previous !== undefined && at - previous < rules.COOLDOWN_MS) return false;
    this.accepted.set(player, at);
    const packet = JSON.stringify({ type: "emote", playerId: player.id,
      spawnSerial: player.spawnSerial, index: input.index, variant: premium === true ? "pets" : "basic" });
    for (const peer of this.peers.get(room) || []) {
      // Cosmetics never build a queue for a slow client.
      if (peer.readyState === 1 && peer.bufferedAmount <= 16384) send(peer, packet);
    }
    return true;
  }
}
module.exports = { ArenaEmotes };
