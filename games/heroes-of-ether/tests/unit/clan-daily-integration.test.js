'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {ClanService}=require('../../src/server/clans/clan-service');
const service=require('../../src/server/clans/daily-quests/service'),engine=require('../../src/server/clans/daily-quests/engine');
const admin=require('../../src/server/clans/daily-quests/admin');
const {temporary}=require('../temp');
const start=Date.parse('2026-11-14T04:00:00Z'),end=start+15*3600000;
test('season reward uses the durable store barrier, survives restart, pays current contributors exactly once',async t=>{
  const f=fixture(t,true);f.task('xp',1);
  const next=structuredClone(f.store.data),board=next.clans[f.id].dailyQuests.board;
  board.quests[0].progress=1;board.quests[0].completedAt=start;board.contributors={[f.a.profile.id]:{firstAt:start}};
  f.store.save(next);f.at(end);f.store.refreshCompetition();
  const seasonEnd=Date.parse('2026-12-31T22:00:00Z');
  f.at(seasonEnd);f.store.clanQuestSettlementReady=()=>false;f.store.refreshCompetition();
  assert(!f.store.data.clanQuests.questSeason.settledAt);
  const before=structuredClone(f.store.data); // Calendar rewards already settled; isolate the season payment.
  f.store.clanQuestSettlementReady=()=>true;
  const pending=f.store.data,commit=f.store.journal.commit;
  f.store.journal.commit=()=>{throw Error('season fsync failure');};
  assert.throws(()=>f.store.refreshCompetition(),/season fsync failure/);assert.equal(f.store.data,pending);
  f.store.journal.commit=commit;f.store.refreshCompetition();
  for(const who of [f.a]){
    const p=f.store.find(who.token),old=Object.values(before.profiles).find(x=>x.id===p.id);
    assert.equal(p.wallet.coins-old.wallet.coins,3000);
    assert.equal(p.wallet.crystals-old.wallet.crystals,250);
    assert.equal(p.wallet.bucks-old.wallet.bucks,250);
    assert.equal(p.clanQuestMedals.length,1);
  }
  assert.deepEqual(f.store.find(f.b.token).wallet,Object.values(before.profiles).find(p=>p.id===f.b.profile.id).wallet);
  assert(!f.store.find(f.b.token).clanQuestMedals);
  const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  const again=service.capture(saved,saved,seasonEnd+1);
  assert.deepEqual(again.profiles,saved.profiles);
  assert.equal(Object.keys(saved.clanQuests.questSeasonHistory).length,1);
});
function fixture(t,journal=false,options={}){
  let now=start-86400000;
  let cleanup;
  const file=journal?path.join(temporary({after:fn=>cleanup=fn},'clan-daily'),'profiles.json'):null;
  const store=new ProfileStore({filePath:file,journal,clanDailyQuests:true,incrementalSettlement:true,now:()=>now,...options});
  if(journal)t.after(async()=>{await store.journal.close();cleanup();});
  const clanApi=new ClanService(store), a=store.open(),b=store.open(),late=store.open();
  const initial=structuredClone(store.data);
  for(const p of Object.values(initial.profiles)){p.level=12;p.progress.xp=require('../../src/server/progression/experience-progression').xpForLevel(12);p.wallet.coins=10000;p.wallet.crystals=1000;}
  store.save(initial,now);
  const act=(who,action,data={})=>clanApi.mutate(who.token,{action,requestId:randomUUID(),...data});
  act(a,'create',{name:'Север',prefix:'С',emblem:'grove',privacy:'open',description:''});
  const id=store.find(a.token).clanId;
  act(b,'apply',{clanId:id});
  // Open clans still use the usual acceptance operation where required.
  if(store.find(b.token).clanId!==id)act(a,'accept',{clanId:id,memberId:b.profile.id});
  now=start;store.refreshCompetition();
  const at=n=>{now=n;};
  const board=()=>store.data.clans[id].dailyQuests.board;
  const task=(metric,target,reward={kind:'crystals',amount:500})=>{
    const data=structuredClone(store.data),q=data.clans[id].dailyQuests.board;
    q.quests=[{...service.catalog.items.find(q=>q.metric===metric),target,reward,progress:0,completedAt:null}];store.save(data,now);
  };
  const progress=(who,event,time=now,batch=randomUUID())=>{now=time;return store.applyArenaProgress(batch,[{profileId:who.profile.id,...event}],time);};
  return {store,clanApi,a,b,late,id,at,act,board,task,progress,file,now:()=>now};
}

for(const worker of [false,true]) test('natural XP and credited kills reach clan together, respect cap, replay and WAL, worker='+worker,async t=>{
  const f=fixture(t,true,{arenaProgressWorker:worker});
  if(worker)t.after(()=>f.store.arenaPreparer.close());
  const data=structuredClone(f.store.data);
  data.clans[f.id].dailyQuests.board.quests=['xp','kills'].map(metric=>({
    ...service.catalog.items.find(q=>q.metric===metric),target:1000000,progress:0,completedAt:null}));
  f.store.save(data);
  const accrual=require('../../src/server/arena/mass-accrual');
  const actors=[f.a,f.b].map((who,i)=>({id:who.profile.id,profileId:who.profile.id,lifeId:'natural-'+i,
    mass:10000,account:{premium:!!i}}));
  for(const [i,a]of actors.entries()){
    f.progress([f.a,f.b][i],{type:'lifeStarted',lifeId:a.lifeId},start);accrual.reset(a,start);
  }
  const send=async(id,events,at)=>{f.at(at);return f.store.applyArenaGroup([{id,at,progress:events}]);};
  const sample=(from,to)=>{
    const events=[];
    for(let at=from+50;at<=to;at+=50)for(const a of actors){
      const event=accrual.sample(a,at,false,2);if(event)events.push({...event,profileId:a.profileId});
    }
    return events;
  };
  const events=sample(start,start+30000);
  const pending=f.store.data, fault=t.mock.method(fs,'fsync',(fd,done)=>setImmediate(()=>done(Error('natural clan flush failure'))));
  await assert.rejects(send('natural-1',events,start+30000),/natural clan flush failure/);fault.mock.restore();
  assert.equal(f.store.data,pending);
  await send('natural-1',events,start+30000);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[30,9]);
  await send('natural-1',events,start+30000);await send('natural-retry',events,start+30001);
  await send('natural-old',events.map(e=>({...e,lifeId:'old-life',sequence:100})),start+30002);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[30,9]);
  const capped=structuredClone(f.store.data);
  for(const p of Object.values(capped.profiles))if(p.progress.session)p.progress.arenaXpTarget=p.progress.xp+p.progress.session.xp+3;
  f.store.save(capped);
  await send('natural-2',sample(start+30000,start+60000),start+60000);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[36,18],'only the remaining three XP per member; final credited kills are retained');
  await send('natural-3',sample(start+60000,start+90000),start+90000);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[36,18],'display-only kills beyond the personal cap are not awarded');
  await send('natural-exit',actors.map(a=>({type:'lifeEnded',profileId:a.profileId,lifeId:a.lifeId,durationSeconds:90,reason:'left'})),start+90001);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[36,18],'life settlement must not count XP twice');
  const recovered=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.deepEqual(recovered.clans,f.store.data.clans);assert.deepEqual(recovered.profiles,f.store.data.profiles);
  if(worker)assert.equal(f.store.arenaPreparer.stats.failures,0);
});

