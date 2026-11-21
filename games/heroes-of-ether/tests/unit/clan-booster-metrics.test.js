"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {BOOSTERS}=require("../../src/server/boosters/booster-catalog");
const actions=require("../../src/server/clans/daily-quests/actions");
const engine=require("../../src/server/clans/daily-quests/engine");
const catalog=require("../../src/server/clans/daily-quests/catalog.json");
const at=Date.UTC(2026,10,21,14), playerId="player", clanId="clan";
test("every catalog booster produces only accepted clan metrics, including event items and potions",()=>{
 for(const booster of BOOSTERS.values()){
  const session={id:"life"},event={type:"arenaAction",lifeId:"life",sequence:1,metric:"boosterUses",boosterId:booster.id,source:"inventory"};
  const deltas=actions.deltas(session,event,playerId);
  assert.equal(deltas.boosterUses,1,booster.id);assert.equal(deltas.allBoosterUses,1,booster.id);
  assert.doesNotThrow(()=>engine.record(engine.createBoard(clanId,catalog,at,{[playerId]:0}),
    {playerId,clanId,at,sequence:1,deltas}),booster.id);
  assert.deepEqual(actions.deltas(session,event,playerId),{},"duplicate: "+booster.id);
  if(booster.tier === "potion")assert.deepEqual(deltas,{boosterUses:1,allBoosterUses:1});
  if(booster.tier === "event")assert.deepEqual(deltas,{boosterUses:1,allBoosterUses:1,rareUses:1});
 }
});
test("invalid metrics remain rejected rather than suppressing corrupt progress",()=>{
 assert.throws(()=>engine.record(engine.createBoard(clanId,catalog,at,{[playerId]:0}),
  {playerId,clanId,at,sequence:1,deltas:{eventUses:1}}),/Invalid progress delta/);
});
