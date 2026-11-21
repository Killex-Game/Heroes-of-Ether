"use strict";
// Snapshot cumulative food before the first tick across 06:00 and 21:00 MSK.
// A read may have already created the new board and advanced nextAt to 21:00;
// detect opening independently so the final unsampled night food stays out.
const { period } = require('../clans/daily-quests/engine');
function crossesOpening(previousAt, at) {
  const opening = period(at).start;
  return previousAt < opening && opening <= at;
}
function needsSample(profiles, player, previousAt, at, opening) {
  if (player.dead || player.isRemnant || !player.profileId) return null;
  const profile = profiles.byId(player.profileId);
  const clan = profiles.data.clans[profile?.clanId];
  if (opening && clan) return true;
  const board = clan?.dailyQuests?.board;
  return board && !board.settledAt && previousAt < board.end && board.end <= at ? board : null;
}
function pending(profiles, rooms, previousAt, at) {
  if (!profiles.data.clanQuests) return false;
  const opening = crossesOpening(previousAt, at);
  if (!opening && profiles.data.clanQuests.nextAt > at) return false;
  for (const room of rooms.values()) for (const p of room.arena.players.values())
    if (needsSample(profiles, p, previousAt, at, opening)) return true;
  return false;
}
function samples(profiles, rooms, previousAt, at) {
  if (!profiles.data.clanQuests) return [];
  const opening = crossesOpening(previousAt, at);
  if (!opening && profiles.data.clanQuests.nextAt > at) return [];
  const result = [];
  for (const room of rooms.values()) for (const p of room.arena.players.values())
    if (needsSample(profiles, p, previousAt, at, opening)) result.push({
      type: "clanFoodSample", profileId: p.profileId, lifeId: p.lifeId, clanFood: p.clanFoodCount,
    });
  return result;
}
module.exports = { pending, samples };