test('actual pet shield timer reaches clan progress once at every pet level and survives WAL',t=>{
  const f=fixture(t,true);f.task('shieldUses',1000);
  const pets=require('../../src/server/pets/arena-pets'),rules=require('../../public/shared/pet-rules');
  const {Arena}=require('../../src/server/arena/arena-simulation');
  const {takePending}=require('../../src/server/arena/quest-actions');
  let expected=0;
  for(const id of ['zaya','leva','drakosha','manya'])for(const games of [0,...rules.thresholds]){
    const arena=new Arena({etherCount:0}),p=arena.addPlayer(0,'pet-owner');p.profileId=f.a.profile.id;
    const stats=rules.stats(id,games),profile={...f.store.find(f.a.token),level:100,
      pets:{equipped:id,owned:{[id]:{games,vitalityMs:stats.capacityMs,refillAt:start+86400000}}}};
    pets.start(p,profile,0,start);f.progress(f.a,{type:'lifeStarted',lifeId:p.lifeId},start);
    const when=p.pet.stats.intervalMs;
    pets.tick(arena,p,when-1);assert.equal(takePending(arena).length,0);
    pets.tick(arena,p,when);assert(arena.hasEffect(p,'shield',when));
    const events=takePending(arena).map(event=>({...event,profileId:p.profileId}));
    assert.equal(events.filter(e=>e.metric==='petShield').length,1);
    f.store.applyArenaProgress(randomUUID(),events,start+when);
    f.store.applyArenaProgress(randomUUID(),events,start+when+1);
    pets.tick(arena,p,when);assert.equal(takePending(arena).length,0);
    assert.equal(f.board().quests[0].progress,++expected,`${id}/${games}`);
    f.progress(f.a,{type:'lifeEnded',lifeId:p.lifeId,durationSeconds:when/1000},start+when+2);
  }
  const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.equal(saved.clans[f.id].dailyQuests.board.quests[0].progress,24);
});

test('real split-body absorption credits the same total mass to the clan as physics',t=>{
  const f=fixture(t);f.task('absorbedMass',100000);
  const {Arena}=require('../../src/server/arena/arena-simulation'),arena=new Arena({etherCount:0});
  const eater=arena.addPlayer(0,'eater'),victim=arena.addPlayer(0,'victim');
  eater.profileId=f.a.profile.id;victim.profileId=f.b.profile.id;
  for(const p of [eater,victim])Object.assign(p,{x:1000,y:1000,targetX:1100,targetY:1000,protectedUntil:0,level:25});
  arena.gainMass(eater,2000-eater.mass);arena.gainMass(victim,400-victim.mass);
  arena.handleInput(victim.id,{type:'split',sequence:1,spawnSerial:victim.spawnSerial},1000);
  assert(arena.bodies(victim).length>1);
  for(const part of arena.bodies(victim)){part.x=eater.x;part.y=eater.y;}
  f.progress(f.a,{type:'lifeStarted',lifeId:eater.lifeId},start);
  const beforeMass=eater.mass,events=arena.resolveAbsorptions(1100);
  assert(events.length>1);
  const expected=events.reduce((sum,event)=>sum+event.gain,0);
  assert.equal(eater.mass-beforeMass,expected);
  const progress=events.map(event=>({...event,profileId:f.a.profile.id,victimProfileId:f.b.profile.id}));
  f.store.applyArenaProgress('real-parts',progress,start+1100);
  assert.equal(f.board().quests[0].progress,expected);
  f.store.applyArenaProgress('duplicate-real-parts',progress,start+1101);
  assert.equal(f.board().quests[0].progress,expected);
});

test('clan mass credits every absorbed part once without changing kill cooldowns or personal records',t=>{
  const f=fixture(t,true);f.task('absorbedMass',100000);
  const data=structuredClone(f.store.data);
  data.clans[f.id].dailyQuests.board.quests.push({...service.catalog.items.find(q=>q.metric==='kills'),progress:0,completedAt:null});
  f.store.save(data);f.progress(f.a,{type:'lifeStarted',lifeId:'mass-collector'},start);
  const part=(sequence,gain,defeated=false)=>({type:'absorbed',eaterLifeId:'mass-collector',absorptionSequence:sequence,
    victimProfileId:f.b.profile.id,lifeId:'victim-life',victimPartId:'part-'+sequence,gain,victimDefeated:defeated});
  f.progress(f.a,part(1,100),start+1);
  f.progress(f.a,part(2,200,true),start+2);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[300,1]);
  f.progress(f.a,part(2,200,true),start+3);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[300,1],'duplicate part is not credited');
  f.progress(f.a,{...part(3,150,true),lifeId:'victim-next-life'},start+4);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[450,1],'actual mass counts, repeated kill retains cooldown');
  f.progress(f.a,{...part(4,600),eaterLifeId:'stale-life'},start+5);
  f.progress(f.a,{...part(4,600),victimProfileId:f.a.profile.id},start+6);
  f.progress(f.a,{...part(5,600),gain:NaN},start+7);
  assert.equal(f.board().quests[0].progress,450,'stale, own and malformed contributions are excluded');
  const player=f.store.find(f.a.token);
  assert.equal(player.progress.absorbedMass,100,'personal achievement rules are unchanged');
  assert.equal(player.progress.absorptionKills,1);
  const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.deepEqual(saved.clans[f.id].dailyQuests.board,f.board());
});

