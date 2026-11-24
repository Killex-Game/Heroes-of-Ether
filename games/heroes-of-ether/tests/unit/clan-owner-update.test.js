"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const quest=require('../../src/server/progression/clan-quest-achievements');
const engine=require('../../src/server/clans/daily-quests/engine');
const {Arena}=require('../../src/server/arena/arena-simulation');
const abilities=require('../../src/server/arena/accessory-abilities');
const passives=require('../../src/server/arena/accessory-passives');
const catalog=require('../../public/shared/accessory-catalog');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
const at=Date.parse('2026-11-24T04:00:00Z');
function profile(){const s=new ProfileStore({journal:false,now:()=>at});return structuredClone(s.find(s.open().token));}
function board(p,day='2026-11-24',own=[0,1,2,3,4]){
 const quests=['xp','kills','food','gifts','allBoosterUses'].map((metric,i)=>({id:'q'+i,metric,completedAt:at+1}));
 return {day,end:at+54000000,quests,contributors:{[p.id]:{firstAt:at,questIds:own.map(i=>'q'+i)}}};
}
test('personal objectives are not inferred from shared rewards; repeats and old days do not count twice',()=>{
 const p=profile(),b=board(p,undefined,[0]),before=p.greatness;
 quest.daily(p,b);
 assert.equal(p.activity.values.clan_quest_help,1);
 assert.equal(p.activity.values.clan_quest_five,0);
 assert.equal(p.activity.values.clan_quest_days,1);
 assert.deepEqual(p.clanQuestAchievements.types,['xp']);
 assert.equal(p.greatness-before,25);
 const saved=structuredClone(p);quest.daily(p,b);quest.daily(p,board(p,'2026-11-23'));
 assert.deepEqual(p,saved);
});
test('five goals, distinct days and distinct types are permanent and fixed rewards ignore paid status',()=>{
 const p=profile();p.account={vipUntil:at+1e10,premiumUntil:at+1e10};const before=p.greatness;
 for(const day of ['2026-11-24','2026-11-26','2026-11-29'])quest.daily(p,board(p,day));
 assert.equal(p.activity.values.clan_quest_help,15);assert.equal(p.activity.values.clan_quest_five,3);
 assert.equal(p.activity.values.clan_quest_days,3);assert.equal(p.activity.values.clan_quest_types,5);
 assert.equal(p.greatness-before,75+75+25+75);
});
test('legacy migration retains existing activity and only proven seasonal medals count',()=>{
 const p=profile();delete p.clanQuestAchievements;
 for(const d of quest.definitions){delete p.activity.values[d.id];delete p.activity.claimed[d.id];delete p.activity.stageSpent[d.id];}
 p.activity.values.sociable=1;p.clanQuestMedals=[{seasonId:'a'},{seasonId:'b'}];
 assert.equal(quest.migrate(p),true);assert.equal(p.activity.values.sociable,1);
 assert.equal(p.activity.values.clan_quest_seasons,2);assert.equal(p.activity.values.clan_quest_help,0);
 const before=p.greatness;quest.season(p,at);assert.equal(p.greatness-before,75);
 const saved=structuredClone(p);quest.season(p,at);assert.deepEqual(p,saved);
});
test('contribution proof records only goals actually advanced, remains immutable and deduplicates sequence',()=>{
 const p=profile(),b=board(p);b.clanId='c';b.start=at;b.eligible={[p.id]:0};b.cursors={};b.contributors={};
 b.quests=b.quests.map(q=>({...q,progress:0,target:10,completedAt:null}));
 const e={playerId:p.id,clanId:'c',at,sequence:1,deltas:{xp:5,kills:2}},next=engine.record(b,e);
 assert.deepEqual(next.board.contributors[p.id].questIds,['q0','q1']);assert.deepEqual(b.contributors,{});
 assert.equal(engine.record(next.board,e).accepted,false);
});
function arenaSetup(hat,bow,random=()=>.99){const a=new Arena({etherCount:0,random}),p=a.addPlayer(0,'owner-update');Object.assign(p,{level:100,protectedUntil:0,outfit:{hat,bow}});return {a,p};}
test('shop E stock is a sequential six-use life allocation with replay and same-item cooldown protection',()=>{
 const {a,p}=arenaSetup('viking_hat');const owner={outfit:p.outfit,purchasedAccessories:['viking_hat']};abilities.start(p,owner);
 assert.deepEqual(abilities.snapshot(p).map(s=>[s.boosterId,s.count]),[['fire_sword',3],['meat',3]]);
 const use=now=>{const m={accessoryId:'viking_hat',spawnSerial:p.spawnSerial,requestId:randomUUID(),aimX:p.x+300,aimY:p.y};return [abilities.use(a,p,m,now),m]};
 const [first,msg]=use(1000);assert.equal(first.boosterId,'fire_sword');
 assert.equal(abilities.use(a,p,msg,1100).replay,true);assert.throws(()=>use(1499),/Подожди/);
 use(1500);use(2000);const [meat]=use(2001);assert.equal(meat.boosterId,'meat');
 abilities.start(p,owner);assert.deepEqual(abilities.snapshot(p).map(s=>s.count),[0,2]);
 use(2101);use(2201);assert.throws(()=>use(2301),/использован/);
});
test('future event abilities are absent until their mechanics exist, ownership remains authoritative',()=>{
 for(const id of ['star_pilot','velvet_trick','forest_hood','silk_peony'])assert.equal(catalog.abilityList(catalog.item(id)).length,0);
 for(const item of catalog.items.filter(i=>i.previewOnly))assert.equal(catalog.isOwned({},item.id),false);
 assert.equal(catalog.isOwned({grantedAccessories:['star_pilot']},'star_pilot'),true);
});
test('30-second mass and minute mass use independent observed-time counters and ignore downtime',()=>{
 const {a,p}=arenaSetup('cowboy_hat','striped_bow');passives.start(a,p,0);const before=p.mass;
 for(let t=50;t<=60000;t+=50)passives.tick(a,p,t);
 assert.equal(p.mass-before,400);passives.tick(a,p,120000);assert.equal(p.mass-before,400);
});
test('critical cast doubles strength once, retaining duration, cooldown and projectile count',()=>{
 const {a,p}=arenaSetup(null,'amber_drop',()=>0),before=p.mass;
 a.prepareBooster(p.id,{boosterId:'meat',spawnSerial:p.spawnSerial},1000)();assert.equal(p.mass-before,1400);
 a.prepareBooster(p.id,{boosterId:'fire',spawnSerial:p.spawnSerial,aimX:p.x+300,aimY:p.y},1000)();
 const fire=a.combat.shots[0].effectBooster;assert.equal(fire.fireFraction,1);assert.equal(fire.cooldownMs,500);
 const w=passives.critical(p,BOOSTERS.get('warheads'),()=>0);assert.equal(w.fan,BOOSTERS.get('warheads').fan);
 assert.equal(w.durationMs,BOOSTERS.get('warheads').durationMs);
 assert.equal(passives.critical(p,BOOSTERS.get('meat'),()=>.1).amount,700);
});
test('fire and shield resistance use the exact ten-percent server boundary',()=>{
 for(const [bow,stat] of [['solar_ribbon','fireBlock'],['forge_spark','shieldResistance']]){
  const p={outfit:{bow}};assert(passives.chance(p,stat,()=>.099));assert(!passives.chance(p,stat,()=>.1));
 }
});
test('season discount expires after 30 days, best currently active trophy wins, history is unchanged',()=>{
 const rules=require('../../public/shared/clan-competition-rules'),day=86400000;
 const c={competition:{trophies:[{league:5,awardedAt:at-30*day},{league:1,awardedAt:at-1}]}},saved=structuredClone(c);
 assert.equal(rules.trophyBenefits(c,at).discount,4);assert.equal(rules.trophyBenefits(c,at-1).discount,15);
 assert.equal(rules.trophyBenefits(c,at+30*day).discount,0);assert.deepEqual(c,saved);
});

