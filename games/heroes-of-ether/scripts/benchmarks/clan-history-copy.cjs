'use strict';
// Reference uses a complete JSON-compatible copyArenaData clan draft in the
// same current transaction path, not the previous compiled server binary.
const fs=require('fs'),assert=require('assert/strict'),{performance}=require('perf_hooks'),{randomUUID}=require('crypto');
const root=require('path').resolve(__dirname,'../..');
const {ProfileStore}=require(root+'/src/server/profiles/profile-store'),{ClanService}=require(root+'/src/server/clans/clan-service'),drafts=require(root+'/src/server/clans/clan-draft'),{copyArenaData}=require(root+'/src/server/profiles/arena-profile-copy');
const at=Date.parse('2026-11-16T10:00:00Z'),options={now:()=>at,incrementalSettlement:true},seed=new ProfileStore(options),people=Array.from({length:12},()=>seed.open()),clans=new ClanService(seed);
for(const who of people)seed.transact(who.token,randomUUID(),'fixture',p=>{p.level=12;p.progress.xp=require(root+'/src/server/progression/experience-progression').xpForLevel(12);p.wallet={coins:10000,crystals:10000,bucks:10000};});
clans.mutate(people[0].token,{action:'create',requestId:randomUUID(),name:'Проверка',prefix:'ABC',emblem:'grove',privacy:'open'});
const id=seed.find(people[0].token).clanId;
for(const who of people.slice(1))clans.mutate(who.token,{action:'apply',clanId:id,requestId:randomUUID()});
const clan=seed.data.clans[id],person=seed.find(people[0].token);
while(clan.memberHistory.length<5000)require(root+'/src/server/clans/member-history').append(clan,'role',person,person,at,'member','officer');
const rival={id:'rival',name:'Соперник',prefix:'R'};
for(let i=0;i<500;i++)require(root+'/src/server/clans/battle-history').append(clan,rival,3,2,at-100000+i);
seed.save(seed.data);
const original=drafts.clanDraft,commands=Array.from({length:30},()=>({action:'deposit',clanId:id,amount:1,requestId:randomUUID()}));
function comparable(world){const value=structuredClone(world);for(const p of Object.values(value.profiles))for(const [i,entry]of p.transactions.entries.entries())entry.id='entry-'+i;return value;}
function run(optimized){drafts.clanDraft=optimized?original:copyArenaData;const store=new ProfileStore(options);store.save(structuredClone(seed.data));const old=store.data.clans[id],service=new ClanService(store),start=performance.now();for(const command of commands)service.mutate(people[0].token,command);const ms=performance.now()-start;return{ms,world:comparable(store.data),historiesShared:store.data.clans[id].memberHistory===old.memberHistory&&store.data.clans[id].battleHistory===old.battleHistory};}
try{const pairs=[];for(let i=0;i<3;i++){const first=run(i%2===1),second=run(i%2===0),before=i%2?second:first,after=i%2?first:second;assert.deepEqual(after.world,before.world);assert(after.historiesShared);pairs.push({beforeMs:before.ms,afterMs:after.ms,equal:true});}const report={kind:'in-memory clan deposits; no network/fsync or capacity claim',members:12,memberHistory:5000,battleHistory:500,operations:30,pairs};if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}finally{drafts.clanDraft=original;}