for (const metrics of [
  ['allBoosterUses','advancedUses','rareUses','shieldUses','boosterUses'],
  ['hazards','hazardHits','freezeHits','hookHits','splitParts'],
  ['poisonHits','food','arenaMs','top10Ms','top1Ms'],
]) test('burst contributions from two members survive worker, replay and WAL: '+metrics.join(','),async t=>{
  const f=fixture(t,true,{arenaProgressWorker:true});
  t.after(()=>f.store.arenaPreparer.close());
  const data=structuredClone(f.store.data);
  data.clans[f.id].dailyQuests.board.quests=metrics.map(metric=>({
    ...service.catalog.items.find(q=>q.metric===metric),target:10000000,progress:0,completedAt:null,
  }));
  f.store.save(data);
  const members=[f.a,f.b];
  for(const [i,who] of members.entries()) {
    f.progress(who,{type:'lifeStarted',lifeId:'burst-'+i},start);
    f.progress(who,{type:'questSample',lifeId:'burst-'+i,clanFood:0,food:0,rank:i+1},start+1);
  }
  const inputs=[];
  for(let n=1;n<=40;n++) for(const [i,who] of members.entries()) {
    const base={profileId:who.profile.id,lifeId:'burst-'+i,targetProfileId:members[1-i].profile.id};
    for(const [j,boosterId]of ['candy','donut','meat','golden_shield','clan_shield','pet_carrot'].entries())
      inputs.push({...base,type:'arenaAction',sequence:(n-1)*10+j+1,metric:'boosterUses',boosterId});
    for(const [j,metric]of ['hazards','hazardHits','freezeHits','hookHits'].entries())
      inputs.push({...base,type:'arenaAction',sequence:(n-1)*10+j+7,metric});
    inputs.push({...base,type:'clanArenaAction',sequence:(n-1)*2+1,metric:'splitParts',amount:3});
    inputs.push({...base,type:'clanArenaAction',sequence:n*2,metric:'clanPoisonHits'});
  }
  const batch={id:'burst-two-members',at:start+4001,progress:inputs};
  f.at(batch.at);
  await f.store.applyArenaGroup([batch]);
  const first=f.store.data;
  assert.deepEqual(await f.store.applyArenaGroup([batch]),[[]]);
  assert.equal(f.store.data,first,'same batch does not publish twice');
  const tail={id:'burst-tail',at:start+4251,progress:members.map((who,i)=>({
    type:'lifeEnded',profileId:who.profile.id,lifeId:'burst-'+i,clanFood:57+i,food:40,
    durationSeconds:4,reason:i?'left':'absorbed',
  }))};
  f.at(tail.at);await f.store.applyArenaGroup([tail]);
  const expected={allBoosterUses:480,advancedUses:80,rareUses:240,shieldUses:160,boosterUses:400,
    hazards:80,hazardHits:80,freezeHits:80,hookHits:80,splitParts:240,poisonHits:80,
    food:115,arenaMs:8502,top10Ms:8500,top1Ms:4250};
  assert.deepEqual(f.board().quests.map(q=>[q.metric,q.progress]),metrics.map(m=>[m,expected[m]]));
  assert.equal(Object.keys(f.board().contributors).length,2);
  const recovered=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.deepEqual(recovered.clans[f.id].dailyQuests.board,f.board());
  assert.equal(f.store.arenaPreparer.stats.failures,0);
});
test('XP target upgrade preserves contributions and completes an already reached lower target once',t=>{
  const f=fixture(t,true),data=structuredClone(f.store.data),b=data.clans[f.id].dailyQuests.board;
  assert.deepEqual(service.catalog.items.filter(q=>q.metric==='xp').map(q=>q.target),[1000000,1500000,3000000]);
  data.clanQuests.catalogVersion=4;b.catalogVersion=4;
  const q=service.catalog.items.find(q=>q.id==='cq_01');
  b.quests=[{...q,target:5000000,progress:1200000,completedAt:null}];
  b.contributors={[f.a.profile.id]:{firstAt:start,questIds:[q.id]}};b.cursors={[f.a.profile.id]:12};
  const history=structuredClone(data.clanQuestRewards);
  f.store.data=data;f.at(start+1000);f.store.refreshCompetition();
  assert.equal(f.board().quests[0].target,1000000);assert.equal(f.board().quests[0].progress,1000000);
  assert.equal(f.board().quests[0].completedAt,start+1000);
  assert.deepEqual(f.board().contributors,b.contributors);assert.deepEqual(f.board().cursors,b.cursors);
  const upgraded=structuredClone(f.board());f.at(start+2000);f.store.refreshCompetition();
  assert.deepEqual(f.board(),upgraded);assert.deepEqual(f.store.data.clanQuestRewards,history);
  assert.deepEqual(require('../../src/server/profiles/profile-journal').recover(f.file).data.clans,f.store.data.clans);
});

test('approved catalog: exact values, rejected rows absent, feasible time bounds and one XP',()=>{
  assert.equal(service.catalog.items.length,57);assert(!service.catalog.items.some(q=>['cq_16','cq_17','cq_18'].includes(q.id)));
  assert.equal(service.catalog.items.find(q=>q.id==='cq_54').target,20000*60000);
  for(let n=1;n<=50;n++)for(let day=0;day<28;day++){
    const qs=engine.dailySelection(service.catalog,start+day*86400000,'c'+n,n);
    assert.equal(qs.length,5);assert.equal(qs[0].metric,'xp');assert.equal(qs.filter(q=>q.metric==='xp').length,1);
    assert.equal(qs[1].metric,'kills');assert.equal(qs.filter(q=>q.metric==='kills').length,1);
    assert(qs.slice(2).every(q=>q.metric!=='xp'&&q.metric!=='kills'));
    assert(qs.every(q=>!q.metric.endsWith('Ms')||q.target<=n*15*3600000));
  }
});
test('store initializes quests, gives no automatic battles, gift is replay safe and prizes wait until 22:00',t=>{
  const f=fixture(t);f.task('gifts',1);
  assert.equal(f.clanApi.state(f.a.token).competition.mode,'quests');
  const gift=require('../../src/server/profiles/gift-catalog').gifts.find(g=>g.currency==='coins');
  const input={action:'gift',confirmed:true,requestId:randomUUID(),targetId:f.b.profile.id,giftId:gift.id};
  f.store.socialAction(f.a.token,input);f.store.socialAction(f.a.token,input);
  assert.equal(f.board().quests[0].progress,1);assert.equal(Object.keys(f.board().contributors).length,1);
  const before=f.store.find(f.a.token).wallet.crystals;
  f.at(end-1);f.store.refreshCompetition();assert.equal(f.store.find(f.a.token).wallet.crystals,before);
  f.at(end);f.store.refreshCompetition();assert.equal(f.store.find(f.a.token).wallet.crystals,before+500);
  const receipt=f.board().rewardReceipt;f.store.refreshCompetition();assert.equal(f.board().rewardReceipt,receipt);assert.equal(f.store.find(f.a.token).wallet.crystals,before+500);
});
test('newcomer after 07:00 cannot contribute; leaving forfeits eligibility even after rejoining',t=>{
  const f=fixture(t);f.task('xp',100);
  f.act(f.late,'apply',{clanId:f.id});if(f.store.find(f.late.token).clanId!==f.id)f.act(f.a,'accept',{clanId:f.id,memberId:f.late.profile.id});
  assert(!Object.hasOwn(f.board().eligible,f.late.profile.id));
  assert.equal(f.clanApi.state(f.late.token).mine.members.find(p=>p.id===f.late.profile.id).role,'recruit');
  assert.throws(()=>f.act(f.a,'role',{clanId:f.id,memberId:f.late.profile.id,role:'officer'}),/Новобранец/);
  const q=engine.record(f.board(),{playerId:f.b.profile.id,clanId:f.id,at:start,sequence:1,deltas:{xp:100}}).board;
  let data=structuredClone(f.store.data);data.clans[f.id].dailyQuests.board=q;f.store.save(data);
  f.at(start+1000);f.act(f.b,'leave',{clanId:f.id});assert(!Object.hasOwn(f.board().eligible,f.b.profile.id));
  f.act(f.b,'apply',{clanId:f.id});if(f.store.find(f.b.token).clanId!==f.id)f.act(f.a,'accept',{clanId:f.id,memberId:f.b.profile.id});
  const before=f.store.find(f.b.token).wallet.crystals;f.at(end);f.store.refreshCompetition();assert.equal(f.store.find(f.b.token).wallet.crystals,before);
});

