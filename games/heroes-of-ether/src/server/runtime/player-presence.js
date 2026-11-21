/* Кратковременное присутствие в лобби; соединение с ареной учитывается отдельно. */
"use strict";
class PlayerPresence {
  constructor({ now = Date.now, ttl = 60000 } = {}) {
    this.now = now;
    this.ttl = ttl;
    this.seen = new Map();
  }
  touch(id) {
    const now = this.now();
    for (const [key, at] of this.seen) if (now - at >= this.ttl) this.seen.delete(key);
    this.seen.set(id, now);
  }
  isOnline(id) {
    const at = this.seen.get(id);
    return at !== undefined && this.now() - at < this.ttl;
  }
  counts(arenaIds, isHuman = () => true) {
    const arena = new Set([...arenaIds].filter(isHuman)), lobby = new Set(), at = this.now();
    for (const [id, seenAt] of this.seen) if (at - seenAt < this.ttl && !arena.has(id) && isHuman(id)) lobby.add(id);
    return { arena:arena.size, lobby:lobby.size, total:arena.size+lobby.size };
  }
}
module.exports = { PlayerPresence };
