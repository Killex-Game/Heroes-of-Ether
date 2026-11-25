"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),{randomUUID}=require("node:crypto");
test("negative sets and spending survive PostgreSQL rollback, commit and reload",{skip:!process.env.HEROETHER_PG_TEST_CONFIG},async()=>{
 const {PostgreSQLState}=require("../../src/server/persistence/postgresql-state"),{pack}=require("../../src/server/persistence/state-snapshot"),{ProfileStore}=require("../../src/server/profiles/profile-store");
 const cfg={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG)),schema:"heroether_test_"+randomUUID().replaceAll("-","")},state=new PostgreSQLState(cfg);
 const store=new ProfileStore(),a=store.open(),b=store.open();store.transact(a.token,randomUUID(),"fund",p=>{p.wallet.bucks=500;});
 const beforeWorld={...store.data,_journalRevision:1},before=pack(beforeWorld,{});
 try{
  await state.initialize(before);await state.acquire(before);
  const requests=[];for(const id of ["hex","infection","curse","curse","skull","shackles"]){const request={action:"gift",giftId:id,targetId:b.profile.id,confirmed:true,requestId:randomUUID()};requests.push(request);store.socialAction(a.token,request);}
  const world={...store.data,_journalRevision:2},next=pack(world,{}),put=state.put;
  state.put=async function(client,docs){await put.call(this,client,docs.slice(0,1));throw Error("injected gift failure");};
  await assert.rejects(state.sync(next),/injected gift/);state.put=put;assert.deepEqual((await state.read()).world,beforeWorld);
  await state.sync(next);const saved=await state.read();assert.deepEqual(saved.world,world);
  for(const request of requests)assert.equal(store.socialAction(a.token,request).replay,true);
  assert.equal(store.find(a.token).wallet.bucks,380);
  const recipient=Object.values(saved.world.profiles).find(p=>p.id===b.profile.id);
  assert.deepEqual(recipient.social,store.find(b.token).social);
 }finally{assert(/^heroether_test_[a-f0-9]{32}$/.test(cfg.schema));await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);state.manifestValue=null;await state.close();}
});