test('daily newcomers including overnight joins wait until 07:00; old missing status is repaired without deleting assigned roles',t=>{
  const f=fixture(t,true);f.at(start+1000);
  f.act(f.late,'apply',{clanId:f.id});if(f.store.find(f.late.token).clanId!==f.id)f.act(f.a,'accept',{clanId:f.id,memberId:f.late.profile.id});
  const data=structuredClone(f.store.data),clan=data.clans[f.id];
  delete data.clanQuests.recruitRulesVersion;delete clan.competition.recruits[f.late.profile.id];
  clan.roles[f.late.profile.id]='officer';
  // Emulate a snapshot written by the previous release, not a new role operation.
  f.store.data=data;
  const wallet=structuredClone(f.store.find(f.late.token).wallet),save=f.store.journal.commit;
  f.store.journal.commit=()=>{throw Error('recruit repair fsync');};
  assert.throws(()=>f.store.refreshCompetition(),/fsync/);assert.equal(f.store.data,data);
  f.store.journal.commit=save;f.store.refreshCompetition();
  const role=()=>f.clanApi.state(f.late.token).mine.members.find(p=>p.id===f.late.profile.id).role;
  assert.equal(role(),'recruit');assert.equal(f.store.data.clans[f.id].roles[f.late.profile.id],'officer');
  assert.equal(f.store.data.clans[f.id].competition.recruits[f.late.profile.id],start+86400000);
  assert.deepEqual(f.store.find(f.late.token).wallet,wallet);
  f.at(end);f.store.refreshCompetition();assert.equal(role(),'recruit','22:00 is not the next roster');
  f.at(start+86400000);f.store.refreshCompetition();assert.equal(role(),'officer');assert(Object.hasOwn(f.board().eligible,f.late.profile.id));
  f.act(f.late,'leave',{clanId:f.id});
  f.at(start+86400000+17*3600000);f.act(f.late,'apply',{clanId:f.id});
  if(f.store.find(f.late.token).clanId!==f.id)f.act(f.a,'accept',{clanId:f.id,memberId:f.late.profile.id});
  assert.equal(role(),'recruit');
  f.at(start+2*86400000);f.store.refreshCompetition();assert.equal(role(),'member');assert(Object.hasOwn(f.board().eligible,f.late.profile.id));
});
test('subminute arena time survives lives, duplicate samples and batches do not count twice',t=>{
  const f=fixture(t);f.task('arenaMs',120000);
  for(let i=0;i<2;i++){
    const life='life-'+i,at=start+i*20000;
    f.progress(f.a,{type:'lifeStarted',lifeId:life},at);
    const sample={type:'questSample',lifeId:life,food:0,rank:1};
    f.progress(f.a,sample,at+550);f.progress(f.a,sample,at+550);
    f.progress(f.a,{type:'lifeEnded',lifeId:life,durationSeconds:10,reason:'left'},at+10250);
  }
  assert.equal(f.board().quests[0].progress,20500);
});
test('all completed rewards go to each contributor to any row, offline, once after WAL recovery',async t=>{
  const f=fixture(t,true);f.task('gifts',1);
  const data=structuredClone(f.store.data),b=data.clans[f.id].dailyQuests.board;
  b.quests.push({...service.catalog.items.find(q=>q.metric==='xp'),target:10,progress:1,completedAt:null});
  b.quests[0].progress=1;b.quests[0].completedAt=start+1000;
  b.contributors={[f.a.profile.id]:{firstAt:start},[f.b.profile.id]:{firstAt:start+2}};
  f.store.save(data);const before=[f.a,f.b].map(w=>f.store.find(w.token).wallet.crystals);
  f.at(end);f.store.refreshCompetition();
  assert.deepEqual([f.a,f.b].map(w=>f.store.find(w.token).wallet.crystals),before.map(n=>n+500));
  const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.equal(saved.clanQuestRewards[saved.clans[f.id].dailyQuests.board.rewardReceipt].members.length,2);
  const again=service.capture(saved,saved,end+1000);assert.equal(again.profiles,saved.profiles);
  const ledger=f.store.data.clanQuestRewards;
  f.at(start+86400000);f.store.refreshCompetition();assert.equal(f.store.data.clanQuestRewards,ledger,'new day preserves reward ledger without copying it into each clan');
  const gift=require('../../src/server/profiles/gift-catalog').gifts.find(g=>g.currency==='coins');
  f.store.socialAction(f.a.token,{action:'gift',confirmed:true,requestId:randomUUID(),targetId:f.b.profile.id,giftId:gift.id});
  assert.equal(f.store.data.clanQuestRewards,ledger,'contribution does not rewrite reward history');
});
test('failed durable write leaves wallet and reward receipt unchanged; retry settles once',t=>{
  const f=fixture(t,true);f.task('xp',1);
  const data=structuredClone(f.store.data),b=data.clans[f.id].dailyQuests.board;
  b.quests[0].progress=1;b.quests[0].completedAt=start;b.contributors={[f.a.profile.id]:{firstAt:start}};f.store.save(data);
  const previous=f.store.data,commit=f.store.journal.commit;
  f.store.journal.commit=()=>{throw Error('simulated fsync failure');};f.at(end);
  assert.throws(()=>f.store.refreshCompetition(),/fsync/);assert.equal(f.store.data,previous);
  assert(!f.board().settledAt);f.store.journal.commit=commit;f.store.refreshCompetition();assert.equal(f.store.data.clanQuestRewards[f.board().rewardReceipt].members.length,1);
});

