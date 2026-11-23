"use strict";
const { BOOSTERS, boosterRarity } = require('../../boosters/booster-catalog');
const pets = new Set(['pet_fire','pet_claw','pet_glove','pet_carrot']);
const hits = new Set(['hazards','hazardHits','freezeHits','hookHits']);
// Every event item counts as rare. Potions contribute only to total uses.
// Never synthesize metric names from an open-ended catalog.
const tierMetrics = new Map([['common','commonUses'],['advanced','advancedUses'],
  ['rare','rareUses'],['clan','clanUses']]);
// Clan objectives have their own life cursor. Personal quest rotation, completion
// and opponent limits cannot suppress otherwise valid clan actions.
function deltas(session,event,playerId) {
  if(event.type==='absorbed') {
    // Physics assigns a monotonic cursor to each eater life. Count all actual
    // parts independently of the personal record's repeated-victim cooldown.
    if(!session || event.eaterLifeId!==session.id || !Number.isSafeInteger(event.absorptionSequence) ||
      event.absorptionSequence<1 || event.absorptionSequence<=(session.absorptionSequence||0))return {};
    session.absorptionSequence=event.absorptionSequence;
    if(!event.victimProfileId || event.victimProfileId===playerId || !Number.isSafeInteger(event.gain) || event.gain<=0)return {};
    return {absorbedMass:event.gain};
  }
  if(!session || event.lifeId!==session.id || !Number.isSafeInteger(event.sequence) || event.sequence<1)return {};
  if(event.type==='arenaAction') {
    if(event.sequence<=(session.actionSequence||0))return {};
    session.actionSequence=event.sequence;
    if(hits.has(event.metric)) {
      if(event.metric!=='hazards' && (!event.targetProfileId || event.targetProfileId===playerId))return {};
      return {[event.metric]:1};
    }
    if(event.metric!=='boosterUses' || event.source==='accessory')return {};
    if(pets.has(event.boosterId))return {allBoosterUses:1,rareUses:1};
    const booster=BOOSTERS.get(event.boosterId);
    if(!booster)return {};
    const tierMetric = tierMetrics.get(boosterRarity(booster));
    return {boosterUses:1,allBoosterUses:1,...(tierMetric ? {[tierMetric]:1} : {}),
      ...(booster.kind==='shield'?{shieldUses:1}:{})};
  }
  if(event.type!=='clanArenaAction' || event.sequence<=(session.sequence||0))return {};
  session.sequence=event.sequence;
  if(event.metric==='petShield' && BOOSTERS.get(event.boosterId)?.kind==='shield')
    return {allBoosterUses:1,rareUses:1,shieldUses:1};
  if(!event.targetProfileId || event.targetProfileId===playerId)return {};
  if(event.metric==='splitParts' && Number.isSafeInteger(event.amount) && event.amount>=2 && event.amount<=64)
    return {splitParts:event.amount};
  return event.metric==='clanPoisonHits'?{poisonHits:1}:{};
}
module.exports={deltas};
