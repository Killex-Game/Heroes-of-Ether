'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{temporary}=require('../temp');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{ClanService}=require('../../src/server/clans/clan-service');
const catalog=require('../../src/server/clans/daily-quests/catalog.json'),accrual=require('../../src/server/arena/mass-accrual');
const {recover}=require('../../src/server/profiles/profile-journal');
async function fixture(t,{worker=false,battle=false}={}) {
  const start=Date.parse(battle?'2027-01-15T04:00:00Z':'2026-11-24T04:00:00Z'),end=start+15*3600000;
  let at=start-86400000,cleanup;
  const file=path.join(temporary({after:fn=>cleanup=fn},'clan-exit'),'profiles.json'),stores=[];
  const open=()=>{const s=new ProfileStore({filePath:file,journal:true,clanDailyQuests:true,incrementalSettlement:true,now:()=>at});stores.push(s);return s;};
  const store=open(),api=new ClanService(store),users=[];
  t.after(async()=>{for(const s of stores)await s.close();cleanup();});
  const action=(u,action,fields={})=>api.mutate(u.token,{action,requestId:randomUUID(),...fields});
  for(let i=0;i<(battle?10:1);i++) {
    let clanId;
    for(let j=0;j<(battle?10:2);j++) {
      const u=store.open();store.transact(u.token,randomUUID(),'fixture',p=>{p.level=12;p.progress=require('../../src/server/progression/experience-progression').freshProgress(12);p.wallet.coins=10000;});
      users.push(u);
      if(!j){action(u,'create',{name:'Отряд '+i,prefix:'C'+i,emblem:'grove',privacy:'open'});clanId=store.find(u.token).clanId;}
      else action(u,'apply',{clanId});
    }
  }
  at=start;store.refreshCompetition();
  const id=store.find(users[0].token).clanId;
  if(!battle){const d=structuredClone(store.data);d.clans[id].dailyQuests.board.quests=['xp','kills','food','shieldUses','arenaMs'].map(metric=>({
    ...catalog.items.find(q=>q.metric===metric),target:1000000,progress:0,completedAt:null}));store.save(d);}
  if(worker==='direct')store.arenaPreparer=new(require('../../src/server/profiles/clan-arena-progress-shards').ClanArenaProgressShards)({count:3});
  else if(worker)store.arenaPreparer=new(require('../../src/server/profiles/arena-progress-preparer').ArenaProgressPreparer)({parallelism:3});
  const send=async(events,time=at,batch=randomUUID())=>{at=time;return store.applyArenaGroup([{id:batch,at,progress:events}]);};
  const event=(i,type,fields={})=>({profileId:users[i].profile.id,type,lifeId:'exit-life-'+i,...fields});
  const natural=(i,sequence=1)=>event(i,'massAccrual',{sequence,ruleVersion:2,xpUnits:10*accrual.XP_DENOMINATOR,baseXpUnits:10*accrual.XP_DENOMINATOR,killUnits:3*accrual.KILL_DENOMINATOR});
  const board=()=>store.data.clans[id].dailyQuests.board;
  return {store,users,id,file,start,end,send,event,natural,board,action,open,at:n=>{at=n;}};
}
for(const worker of [false,'direct'])test('Premium absorption credits two clan kills at exit; cap and duplicate packets add none, worker='+worker,async t=>{
  const f=await fixture(t,{worker}),u=f.users[0];
  f.store.transact(u.token,randomUUID(),'premium-fixture',p=>{p.account=require('../../src/server/accounts/account-benefits').fresh();p.account.premiumUntil=f.end;});
  await f.send([f.event(0,'lifeStarted')],f.start);
  const absorption=f.event(0,'absorbed',{victimProfileId:randomUUID(),gain:100});
  await f.send([absorption],f.start+1000,'premium-kill');await f.send([absorption],f.start+1000,'premium-kill');
  assert.equal(f.store.find(u.token).progress.kills,2);assert.equal(f.board().quests.find(q=>q.metric==='kills').progress,0);
  f.store.transact(u.token,randomUUID(),'cap-fixture',p=>{p.progress.arenaXpTarget=p.progress.xp+p.progress.session.xp;});
  await f.send([f.event(0,'absorbed',{victimProfileId:randomUUID(),gain:100})],f.start+2000);
  assert.equal(f.store.find(u.token).progress.kills,2);assert.equal(f.store.find(u.token).progress.absorptionKills,2);
  await f.send([f.event(0,'lifeEnded',{durationSeconds:3,reason:'left'})],f.start+3000,'premium-exit');
  await f.send([f.event(0,'lifeEnded',{durationSeconds:3,reason:'left'})],f.start+3000,'premium-exit-retry');
  assert.equal(f.board().quests.find(q=>q.metric==='kills').progress,2);
  assert.deepEqual(recover(f.file).data.clans,f.store.data.clans);
});
for (const worker of [false,'direct'])for (const [vip,premium] of [[false,false],[true,false],[false,true],[true,true]])
test('VIP XP / Premium kills: real account expiry, durable retry and deferred clan credit '+vip+'/'+premium+', worker='+worker,async t=>{
  const f=await fixture(t,{worker}),u=f.users[0];
  f.store.transact(u.token,randomUUID(),'fixture-status',p=>{
    p.account=require('../../src/server/accounts/account-benefits').fresh();
    p.account.vipUntil=vip?f.start+45000:0;p.account.premiumUntil=premium?f.start+45000:0;
  });
  await f.send([f.event(0,'lifeStarted')],f.start);
  const actor={id:u.profile.id,lifeId:'exit-life-0',mass:50000};accrual.reset(actor,f.start);
  const sample=(from,to)=>{
    let event;
    for(let at=from+50;at<=to;at+=50){
      f.at(at);actor.account=f.store.arenaAppearance(f.store.find(u.token)).account;
      event=accrual.sample(actor,at,false,2)||event;
    }
    return {...event,profileId:u.profile.id};
  };
  const first=sample(f.start,f.start+30000),xp=vip?100:50,kills=premium?14:7;
  const before=f.store.data,fault=t.mock.method(fs,'fsync',(fd,done)=>setImmediate(()=>done(Error('status fsync failure'))));
  await assert.rejects(f.send([first],f.start+30000,'status-first'),/status fsync failure/);
  fault.mock.restore();assert.equal(f.store.data,before);
  await f.send([first],f.start+30000,'status-first');await f.send([first],f.start+30000,'status-repeat');
  let p=f.store.find(u.token);assert.equal(p.progress.session.xp,xp);assert.equal(p.progress.kills,kills);
  assert.deepEqual(f.board().quests.slice(0,2).map(q=>q.progress),[0,0]);
  await f.send([sample(f.start+30000,f.start+60000)],f.start+60000);
  p=f.store.find(u.token);assert.equal(p.progress.session.xp,xp+50);assert.equal(p.progress.kills,kills+7);
  assert.deepEqual(f.store.arenaAppearance(p).account.vip,false);assert.deepEqual(f.store.arenaAppearance(p).account.premium,false);
  const end=f.event(0,'lifeEnded',{durationSeconds:60,reason:'left'});
  await f.send([end],f.start+60001,'status-end');await f.send([end],f.start+60001,'status-end-repeat');
  assert.deepEqual(f.board().quests.slice(0,2).map(q=>q.progress),[xp+50,kills+7]);
  assert.deepEqual(recover(f.file).data.profiles,f.store.data.profiles);assert.deepEqual(recover(f.file).data.clans,f.store.data.clans);
});
for(const worker of [false,true,'direct'])test('exit publishes bounded quest totals exactly once; personal XP remains live, worker='+worker,async t=>{
  const f=await fixture(t,{worker});
  await f.send([f.event(0,'lifeStarted')],f.start);
  await f.send([f.natural(0),f.event(0,'questSample',{food:7,rank:1}),
    f.event(0,'clanArenaAction',{sequence:1,metric:'petShield',boosterId:'golden_shield'})],f.start+30000);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[0,0,0,0,0]);
  assert.equal(f.store.find(f.users[0].token).progress.session.xp,10);
  assert.equal(Object.values(recover(f.file).data.profiles).find(p=>p.id===f.users[0].profile.id).clanArenaPending.quests.deltas.xp,10);
  const events=[f.event(0,'lifeEnded',{durationSeconds:30,food:8,reason:'left'})],base=f.store.data;
  const fault=t.mock.method(fs,'fsync',(fd,done)=>setImmediate(()=>done(Error('exit fsync failure'))));
  await assert.rejects(f.send(events,f.start+30050,'exit'),/exit fsync failure/);fault.mock.restore();assert.equal(f.store.data,base);
  await f.send(events,f.start+30050,'exit');
  assert.deepEqual(f.board().quests.map(q=>q.progress),[10,3,8,1,30050]);
  await f.send(events,f.start+30050,'exit-replay');assert.deepEqual(f.board().quests.map(q=>q.progress),[10,3,8,1,30050]);
  assert.equal(f.store.find(f.users[0].token).clanArenaPending,null);
  assert.deepEqual(recover(f.file).data.clans,f.store.data.clans);
  if(worker){assert.equal(f.store.arenaPreparer.stats.failures,0);assert(f.store.arenaPreparer.stats.jobs>0);if(worker!=='direct')assert.equal(f.store.arenaPreparer.stats.shards.failures,0);}
});
for(const worker of [false,'direct'])for(const offset of [-1,0,1])test('quest deadline is strict for the whole life, exit offset='+offset+', worker='+worker,async t=>{
  const f=await fixture(t,{worker});await f.send([f.event(0,'lifeStarted')],f.end-60000);
  await f.send([f.natural(0)],f.end-30000);
  await f.send([f.event(0,'lifeEnded',{durationSeconds:60,reason:'left'})],f.end+offset);
  const q=f.board().quests;assert.equal(q.find(q=>q.metric==='xp').progress,offset<0?10:0);assert.equal(q.find(q=>q.metric==='kills').progress,offset<0?3:0);
});
for(const late of [false,true])test('restart settles saved pending totals without offline time or duplicates; late='+late,async t=>{
  const f=await fixture(t);await f.send([f.event(0,'lifeStarted')],f.start);
  await f.send([f.natural(0),f.event(0,'questSample',{food:7,rank:1})],f.start+30000);
  const pending=Object.values(recover(f.file).data.profiles).find(p=>p.id===f.users[0].profile.id).clanArenaPending;
  assert.equal(pending.quests.deltas.xp,10);assert.equal(pending.quests.deltas.arenaMs,30000);
  await f.store.close();f.at(late?f.end+1:f.start+60000);const restarted=f.open();
  assert.deepEqual(restarted.data.clans[f.id].dailyQuests.board.quests.map(q=>q.progress),late?[0,0,0,0,0]:[10,3,7,0,30000]);
  restarted.save(restarted.data);await restarted.close();const again=f.open();
  assert.deepEqual(again.data.clans[f.id].dailyQuests.board,restarted.data.clans[f.id].dailyQuests.board);
});
for(const worker of [false,true,'direct'])test('battle credits natural kills only at exit, with matching serial and lane results, worker='+worker,async t=>{
  const f=await fixture(t,{battle:true,worker});
  assert(f.store.data.competition.day.rosters[f.id].includes(f.users[0].profile.id));
  await f.send([f.event(0,'lifeStarted')],f.start);
  await f.send([f.natural(0)],f.start+30000);
  assert.equal(f.store.data.competition.day.scores[f.id]?.kills||0,0);
  const end=f.event(0,'lifeEnded',{durationSeconds:30,reason:'left'});
  await f.send([end],f.start+30001);assert.equal(f.store.data.competition.day.scores[f.id].kills,3);
  await f.send([end],f.start+30001);assert.equal(f.store.data.competition.day.scores[f.id].kills,3);
  await f.send([f.event(0,'lifeStarted',{lifeId:'second'}),{...f.natural(0),lifeId:'second'},
    {...end,lifeId:'second'},f.event(0,'lifeStarted',{lifeId:'third'}),{...f.natural(0),lifeId:'third'},
    {...end,lifeId:'third'}],f.start+60000);
  assert.equal(f.store.data.competition.day.scores[f.id].kills,9,'two exits in one durable batch are both counted');
  assert.deepEqual(recover(f.file).data.competition,f.store.data.competition);
  if(worker){assert.equal(f.store.arenaPreparer.stats.failures,0);assert(f.store.arenaPreparer.stats.jobs>0);if(worker!=='direct')assert.equal(f.store.arenaPreparer.stats.shards.failures,0);}
});
test('arena gifts wait for exit, lobby gifts remain immediate, leaving the clan forfeits the pending contribution',async t=>{
  const f=await fixture(t),service=require('../../src/server/clans/daily-quests/service');
  const d=structuredClone(f.store.data);d.clans[f.id].dailyQuests.board.quests=[{
    ...catalog.items.find(q=>q.metric==='gifts'),progress:0,completedAt:null}];f.store.save(d);
  const gift=i=>{const d=structuredClone(f.store.data),p=Object.values(d.profiles).find(p=>p.id===f.users[i].profile.id);service.gift(d,p,f.start+1000);f.store.save(d);};
  gift(0);assert.equal(f.board().quests[0].progress,1);
  await f.send([f.event(0,'lifeStarted')],f.start);gift(0);assert.equal(f.board().quests[0].progress,1);
  await f.send([f.event(0,'lifeEnded',{reason:'left',durationSeconds:2})],f.start+2000);assert.equal(f.board().quests[0].progress,2);
  await f.send([f.event(1,'lifeStarted')],f.start+3000);gift(1);
  f.action(f.users[1],'leave',{clanId:f.id});
  await f.send([f.event(1,'lifeEnded',{reason:'left',durationSeconds:1})],f.start+4000);assert.equal(f.board().quests[0].progress,2);
});
for(const late of [false,true])test('battle pending credit survives restart only before the deadline, late='+late,async t=>{
  const f=await fixture(t,{battle:true});await f.send([f.event(0,'lifeStarted')],f.start);
  await f.send([f.natural(0)],f.start+30000);await f.store.close();f.at(late?f.end:f.start+60000);
  const restarted=f.open();
  assert.equal(restarted.data.competition.week.scores[f.id]?.kills||0,late?0:3);
  restarted.save(restarted.data);await restarted.close();const again=f.open();
  assert.equal(again.data.competition.week.scores[f.id]?.kills||0,late?0:3);
});
