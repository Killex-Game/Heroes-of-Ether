"use strict";
// Calculation replicas only. All actors from one clan stay in the same lane,
// so its five shared quest rows retain their original event order. Global
// settlement and durable publication remain with the authoritative store.
const {ArenaProgressShards,laneFor}=require('./arena-progress-shards');
const {profileKeys}=require('./profile-index');
const {copyRecord}=require('./copy-record');
const tableDeltas=require('./immutable-table-delta');
const {shareArenaData}=require('./arena-profile-copy');
const optionKeys=['petEvents','baseRouletteConfig','promotionConfig','unlockLeagueBackgrounds',
  'unlockLeagueFrames','unlockClanCrests','clanDailyQuests'];
const schedules=new WeakMap();
function progressSchedule(control){
  let schedule=schedules.get(control);
  if(!schedule){schedule={calendarVersion:control.calendarVersion,seasons:control.seasons||[]};schedules.set(control,schedule);}
  return schedule;
}
class ClanArenaProgressShards extends ArenaProgressShards {
  async prepare(store,batches){
    if(this.failed||this.closed)return undefined;
    if(!store.data.clanQuests)return undefined;
    if(this.pending)throw Error('Concurrent clan progress preparation');
    this.pending=true;
    const base=store.data,batch=batches[0],started=performance.now();
    const ctx={options:Object.fromEntries(optionKeys.map(k=>[k,store[k]])),
      events:store.events?.data,rankingReady:store.eventRankingReady?.()!==false};
    const settlementReady=store.clanQuestSettlementReady?.(batch.at)!==false;
    try{
      if(base.progressReceipt===batch.id)return {snapshot:base,changes:[[]]};
      const keys=profileKeys(base.profiles),order=new Set();
      const groups=Array.from({length:this.count},()=>({profiles:{},clans:{},clanQuests:progressSchedule(base.clanQuests),progress:[]}));
      for(const event of batch.progress){
        const key=keys.get(event.profileId);if(!key)continue;
        const p=base.profiles[key],clan=base.clans[p.clanId];
        const group=groups[laneFor(clan ? clan.id : p.id,this.count)];
        order.add(p.id);group.profiles[key]=p;group.progress.push(event);
        if(clan)group.clans[clan.id]={id:clan.id,xp:clan.xp,dailyQuests:clan.dailyQuests};
      }
      const jobs=groups.flatMap((group,index)=>group.progress.length ? [{index,
        promise:this.submit(index,{profiles:group.profiles,clans:group.clans,clanQuests:group.clanQuests},
          {id:batch.id,at:batch.at,progress:group.progress},ctx)}] : []);
      this.stats.jobs++;this.stats.transferMs+=performance.now()-started;
      const results=await Promise.all(jobs.map(async job=>({index:job.index,result:await job.promise})));
      this.stats.roundTripMs+=performance.now()-started;
      if(store.data!==base || store.events?.data!==ctx.events ||
        (store.eventRankingReady?.()!==false)!==ctx.rankingReady ||
        (store.clanQuestSettlementReady?.(batch.at)!==false)!==settlementReady ||
        optionKeys.some(k=>store[k]!==ctx.options[k])){
        this.stats.conflicts++;return null;
      }
      const mergeAt=performance.now(),assignedProfiles=new Set(),assignedClans=new Set(),changed=new Set();
      let profiles=base.profiles,clans=base.clans;
      for(const {index,result}of results){
        this.stats.computeMs+=result.computeMs;
        const patch=result.patch,group=groups[index];
        if(Object.keys(patch.set).length||patch.remove.length||result.clanXp.length||
          Object.keys(patch.tables||{}).some(k=>!['profiles','profileEdits','clans'].includes(k))||
          patch.tables.profiles?.remove?.length||patch.tables.clans?.remove?.length)
          throw Error('Invalid clan calculation scope');
        for(const key of [...Object.keys(patch.tables.profiles?.set||{}),...Object.keys(patch.tables.profileEdits||{})]){
          if(assignedProfiles.has(key)||!Object.hasOwn(group.profiles,key))throw Error('Overlapping calculated profiles');
          assignedProfiles.add(key);
          const p=result.predicted.profiles[key];
          if(!p||p.id!==base.profiles[key].id)throw Error('Changed profile identity');
          if(profiles===base.profiles)profiles=copyRecord(profiles);
          profiles[key]=p;
        }
        for(const [id,value]of Object.entries(patch.tables.clans?.set||{})){
          if(assignedClans.has(id)||!Object.hasOwn(group.clans,id))throw Error('Overlapping calculated clans');
          const before=base.clans[id];
          // arenaProgressDraft owns only XP and the daily quest board in a clan.
          if(!Number.isSafeInteger(value.xp)||value.xp<before.xp||value.id!==id||
            Object.keys(value).some(k=>!['id','xp','dailyQuests'].includes(k)))throw Error('Unexpected clan mutation');
          assignedClans.add(id);if(clans===base.clans)clans={...clans};
          clans[id]={...before,xp:value.xp,dailyQuests:shareArenaData(before.dailyQuests,value.dailyQuests)};
        }
        for(const id of result.ids){if(!order.has(id))throw Error('Unrequested profile result');changed.add(id);}
      }
      if(profiles===base.profiles && clans===base.clans)return {snapshot:base,changes:[[]]};
      if(profiles!==base.profiles){tableDeltas.remember(profiles,base.profiles,assignedProfiles,true);
        require('./profile-index').remember(profiles,keys);}
      if(clans!==base.clans)tableDeltas.remember(clans,base.clans,assignedClans,true);
      const snapshot=store.prepareSnapshot({...base,profiles,clans,progressReceipt:batch.id},batch.at,undefined,base);
      this.stats.transferMs+=performance.now()-mergeAt;
      return {snapshot,changes:[[...order].filter(id=>changed.has(id))]};
    }catch{
      this.fail('clan-calculation');return undefined;
    }finally{this.pending=false;}
  }
}
module.exports={ClanArenaProgressShards};
