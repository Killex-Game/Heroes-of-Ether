"use strict";
// A notification batch is synchronous. Build its fallback index only when a
// changed profile has no socket-owned player; discard it after that batch.
function createBotLookup(rooms) {
  let index;
  return profileId => {
    if (!index) {
      index = new Map();
      for (const room of rooms.values())
        for (const player of room.arena.players.values())
          if (player.isTestBot && !index.has(player.profileId)) index.set(player.profileId, player);
    }
    return index.get(profileId);
  };
}
module.exports = { createBotLookup };
