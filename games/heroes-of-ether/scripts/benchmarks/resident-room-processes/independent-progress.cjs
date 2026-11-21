"use strict";
const { copyRecord } = require("../../../src/server/profiles/copy-record");
// Experimental calculation pool. Independent rooms calculate concurrently;
// all global settlements and durable publication still belong to ONE writer.
const { ArenaProgressShards } = require('../../../src/server/profiles/arena-progress-shards');
const { applyTransfer } = require('../../../src/server/profiles/profile-transfer');
const tableDeltas = require('../../../src/server/profiles/immutable-table-delta');
const { profileKeys } = require('../../../src/server/profiles/profile-index');
const optionKeys=['petEvents','baseRouletteConfig','promotionConfig','unlockLeagueBackgrounds',
  'unlockLeagueFrames','unlockClanCrests'];
// Daily totals are a derived, centrally settled projection. Arena calculations
// neither read nor write them. Preserve that projection while checking EVERY
// other field before adopting a speculative result. Economy/event changes still
// force the canonical recalculation.
function sameArenaInput(current, predicted) {
  if(current===predicted)return true;
  if(!current||!predicted)return false;
  const a=Object.keys(current).filter(k=>k!=='daily'),b=Object.keys(predicted).filter(k=>k!=='daily');
  return a.length===b.length && a.every(k=>Object.hasOwn(predicted,k)&&current[k]===predicted[k]);
}
class IndependentProgress {
  constructor(count=5,{maxBatchSize=32}={}){
    if(!Number.isInteger(maxBatchSize)||maxBatchSize<1||maxBatchSize>128)throw RangeError('Invalid room progress batch size');
    this.maxBatchSize=maxBatchSize;
    this.pool=new ArenaProgressShards({count});this.count=count;this.rooms=new Map();
    this.stats={jobs:0,batches:0,conflicts:0,recomputed:0,mergedDaily:0,conflictFields:{},failures:0,computeMs:0,transferMs:0,roundTripMs:0};
  }
  get failed(){return this.pool.failed;}
  async prepare(store,batches){
    if(this.failed||this.closed)return undefined;
    if(store.data.clanQuests||store.clanDailyQuests)return undefined;
    if(this.pending)throw Error('Concurrent room calculation');
    this.pending=true;
    const started=performance.now(),base=store.data,ctx={events:store.events?.data,
      options:Object.fromEntries(optionKeys.map(k=>[k,store[k]])),rankingReady:store.eventRankingReady?.()!==false};
    try{
      const keys=profileKeys(base.profiles);
      const owners=new Map(),selected=[],groups=new Map();
      for(const batch of batches){
        const room=batch.id.split(':')[1]||batch.id;
        if(!this.rooms.has(room))this.rooms.set(room,this.rooms.size%this.count);
        const lane=this.rooms.get(room),ids=new Set(batch.progress.map(e=>e.profileId));
        // Keep an exact FIFO prefix. Never overlap player ownership, and never
        // speculate across a known battle/season settlement boundary.
        if([...ids].some(id=>owners.has(id)&&owners.get(id)!==room)||
          (selected.length&&store.competitionDue(base,batch.at)))break;
        let group=groups.get(lane);
        if(!group)groups.set(lane,group={input:{profiles:{},clans:{}},batches:[]});
        const input=group.input, profileKeys=[];
        for(const id of ids){const key=keys.get(id);if(!key)continue;const p=base.profiles[key];
          profileKeys.push(key);
          input.profiles[key]=p;
          if(p.clanId&&base.clans[p.clanId])input.clans[p.clanId]={xp:base.clans[p.clanId].xp};}
        selected.push({batch,input,lane,profileKeys,step:group.batches.length});
        group.batches.push(batch);for(const id of ids)owners.set(id,room);
        if(selected.length===this.maxBatchSize)break;
      }
      // A bounded sequence per lane amortizes IPC without collapsing timestamps
      // or settlements. Each intermediate prediction is checked during FIFO merge.
      const results=new Map(await Promise.all([...groups].map(async([lane,group])=>
        [lane,await this.pool.submit(lane,group.input,group.batches,ctx)])));
      this.stats.jobs++;this.stats.batches+=selected.length;this.stats.roundTripMs+=performance.now()-started;
      if(store.events?.data!==ctx.events||(store.eventRankingReady?.()!==false)!==ctx.rankingReady||
        optionKeys.some(k=>store[k]!==ctx.options[k])){this.stats.conflicts++;return null;}
      const mergeAt=performance.now();let snapshot=store.data;const changes=[];
      for(let i=0;i<selected.length;i++){
        const {batch,input,lane,profileKeys,step}=selected[i],groupResult=results.get(lane),
          result=groupResult.steps[step];
        if(step===0)this.stats.computeMs+=groupResult.computeMs;
        if(snapshot.progressReceipt===batch.id){changes.push([]);continue;}
        // A purchase or earlier global reward can replace this player while
        // calculation runs. Recompute on that authoritative value, never merge
        // stale balances or erase another player's transaction.
        let next,ids;
        if(profileKeys.some(k=>!sameArenaInput(snapshot.profiles[k],result.before.profiles[k]))||
           Object.keys(input.clans).some(k=>!snapshot.clans[k])){
          this.stats.recomputed++;
          for(const key of profileKeys){const actual=snapshot.profiles[key],before=result.before.profiles[key];
            for(const field of new Set([...Object.keys(actual||{}),...Object.keys(before||{})]))
              if(field!=='daily'&&actual?.[field]!==before?.[field])this.stats.conflictFields[field]=(this.stats.conflictFields[field]||0)+1;}
          const draft=store.arenaProgressDraft(snapshot,batch.id,batch.progress,batch.at);
          next=draft?.next||snapshot;ids=draft?.ids||[];
        }else{
          const patch=result.patch;
          if(Object.keys(patch.set).length||patch.remove.length||
            Object.keys(patch.tables||{}).some(k=>!['profiles','profileEdits'].includes(k))||
            (patch.tables.profiles?.remove||[]).length||
            [...Object.keys(patch.tables.profiles?.set||{}),...Object.keys(patch.tables.profileEdits||{})]
              .some(k=>!Object.hasOwn(input.profiles,k)))throw Error('Invalid room calculation scope');
          ids=result.ids;next=snapshot;
          if(ids.length){
            const profiles=copyRecord(snapshot.profiles);
            for(const key of [...Object.keys(patch.tables.profiles?.set||{}),...Object.keys(patch.tables.profileEdits||{})]) {
              const predicted=result.predicted.profiles[key],before=result.before.profiles[key],current=snapshot.profiles[key];
              if(predicted.daily!==before.daily)throw Error('Arena calculation changed a central daily projection');
              profiles[key]=predicted;
              if(current.daily!==before.daily){
                profiles[key]={...predicted};
                if(Object.hasOwn(current,'daily'))profiles[key].daily=current.daily;else delete profiles[key].daily;
                this.stats.mergedDaily++;
              }
            }
            next={...snapshot,profiles,progressReceipt:batch.id};
            tableDeltas.remember(profiles,snapshot.profiles,profileKeys,true);
          }
          if(result.clanXp.length){
            next={...next,clans:{...snapshot.clans}};
            for(const [id,amount]of result.clanXp){
              const clan=snapshot.clans[id];
              if(!input.clans[id]||!clan||!Number.isSafeInteger(amount)||amount<0||
                !Number.isSafeInteger(clan.xp+amount))throw Error('Invalid room clan XP');
              next.clans[id]={...clan,xp:clan.xp+amount};
            }
          }
        }
        // Keep original event timestamps and settlement order, including
        // midnight, account expiry, rankings and cross-room clan rewards.
        snapshot=store.prepareSnapshot(next,batch.at,undefined,snapshot);
        changes.push(ids);
      }
      this.stats.transferMs+=performance.now()-mergeAt;
      return {snapshot,changes};
    }catch{this.pool.fail('independent-calculation');this.stats.failures++;return undefined;}
    finally{this.pending=false;}
  }
  async close(){this.closed=true;await this.pool.close();}
}
module.exports={IndependentProgress};