test('golden bow doubles only natural generator credit, cumulative delivery is idempotent across lives',()=>{
 const store=new ProfileStore({journal:false,now:()=>at}),u=store.open(),id=store.find(u.token).id;
 const {a,p}=arenaSetup(null,'gold_bow');p.profileId=id;
 store.applyArenaProgress(randomUUID(),[{profileId:id,type:'lifeStarted',lifeId:p.lifeId}],at);
 a.ether=[{id:'natural',x:p.x,y:p.y,value:5,radius:5},{id:'ejected',x:p.x,y:p.y,value:5,radius:5,ejected:true}];
 a.collectEther(5000);assert.equal(p.alchemyNatural,10);assert.equal(p.questFoodCount,1);assert.equal(p.clanFoodCount,2);
 const events=a.progressEvents.filter(e=>e.type==='alchemyGather').map(e=>({...e,profileId:id}));assert.equal(events.length,1);
 for(let i=0;i<2;i++)store.applyArenaProgress(randomUUID(),events,at+1);
 assert.equal(store.find(u.token).alchemy.natural,10);
 a.collectEther(5001);assert.equal(a.progressEvents.filter(e=>e.type==='alchemyGather').length,1);
 store.applyArenaProgress(randomUUID(),[{profileId:id,type:'lifeEnded',lifeId:p.lifeId,reason:'exit',durationSeconds:1}],at+1000);
 store.applyArenaProgress(randomUUID(),events.map(e=>({...e,natural:1000})),at+1001);
 assert.equal(store.find(u.token).alchemy.natural,10);
});