test('22:00 read waits for queued pre-deadline progress before paying or replacing the board',t=>{
  const f=fixture(t);f.task('xp',1);const before=f.store.find(f.a.token).wallet.crystals;
  f.store.clanQuestSettlementReady=()=>false;f.at(end);f.clanApi.state(f.a.token);
  assert(!f.board().settledAt);assert(f.store.data.clanQuests.nextAt<=end);
  f.progress(f.a,{type:'lifeStarted',lifeId:'deadline-life'},end-500);
  f.progress(f.a,{type:'absorbed',victimProfileId:f.b.profile.id,victimDefeated:true,lifeId:'victim-life',gain:1000},end-1);
  assert.equal(f.board().quests[0].progress,1);f.at(end);f.clanApi.state(f.a.token);assert.equal(f.store.find(f.a.token).wallet.crystals,before);
  f.store.clanQuestSettlementReady=()=>true;f.store.refreshCompetition();assert.equal(f.store.find(f.a.token).wallet.crystals,before+500);assert(f.board().settledAt);
});
test('automatic seasons alternate and reject manual overrides; unmatched clans earn no cups',t=>{
  const f=fixture(t),access={isOwner:a=>a.id===f.a.profile.id},actor={id:f.a.profile.id};
  assert.throws(()=>admin.apply(f.store,access,{id:'stranger'},{}),/владелец/);
  assert.throws(()=>admin.apply(f.store,access,actor,{}),e=>e.status===409);
  assert.equal(f.clanApi.state(f.a.token).competition.mode,'quests');
  f.at(Date.parse('2027-01-01T05:00:00Z'));f.store.refreshCompetition();
  assert.equal(f.clanApi.state(f.a.token).competition.mode,'battle');
  f.at(Date.parse('2027-03-01T05:00:00Z'));f.store.refreshCompetition();
  assert.equal(f.clanApi.state(f.a.token).competition.mode,'quests');
  assert.equal(f.store.data.clans[f.id].competition.trophies.length,0);
});

test('revised clan actions have independent cursors, include pets, retain paid-only inventory tasks and every freeze hit',t=>{
  const f=fixture(t);const data=structuredClone(f.store.data);
  const metrics=['allBoosterUses','boosterUses','rareUses','shieldUses','freezeHits'];
  data.clans[f.id].dailyQuests.board.quests=metrics.map(metric=>({...service.catalog.items.find(q=>q.metric===metric),progress:0,completedAt:null}));
  f.store.save(data);f.progress(f.a,{type:'lifeStarted',lifeId:'actions'},start+1);
  const actions=[
    {type:'arenaAction',sequence:1,metric:'boosterUses',boosterId:'pet_carrot'},
    {type:'clanArenaAction',sequence:1,metric:'petShield',boosterId:'golden_shield'},
    {type:'arenaAction',sequence:2,metric:'boosterUses',boosterId:'clan_shield'},
    {type:'arenaAction',sequence:3,metric:'boosterUses',boosterId:'candy'},
    {type:'arenaAction',sequence:4,metric:'boosterUses',boosterId:'candy',source:'accessory'},
    {type:'arenaAction',sequence:5,metric:'freezeHits',targetProfileId:f.b.profile.id},
    {type:'arenaAction',sequence:6,metric:'freezeHits',targetProfileId:f.b.profile.id},
  ];
  for(const [i,event]of actions.entries()){
    const input={...event,lifeId:'actions'};f.progress(f.a,input,start+100+i);f.progress(f.a,input,start+100+i);
  }
  assert.deepEqual(f.board().quests.map(q=>q.progress),[4,2,2,2,2]);
  f.progress(f.a,{type:'lifeEnded',lifeId:'actions',durationSeconds:1},start+1000);
  f.progress(f.a,{...actions[0],sequence:100,lifeId:'actions'},start+1100);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[4,2,2,2,2]);
});

test('clan food includes thrown particles and last partial-second pickup, personal food stays separate',t=>{
  const f=fixture(t);f.task('food',1000);
  f.progress(f.a,{type:'lifeStarted',lifeId:'food'},start);
  f.progress(f.a,{type:'questSample',lifeId:'food',food:1,clanFood:3,rank:1},start+500);
  f.progress(f.a,{type:'questSample',lifeId:'food',food:1,clanFood:3,rank:1},start+500);
  assert.equal(f.board().quests[0].progress,3);
  assert.equal(f.store.find(f.a.token).quests.session.food,1);
  f.progress(f.a,{type:'lifeEnded',lifeId:'food',food:2,clanFood:8,durationSeconds:0},start+950);
  assert.equal(f.board().quests[0].progress,8);
});

test('approved catalog revision keeps the selected rows and contribution, reduces only new targets and never rewrites a settled day',t=>{
  const f=fixture(t);const old=structuredClone(f.store.data),b=old.clans[f.id].dailyQuests.board;
  const spec=service.catalog.items.find(q=>q.id==='cq_31');
  b.catalogVersion=2;b.quests=[{...spec,target:500,progress:300,completedAt:null}];
  b.contributors={[f.a.profile.id]:{firstAt:start}};delete old.clanQuests.catalogVersion;
  f.store.data=old;f.at(start+1000);f.store.refreshCompetition();
  assert.deepEqual(f.board().quests.map(q=>q.id),['cq_31']);assert.equal(f.board().quests[0].target,250);
  assert.equal(f.board().quests[0].progress,250);assert.equal(f.board().quests[0].completedAt,start+1000);
  assert.deepEqual(f.board().contributors,b.contributors);assert.equal(b.quests[0].progress,300);
  const next=f.store.data;f.store.refreshCompetition();assert.equal(f.store.data,next);
  const archived=structuredClone(old);archived.clans[f.id].dailyQuests.board.settledAt=end;
  const result=service.capture(archived,archived,end);
  assert.deepEqual(result.clans[f.id].dailyQuests.board,archived.clans[f.id].dailyQuests.board);
});

