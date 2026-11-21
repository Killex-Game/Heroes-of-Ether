'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
const {temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store');
const {ClanService}=require('../../src/server/clans/clan-service');
const service=require('../../src/server/clans/daily-quests/service');
const {RoomProfileLedger}=require('../../src/server/arena/resident/room-profile-ledger');
const {RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const boundary=require('../../src/server/arena/resident/room-quest-boundary');
const start=Date.parse('2026-11-15T03:00:00Z'),end=start+15*3600000;
async function fixture(t){
 let cleanup,at=start-86400000,child,ledger;const boxes=[];
 const root=temporary({after:f=>cleanup=f},'resident-clan-boundary');
 const store=new ProfileStore({filePath:path.join(root,'profiles.json'),journal:true,clanDailyQuests:true,
  incrementalSettlement:true,residentRoomExperiment:true,now:()=>at});
 const stop=async()=>{if(child && child.exitCode===null && child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}};
 t.after(async()=>{try{await stop();for(const box of boxes)await box.close();await ledger?.chain;await store.close();}finally{cleanup();}});
 const users=[store.open(),store.open()],clans=new ClanService(store);
 for(const u of users)store.transact(u.token,randomUUID(),'fixture',p=>{
  p.level=12;p.progress=require('../../src/server/progression/experience-progression').freshProgress(12);p.wallet.coins=10000;
 });
 const act=(u,action,fields={})=>clans.mutate(u.token,{action,requestId:randomUUID(),...fields});
 act(users[0],'create',{name:'Север',prefix:'С',emblem:'grove',privacy:'open',description:''});
 const clanId=store.find(users[0].token).clanId;
 act(users[1],'apply',{clanId});if(!store.find(users[1].token).clanId)act(users[0],'accept',{clanId,memberId:users[1].profile.id});
 at=start;store.refreshCompetition();
 const data=structuredClone(store.data);data.clans[clanId].dailyQuests.board.quests=[{
  ...service.catalog.items.find(q=>q.metric==='food'),target:4,progress:0,completedAt:null,reward:{kind:'crystals',amount:500}}];
 store.save(data);at=end-1000;
 child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});await once(child,'spawn');
 ledger=new RoomProfileLedger(store);const rooms=[];
 for(let i=0;i<2;i++){
  const profileId=users[i].profile.id,lifeId=randomUUID(),identity={roomId:'room-'+i,epoch:randomUUID()};
  await ledger.claim({...identity,profileIds:[profileId]},child);
  const file=path.join(root,'room-'+i+'.json'),box=await RoomOutbox.open({...identity,file});boxes.push(box);
  const room={...identity,box,file,profileId,lifeId};rooms.push(room);
  const entry=await box.append({at,progress:[{type:'lifeStarted',profileId,lifeId},{type:'questSample',profileId,lifeId,food:0,clanFood:0,rank:1}]});
  box.acknowledge(await ledger.accept(child,entry));
 }
 const send=async(room,input)=>{const entry=await room.box.append(input);room.box.acknowledge(await ledger.accept(child,entry));return entry;};
 return {store,ledger,child,rooms,users,clanId,send,stop,boxes,at:n=>{at=n;},board:()=>store.data.clans[clanId].dailyQuests.board};
}
test('resident prefix requires the final food sample; all rooms must cross 21:00 before exactly-once reward',async t=>{
 const f=await fixture(t),[a,b]=f.rooms;
 await f.send(a,{at:end-25,progress:[{type:'questSample',profileId:a.profileId,lifeId:a.lifeId,food:0,clanFood:3,rank:1}]});
 for(const room of f.rooms)await f.send(room,{at:end-10});
 f.at(end+5);const wallet=f.store.byId(a.profileId).wallet.crystals;
 f.store.refreshCompetition();assert(!f.board().settledAt);
 const frame={roomId:a.roomId,epoch:a.epoch,sequence:a.box.sequence+1,at:end+5,kind:'tick',progress:[],applied:[]};
 await assert.rejects(f.ledger.accept(f.child,{frame,digest:createHash('sha256').update(JSON.stringify(frame)).digest('hex')}),/boundary is missing/);
 for(const [room,food] of [[a,4],[b,0]]){
  const sample={at:end-10,kind:'boundary',boundaryAt:end,progress:[{type:'clanFoodSample',profileId:room.profileId,lifeId:room.lifeId,clanFood:food}]};
  await f.send(room,sample);
  assert.equal(f.store.byId(a.profileId).wallet.crystals,wallet);
  await f.send(room,{at:end+5,progress:[{type:'questSample',profileId:room.profileId,lifeId:room.lifeId,food:0,clanFood:food+100,rank:1}]});
  if(room===a){f.store.refreshCompetition();assert(!f.board().settledAt);}
 }
 assert.equal(f.board().quests[0].progress,4);assert.equal(f.board().quests[0].completedAt,end-10);
 f.store.refreshCompetition();assert.equal(f.store.byId(a.profileId).wallet.crystals,wallet+500);
 const after=f.store.byId(a.profileId).wallet.crystals;f.store.refreshCompetition();assert.equal(f.store.byId(a.profileId).wallet.crystals,after);
});
test('opening and closing samplers use the previous completed tick, omit dead bodies and reject multiple-window clock jumps',()=>{
 const live={profileId:'p',lifeId:'life',clanFoodCount:9},dead={...live,profileId:'dead',dead:true};
 const room={arena:{players:new Map([['p',live],['dead',dead]])}};
 for(const edge of [start,end]){
  const sample=boundary.sample(room,edge-10,edge,null);assert.equal(sample.at,edge-10);assert.equal(sample.boundaryAt,edge);
  assert.deepEqual(sample.progress,[{type:'clanFoodSample',profileId:'p',lifeId:'life',clanFood:9}]);
  live.clanFoodCount=10;assert.equal(sample.progress[0].clanFood,9);live.clanFoodCount=9;
  assert.equal(boundary.sample(room,edge-10,edge,edge),null);
 }
 assert.throws(()=>boundary.crossed(start-10,end),/multiple quest windows/);
});
test('pending boundary and post-cutoff frames recover before prizes; failed profile fsync cannot release the barrier',async t=>{
 const f=await fixture(t),[a,b]=f.rooms;
 for(const room of f.rooms)await f.send(room,{at:end-10});
 f.at(end+5);const wallet=f.store.byId(a.profileId).wallet.crystals;
 const sample=await a.box.append({at:end-10,kind:'boundary',boundaryAt:end,progress:[{type:'clanFoodSample',profileId:a.profileId,lifeId:a.lifeId,clanFood:4}]});
 const failed=t.mock.method(fs,'fsync',(_fd,cb)=>setImmediate(()=>cb(Error('injected boundary fsync'))));
 await assert.rejects(f.ledger.accept(f.child,sample),/boundary fsync/);failed.mock.restore();
 assert.equal(f.board().quests[0].progress,0);f.store.refreshCompetition();assert(!f.board().settledAt);
 await a.box.append({at:end+5,progress:[{type:'questSample',profileId:a.profileId,lifeId:a.lifeId,food:0,clanFood:100,rank:1}]});
 await f.stop();
 for(const room of f.rooms){
  await room.box.close();await f.ledger.fenceStopped(room,f.child);
  const copy=await RoomOutbox.openExisting({...room,file:room.file});f.boxes.push(copy);
  await f.ledger.recoverStopped(copy,f.child);
 }
 f.store.refreshCompetition();assert.equal(f.board().quests[0].progress,4);
 assert.equal(f.store.byId(a.profileId).wallet.crystals,wallet+500);
 assert.equal(f.store.byId(b.profileId).wallet.crystals,10);
});
