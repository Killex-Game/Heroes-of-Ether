"use strict";
// Server-only, bounded receipt sequence per life. Nothing is added to room snapshots.
function enqueue(arena, event) {
  arena.progressEvents.push(event);
  // Inputs can arrive between simulation ticks. step() replaces progressEvents,
  // so retain only action references until the room/departure consumes them.
  (arena.pendingQuestActions ||= []).push(event);
}
function takePending(arena, playerId = null) {
  const pending = arena.pendingQuestActions;
  if (!pending?.length) return [];
  if (playerId === null) { arena.pendingQuestActions = []; return pending; }
  const taken = [], retained = [];
  for (const event of pending) (event.playerId === playerId ? taken : retained).push(event);
  arena.pendingQuestActions = retained;
  return taken;
}
function record(arena, player, metric, target = null, boosterId = null, amount = null, source = null) {
  if (!player || player.dead || player.isRemnant || !player.profileId) return;
  if (['splitParts','clanPoisonHits','petShield'].includes(metric)) {
    if(player.clanActionLife!==player.lifeId){player.clanActionLife=player.lifeId;player.clanActionSequence=0;}
    enqueue(arena, {type:'clanArenaAction',playerId:player.id,lifeId:player.lifeId,sequence:++player.clanActionSequence,metric,
      ...(target?{targetProfileId:target.profileId || target.departedProfileId}:{}),...(amount!==null?{amount}:{}),...(boosterId?{boosterId}:{})});
    return;
  }
  if (player.questActionLife !== player.lifeId) {
    player.questActionLife = player.lifeId;
    player.questActionSequence = 0;
  }
  enqueue(arena, {
    type: "arenaAction", playerId: player.id, lifeId: player.lifeId,
    sequence: ++player.questActionSequence, metric,
    ...(boosterId ? { boosterId } : {}),
    ...(source ? { source } : {}),
    ...(target ? { targetProfileId: target.profileId || target.departedProfileId } : {}),
    ...(amount !== null ? {amount} : {}),
  });
}
module.exports = { record, takePending };