test('failed write retains clan action cursor and counter; exact retry credits once',t=>{
  const f=fixture(t,true);f.task('allBoosterUses',100);
  f.progress(f.a,{type:'lifeStarted',lifeId:'durable'},start);
  const before=f.store.data,commit=f.store.journal.commit;
  const input={type:'arenaAction',lifeId:'durable',sequence:1,metric:'boosterUses',boosterId:'pet_fire'};
  f.store.journal.commit=()=>{throw Error('clan action fsync failure');};
  assert.throws(()=>f.progress(f.a,input,start+500),/fsync/);assert.equal(f.store.data,before);
  f.store.journal.commit=commit;f.progress(f.a,input,start+500);f.progress(f.a,input,start+500);
  assert.equal(f.board().quests[0].progress,1);
});

test('deadline sample credits only the pre-22:00 interval, not later food, XP or actions',t=>{
  const f=fixture(t);f.task('arenaMs',1000);
  const data=structuredClone(f.store.data),board=data.clans[f.id].dailyQuests.board;
  board.quests.push(...['food','xp','allBoosterUses'].map(metric=>({...service.catalog.items.find(q=>q.metric===metric),target:100,progress:0,completedAt:null})));
  f.store.save(data);f.progress(f.a,{type:'lifeStarted',lifeId:'closing'},end-1000);
  f.store.clanQuestSettlementReady=()=>false;
  f.progress(f.a,{type:'questSample',lifeId:'closing',food:0,clanFood:3,rank:1},end-500);
  f.progress(f.a,{type:'questSample',lifeId:'closing',food:0,clanFood:9,rank:1},end+100);
  f.progress(f.a,{type:'arenaAction',lifeId:'closing',sequence:1,metric:'boosterUses',boosterId:'candy'},end+101);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[1000,3,0,0]);
  f.progress(f.a,{type:'questSample',lifeId:'closing',food:0,clanFood:9,rank:1},end+200);
  assert.deepEqual(f.board().quests.map(q=>q.progress),[1000,3,0,0]);
  assert.equal(f.board().quests[0].completedAt,end-1);
  const wallet=f.store.find(f.a.token).wallet.crystals;
  f.store.clanQuestSettlementReady=()=>true;f.store.refreshCompetition();
  assert.equal(f.store.find(f.a.token).wallet.crystals,wallet+500);
});

test('a read at 22:00 waits for the final arena sample, including food since the last passive second',async t=>{
  const f=fixture(t);f.task('arenaMs',1000);
  const data=structuredClone(f.store.data),board=data.clans[f.id].dailyQuests.board;
  board.quests.push({...service.catalog.items.find(q=>q.metric==='food'),target:4,progress:0,completedAt:null,reward:{kind:'coins',amount:7}});f.store.save(data);
  f.at(end-1000);let simulation=1000;
  const {Arena}=require('../../src/server/arena/arena-simulation');
  const arena=new Arena({etherCount:0});
  const app=require('../../src/server/game-server').createGameServer({profiles:f.store,arena,autoTick:false,now:()=>simulation,wallNow:f.now,testBots:{enabled:false}});
  t.after(()=>app.close());
  const p=arena.addPlayer(simulation,'boundary-player');p.profileId=f.a.profile.id;
  f.progress(f.a,{type:'lifeStarted',lifeId:p.lifeId},f.now());app.tick();
  f.at(end-250);simulation=1750;p.clanFoodCount=4;app.tick();
  assert.equal(f.board().quests[1].progress,0,'not yet sampled by the ordinary one-second clock');
  f.at(end);f.clanApi.state(f.a.token);assert.ok(!f.board().settledAt,'read cannot freeze the unsampled tail');
  const wallet={...f.store.find(f.a.token).wallet};
  f.at(end+20);simulation=2020;app.tick();f.store.refreshCompetition();
  assert.deepEqual(f.board().quests.map(q=>q.progress),[1000,4]);
  assert.ok(f.board().settledAt);
  assert.equal(f.store.find(f.a.token).wallet.crystals,wallet.crystals+500);
  assert.equal(f.store.find(f.a.token).wallet.coins,wallet.coins+7);
  simulation=2100;p.clanFoodCount=9;f.at(end+100);app.tick();
  assert.deepEqual(f.board().quests.map(q=>q.progress),[1000,4]);
});

test('07:00 profile read cannot carry food from the final night tick into the new daily board',async t=>{
  const f=fixture(t),opening=start+86400000;
  f.at(opening-1000);f.store.refreshCompetition();let simulation=1000;
  const {Arena}=require('../../src/server/arena/arena-simulation'),arena=new Arena({etherCount:0});
  const app=require('../../src/server/game-server').createGameServer({profiles:f.store,arena,autoTick:false,
    now:()=>simulation,wallNow:f.now,testBots:{enabled:false}});
  t.after(()=>app.close());
  const p=arena.addPlayer(simulation,'opening-player');p.profileId=f.a.profile.id;
  f.progress(f.a,{type:'lifeStarted',lifeId:p.lifeId},f.now());app.tick();
  f.at(opening-250);simulation=1750;p.clanFoodCount=4;app.tick();
  f.at(opening);f.clanApi.state(f.a.token);f.task('food',100);
  simulation=2020;f.at(opening+20);app.tick();
  assert.equal(f.board().quests[0].progress,0,'No night food on the new board, even after an early profile read');
  p.clanFoodCount=7;simulation=3020;f.at(opening+1020);app.tick();
  assert.equal(f.board().quests[0].progress,3,'Only food actually added after opening is counted');
});

test('07:00 baseline survives asynchronous journal failure and retry without importing night food',async t=>{
  const f=fixture(t,true,{arenaProgressWorker:true}),opening=start+86400000;
  f.at(opening-1000);f.store.refreshCompetition();let simulation=1000;
  const {Arena}=require('../../src/server/arena/arena-simulation'),arena=new Arena({etherCount:0});
  const app=require('../../src/server/game-server').createGameServer({profiles:f.store,arena,autoTick:false,
    now:()=>simulation,wallNow:f.now,testBots:{enabled:false}});
  const wait=async condition=>{const until=Date.now()+10000;while(!condition()){
    assert(Date.now()<until,'asynchronous opening deadline');await new Promise(resolve=>setTimeout(resolve,5));}};
  const realFsync=fs.fsync;let held;
  const mock=t.mock.method(fs,'fsync',(fd,done)=>realFsync(fd,done));
  t.after(async()=>{mock.mock.restore();held?.(Error('test cleanup'));await app.close();});
  const p=arena.addPlayer(simulation,'durable-opening-player');p.profileId=f.a.profile.id;
  f.progress(f.a,{type:'lifeStarted',lifeId:p.lifeId},f.now());app.tick();
  await wait(()=>app.persistenceStatus().arenaBatches===0);
  f.at(opening-250);simulation=1750;p.clanFoodCount=4;app.tick();
  await wait(()=>app.persistenceStatus().arenaBatches===0);
  f.at(opening);f.clanApi.state(f.a.token);f.task('food',100);
  const previous=f.store.data;
  mock.mock.mockImplementationOnce((fd,done)=>{held=done;});
  simulation=2020;f.at(opening+20);app.tick();await wait(()=>!!held);
  const reject=held;held=null;reject(Error('simulated opening fsync failure'));
  await wait(()=>app.persistenceStatus().paused);
  assert.equal(f.store.data,previous,'unconfirmed baseline does not publish any draft');
  assert.equal(f.board().quests[0].progress,0);
  app.tick();await wait(()=>app.persistenceStatus().arenaBatches===0);
  assert.equal(f.board().quests[0].progress,0,'retry primes the same pre-opening counter');
  p.clanFoodCount=7;simulation=3020;f.at(opening+1020);app.tick();
  await wait(()=>app.persistenceStatus().arenaBatches===0);
  assert.equal(f.board().quests[0].progress,3);
  assert(f.store.arenaPreparer.stats.jobs>0);
  const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.equal(saved.clans[f.id].dailyQuests.board.quests[0].progress,3);
});

