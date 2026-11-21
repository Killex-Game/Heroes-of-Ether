"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"), os=require("node:os"), path=require("node:path");
const {ProfileStore}=require("../../src/server/profiles/profile-store");
const {ArenaProgressPreparer}=require("../../src/server/profiles/arena-progress-preparer");
const {recover}=require("../../src/server/profiles/profile-journal");
const AT=Date.parse("2026-11-11T12:00:00Z");
function comparable(data) {
  const copy=structuredClone(data);
  for(const p of Object.values(copy.profiles))
    for(const [i,e] of (p.transactions?.entries||[]).entries()) e.id=`entry-${i}`;
  return copy;
}
async function fixture(t,at=AT) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hero-pipeline-"));
  const store=new ProfileStore({filePath:path.join(dir,"profiles.json"),journal:true,now:()=>at,incrementalSettlement:true});
  const serial=new ProfileStore({now:()=>at});
  store.arenaPreparer=new ArenaProgressPreparer({parallelism:3,computeBudgetMs:100});
  t.after(async()=>{await store.close();await serial.close();fs.rmSync(dir,{recursive:true,force:true});});
  const users=Array.from({length:12},()=>store.open());
  for(const [i,u] of users.entries())store.startLife(u.profile.id,`life-${i}`);
  serial.data=structuredClone(store.data);
  const batches=Array.from({length:16},(_,i)=>({id:`batch-${i}`,at:at+i*50,progress:users.flatMap((u,j)=>[
    {type:"massPeak",profileId:u.profile.id,mass:1100+i*100+j},
    {type:"absorbed",profileId:u.profile.id,victimProfileId:`victim-${i}-${j}`,lifeId:`life-${j}`,victimDefeated:true,gain:30},
  ])}));
  return{store,serial,users,batches};
}
async function drain(store,serial,batches) {
  let index=0;
  while(index<batches.length) {
    const before=store.data,copy=structuredClone(before);
    const changes=await store.applyArenaGroup(batches.slice(index,index+8));
    assert.ok(changes?.length>0);
    for(const b of batches.slice(index,index+changes.length))serial.applyArenaProgress(b.id,b.progress,b.at);
    assert.deepEqual(comparable(store.data),comparable(serial.data));
    assert.deepEqual(before,copy);
    index+=changes.length;
  }
}
test("parallel pipeline preserves every FIFO sample, immutable snapshots, replay and WAL recovery",async t=>{
  const {store,serial,batches}=await fixture(t);
  await drain(store,serial,batches);
  assert.equal(store.arenaPreparer.stats.failures,0);
  assert.equal(store.arenaPreparer.stats.shards.failures,0);
  assert.ok(store.arenaPreparer.stats.shards.jobs>=16);
  assert.deepEqual(await store.applyArenaGroup(batches.slice(-1)),[[]]);
  assert.deepEqual(recover(store.filePath).data.profiles,store.data.profiles);
});
test("pipeline rebases lobby changes against its resident prediction without restoring old balances",async t=>{
  const {store,serial,users,batches}=await fixture(t);
  await drain(store,serial,batches.slice(0,5));
  const request="pipeline-wallet-test-0001";
  for(const s of [store,serial])s.transact(users[0].token,request,"fixture",p=>{p.wallet.coins+=17;});
  await drain(store,serial,batches.slice(5));
  assert.equal(store.arenaPreparer.stats.conflicts,0);
});
test("pipeline yields at the calendar boundary before processing the next timestamp",async t=>{
  const start=Date.parse("2026-11-11T20:59:59.900Z");
  const {store,serial,batches}=await fixture(t,start);
  await drain(store,serial,batches);
  assert.equal(store.arenaPreparer.stats.failures,0);
});
test("an unpublished pipeline result is discarded if authoritative profiles change",async t=>{
  const {store,serial,batches,users}=await fixture(t);
  const pending=store.applyArenaGroup(batches);
  const request="pipeline-conflict-test-0001";
  for(const s of [store,serial])s.transact(users[0].token,request,"fixture",p=>{p.wallet.coins+=31;});
  assert.equal(await pending,null);
  assert.equal(store.arenaPreparer.stats.conflicts,1);
  await drain(store,serial,batches);
});

test("accepted worker settlement retains validation identity without bypassing later roster changes",async t=>{
  const {store,serial,users,batches}=await fixture(t);
  const {ClanService}=require("../../src/server/clans/clan-service");
  const {randomUUID}=require("node:crypto");
  const competition=require("../../src/server/clans/clan-competition-service");
  const service=new ClanService(store);
  for(const u of users)store.transact(u.token,randomUUID(),"fund",p=>{p.level=12;p.wallet.coins=10000;});
  service.mutate(users[0].token,{action:"create",requestId:randomUUID(),name:"Тест",prefix:"TST",emblem:"astral",privacy:"open"});
  const clanId=store.find(users[0].token).clanId;
  for(const u of users.slice(1,10))service.mutate(u.token,{action:"apply",requestId:randomUUID(),clanId});
  serial.data=structuredClone(store.data);
  await drain(store,serial,batches.slice(0,3));
  assert.equal(competition.isCaptured(store.data),true);
  const warmed=store.prepareSnapshot(store.data,AT);
  assert.equal(warmed.clans,store.data.clans,"accepted worker results must not clone/re-settle every idle clan");
  assert.deepEqual(comparable(warmed),comparable(store.data));
  const key=Object.keys(store.data.profiles).find(k=>store.data.profiles[k].id===users[1].profile.id);
  for(const s of [store,serial]) {
    const p=s.data.profiles[key], c=s.data.clans[clanId];
    s.save({...s.data,profiles:{...s.data.profiles,[key]:{...p,clanId:null}},clans:{...s.data.clans,[clanId]:{...c,members:c.members.filter(id=>id!==p.id)}}});
  }
  assert.deepEqual(comparable(store.data),comparable(serial.data));
  assert.equal(store.data.clans[clanId].competition.joined[users[1].profile.id],undefined);
});
