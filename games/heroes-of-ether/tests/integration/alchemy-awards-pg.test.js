"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
test('alchemy and owner greatness persist atomically in isolated PostgreSQL, with exact retry receipts',
 {skip:!process.env.HEROETHER_PG_TEST_CONFIG},async()=>{
 const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state'),{pack}=require('../../src/server/persistence/state-snapshot');
 const cfg={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG)),schema:'heroether_test_'+randomUUID().replaceAll('-','')};
 const state=new PostgreSQLState(cfg),f=require('../helpers/black-friday-fixture')({incrementalSettlement:true});
 const A=require('../../src/server/events/ether-alchemy');f.command('stop',{runId:f.run.id});f.command('start',{eventId:A.manifest.id});
 const owner=f.store.open(),{OwnerAccess}=require('../../src/server/admin/owner-access'),{OwnerService}=require('../../src/server/admin/owner-service');
 const access=new OwnerAccess({ownerId:owner.profile.id,now:f.now}),service=new OwnerService({profiles:f.store,access,now:f.now});
 f.store.transactProfile(f.user.token,randomUUID(),'ingredients',p=>{p.alchemy={version:1,natural:0,ingredients:Object.fromEntries(A.rules.ingredients.map(i=>[i.id,999])),learned:[],equipped:null};});
 try{
  const beforeWorld={...f.store.data,_journalRevision:1},aux={'game-events.json':f.manager.data},before=pack(beforeWorld,aux);await state.initialize(before);await state.acquire(before);
  const brew={action:'brew',potionId:'knowledge',runId:f.manager.active().id,requestId:randomUUID()};A.mutate(f.store,f.user.token,brew);
  const p=f.p(),grant={action:'greatness',targetId:p.id,amount:2000000,reason:'Проверка сохранности',revision:p.revision,requestId:randomUUID()};
  service.apply(f.store.find(owner.token),grant);
  const world={...f.store.data,_journalRevision:2},next=pack(world,aux),put=state.put;
  state.put=async function(client,docs){await put.call(this,client,docs.slice(0,1));throw Error('injected alchemy failure');};
  await assert.rejects(state.sync(next),/injected alchemy/);state.put=put;assert.deepEqual((await state.read()).world,beforeWorld);
  await state.sync(next);const saved=await state.read();assert.deepEqual(saved.world,world);assert.deepEqual(saved.auxiliary,aux);
  assert.equal(A.mutate(f.store,f.user.token,brew).replay,true);assert.equal(service.apply(f.store.find(owner.token),grant).duplicate,true);
  const restored=Object.values(saved.world.profiles).find(x=>x.id===p.id);assert.equal(restored.alchemy.achievements[brew.runId].values.alchemy_potion_knowledge,5);
  assert.equal(restored.alchemy.achievements[brew.runId].claimed.alchemy_brews,1);assert.equal(restored.greatness,f.p().greatness);
 }finally{assert(/^heroether_test_[a-f0-9]{32}$/.test(cfg.schema));await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);state.manifestValue=null;await state.close();}
});