test('deadline waits for real progress worker and failed asynchronous fsync; recovery pays exactly once',async t=>{
  const f=fixture(t,true,{arenaProgressWorker:true});f.task('arenaMs',1000);
  const data=structuredClone(f.store.data);
  data.clans[f.id].dailyQuests.board.quests.push({...service.catalog.items.find(q=>q.metric==='food'),target:4,progress:0,completedAt:null,reward:{kind:'coins',amount:7}});
  f.store.save(data);f.at(end-1000);let simulation=1000;
  const {Arena}=require('../../src/server/arena/arena-simulation'),arena=new Arena({etherCount:0});
  const app=require('../../src/server/game-server').createGameServer({profiles:f.store,arena,autoTick:false,now:()=>simulation,wallNow:f.now,testBots:{enabled:false}});
  const wait=async condition=>{const until=Date.now()+10000;while(!condition()){assert(Date.now()<until,'asynchronous progress deadline');await new Promise(resolve=>setTimeout(resolve,5));}};
  const realFsync=fs.fsync;let held;
  const mock=t.mock.method(fs,'fsync',(fd,done)=>realFsync(fd,done));
  t.after(async()=>{mock.mock.restore();held?.(Error('test cleanup'));await app.close();});
  const p=arena.addPlayer(simulation,'durable-boundary-player');p.profileId=f.a.profile.id;
  f.progress(f.a,{type:'lifeStarted',lifeId:p.lifeId},f.now());app.tick();
  await wait(()=>app.persistenceStatus().arenaBatches===0);
  f.at(end-250);simulation=1750;p.clanFoodCount=4;app.tick();
  await wait(()=>app.persistenceStatus().arenaBatches===0);
  assert.equal(f.board().quests[1].progress,0);
  f.at(end);f.clanApi.state(f.a.token);assert(!f.board().settledAt);
  const wallet={...f.store.find(f.a.token).wallet},previous=f.store.data;
  const greatness=f.store.find(f.a.token).greatness;
  mock.mock.mockImplementationOnce((fd,done)=>{held=done;});
  f.at(end+20);simulation=2020;app.tick();await wait(()=>!!held);
  assert.equal(f.store.clanQuestSettlementReady(f.now()),false);
  assert(!f.board().settledAt,'unconfirmed final sample blocks payout');
  assert.deepEqual(f.store.find(f.a.token).wallet,wallet);
  assert.equal(f.store.find(f.a.token).greatness,greatness);
  const reject=held;held=null;reject(Error('simulated asynchronous fsync failure'));
  await wait(()=>app.persistenceStatus().paused);
  assert.equal(f.store.data,previous,'failed draft not published');
  f.clanApi.state(f.a.token);assert(!f.board().settledAt);
  app.tick();await wait(()=>app.persistenceStatus().arenaBatches===0);f.store.refreshCompetition();
  assert.deepEqual(f.board().quests.map(q=>q.progress),[1000,4]);
  assert(f.board().settledAt);assert(f.store.arenaPreparer.stats.jobs>0);assert.equal(f.store.arenaPreparer.stats.failures,0);
  assert.equal(f.store.find(f.a.token).wallet.crystals,wallet.crystals+500);
  assert.equal(f.store.find(f.a.token).wallet.coins,wallet.coins+7);
  assert.equal(f.store.find(f.a.token).greatness,greatness+10+25);
  const receipt=f.board().rewardReceipt;
  f.at(end+100);simulation=2100;p.clanFoodCount=40;app.tick();await wait(()=>app.persistenceStatus().arenaBatches===0);
  f.store.refreshCompetition();assert.equal(f.board().rewardReceipt,receipt);
  const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.deepEqual(saved.clans[f.id].dailyQuests.board.quests.map(q=>q.progress),[1000,4]);
  assert.equal(Object.values(saved.profiles).find(p=>p.id===f.a.profile.id).wallet.crystals,wallet.crystals+500);
  assert.equal(Object.values(saved.profiles).find(p=>p.id===f.a.profile.id).greatness,greatness+10+25);
  const captured=service.capture(saved,saved,end+200);assert.equal(captured.profiles,saved.profiles);
});

test('fixed greatness for ANY contributor, atomic with all prizes and exactly once after restart',t=>{
  const f=fixture(t,true),data=structuredClone(f.store.data),board=data.clans[f.id].dailyQuests.board;
  board.quests=['xp','kills','gifts','food','shieldUses'].map(metric=>({...service.catalog.items.find(q=>q.metric===metric),target:10,progress:10,completedAt:start+1000,reward:{kind:'crystals',amount:1}}));
  board.contributors={[f.a.profile.id]:{firstAt:start},[f.b.profile.id]:{firstAt:start+1}};
  f.store.save(data);
  const baseline=[f.a,f.b,f.late].map(w=>({greatness:f.store.find(w.token).greatness,crystals:f.store.find(w.token).wallet.crystals}));
  const previous=f.store.data,commit=f.store.journal.commit;
  f.at(end);f.store.journal.commit=()=>{throw Error('greatness fsync');};
  assert.throws(()=>f.store.refreshCompetition(),/greatness fsync/);assert.equal(f.store.data,previous);
  f.store.journal.commit=commit;f.store.refreshCompetition();
  for(const [i,w] of [f.a,f.b,f.late].entries()){
    assert.equal(f.store.find(w.token).greatness,baseline[i].greatness+(i<2?40:0));
    assert.equal(f.store.find(w.token).wallet.crystals,baseline[i].crystals+(i<2?5:0));
  }
  assert.deepEqual(f.store.data.clanQuestRewards[f.board().rewardReceipt].quests.map(q=>q.greatness),[15,10,5,5,5]);
  const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.deepEqual(saved.profiles,f.store.data.profiles);
  const again=service.capture(saved,saved,end+1000);assert.equal(again.profiles,saved.profiles);
});

test('greatness opens its earned title in the same settlement, incomplete quests pay nothing',t=>{
  const f=fixture(t,true);f.task('xp',1);
  const data=structuredClone(f.store.data),b=data.clans[f.id].dailyQuests.board;
  const p=Object.values(data.profiles).find(p=>p.id===f.a.profile.id);p.greatness=90;
  b.quests[0].progress=1;b.quests[0].completedAt=start;b.contributors={[p.id]:{firstAt:start}};
  b.quests.push({...service.catalog.items.find(q=>q.metric==='kills'),progress:1,completedAt:null});
  f.store.save(data);f.at(end);f.store.refreshCompetition();
  const after=f.store.find(f.a.token);assert.equal(after.greatness,105);assert.equal(after.honors.claimed,1);
  assert.equal(f.store.data.clanQuestRewards[f.board().rewardReceipt].quests.length,1);
  const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
  assert.deepEqual(Object.values(saved.profiles).find(p=>p.id===after.id).honors,after.honors);
});

test('legacy current board keeps selection and early progress; closing moves to 22:00, next board to 07:00',t=>{
  const f=fixture(t,true);f.task('gifts',1);
  f.at(start+1000);f.act(f.late,'apply',{clanId:f.id});if(f.store.find(f.late.token).clanId!==f.id)f.act(f.a,'accept',{clanId:f.id,memberId:f.late.profile.id});
  const data=structuredClone(f.store.data),b=data.clans[f.id].dailyQuests.board;
  delete data.clanQuests.windowVersion;data.clanQuests.nextAt=end-3600000;
  b.start=start-2*3600000;b.end=end-3600000;b.quests[0].progress=1;b.quests[0].completedAt=b.start+1000;
  b.contributors={[f.a.profile.id]:{firstAt:b.start+1000}};b.cursors={[f.a.profile.id]:1};
  data.clans[f.id].competition.recruits[f.late.profile.id]=start+86400000-2*3600000;
  f.store.data=data;const before=structuredClone(data),commit=f.store.journal.commit;
  f.store.journal.commit=()=>{throw Error('window fsync');};assert.throws(()=>f.store.refreshCompetition(),/window fsync/);assert.deepEqual(f.store.data,before);
  f.store.journal.commit=commit;f.store.refreshCompetition();
  assert.deepEqual(f.board(),{...b,end});assert.deepEqual(f.store.data.profiles,before.profiles);
  assert.equal(f.store.data.clanQuests.nextAt,end);assert.equal(f.store.data.clanQuests.windowVersion,engine.WINDOW_VERSION);
  assert.equal(f.store.data.clans[f.id].competition.recruits[f.late.profile.id],start+86400000);
  f.at(end-3600000);f.store.refreshCompetition();assert(!f.board().settledAt);
  const greatness=f.store.find(f.a.token).greatness;f.at(end);f.store.refreshCompetition();assert.equal(f.store.find(f.a.token).greatness,greatness+5);
  const today=f.board();f.at(start+86400000-1);f.store.refreshCompetition();assert.equal(f.board(),today);
  f.at(start+86400000);f.store.refreshCompetition();assert.equal(f.board().start,start+86400000);
  assert.equal(f.board().quests[0].metric,'xp');assert.equal(f.board().quests[1].metric,'kills');assert(f.board().quests.every(q=>q.progress===0));
});

test('read-only final board visible 22:00 to 00:00, then placeholder until 07:00',t=>{
  const f=fixture(t);f.task('xp',1);
  const view=at=>service.view(f.store.data,f.store.data.clans[f.id],at,'preview').dailyQuests;
  assert.equal(view(end-1).active,true);assert.equal(view(end-1).resultsVisible,false);
  f.store.clanQuestSettlementReady=()=>false;f.at(end);f.store.refreshCompetition();
  assert.equal(view(end).active,false);assert.equal(view(end).resultsVisible,true);assert.equal(view(end).settled,false);
  f.store.clanQuestSettlementReady=()=>true;f.store.refreshCompetition();
  assert.equal(view(end).settled,true);assert.equal(view(end+2*3600000-1).resultsVisible,true);
  assert.equal(view(end+2*3600000).resultsVisible,false);assert.equal(view(start+86400000-1).active,false);
  assert.equal(view(end).quests[0].greatness,15);
  f.at(start+86400000);f.store.refreshCompetition();assert.equal(view(start+86400000).active,true);
});

test('08 to 07 opening migration preserves the active board and moves newcomer deadline without payouts',async t=>{
 const f=fixture(t,true);f.at(start+3*3600000);f.task('xp',100);
 f.act(f.late,'apply',{clanId:f.id});if(f.store.find(f.late.token).clanId!==f.id)f.act(f.a,'accept',{clanId:f.id,memberId:f.late.profile.id});
 const old=structuredClone(f.store.data),c=old.clans[f.id],board=c.dailyQuests.board;
 old.clanQuests.windowVersion=3;board.start=start+3600000;board.quests[0].progress=7;
 board.contributors={[f.a.profile.id]:{firstAt:start+3600000+1000}};board.cursors={[f.a.profile.id]:1};
 c.competition.recruits[f.late.profile.id]=start+86400000+3600000;
 service.validate(old);f.store.data=old;
 const commit=f.store.journal.commit;f.store.journal.commit=()=>{throw Error('opening fsync failure')};
 assert.throws(()=>f.store.refreshCompetition(),/opening fsync/);assert.equal(f.store.data,old);
 f.store.journal.commit=commit;f.store.refreshCompetition();
 const actual=f.store.data,expected=board;
 assert.deepEqual(actual.clans[f.id].dailyQuests.board,expected);assert.equal(actual.clanQuests.windowVersion,5);
 assert.equal(actual.clans[f.id].competition.recruits[f.late.profile.id],start+86400000);
 assert.deepEqual(actual.profiles,old.profiles);assert.deepEqual(actual.clanQuestRewards,old.clanQuestRewards);
 const saved=require('../../src/server/profiles/profile-journal').recover(f.file).data;
 assert.equal(saved.clanQuests.windowVersion,5);assert.deepEqual(service.capture(saved,saved,f.now()),saved);
});
