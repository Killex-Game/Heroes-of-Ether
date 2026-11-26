"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
test('v4 and v5 arena awards retain exact amounts through PostgreSQL failure and retry',{skip:!process.env.HEROETHER_PG_TEST_CONFIG},async()=>{
  const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state'),{pack}=require('../../src/server/persistence/state-snapshot');
  const {ProfileStore}=require('../../src/server/profiles/profile-store'),progress=require('../../src/server/progression/experience-progression'),accrual=require('../../src/server/arena/mass-accrual');
  const cfg={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG)),schema:'heroether_test_'+randomUUID().replaceAll('-','')},state=new PostgreSQLState(cfg),store=new ProfileStore(),user=store.open();
  store.transact(user.token,randomUUID(),'fixture',p=>{p.level=501;p.progress=progress.freshProgress(501);});
  const beforeWorld={...store.data,_journalRevision:1},before=pack(beforeWorld,{});
  try{
    await state.initialize(before);await state.acquire(before);
    const actor={id:user.profile.id,lifeId:'v5-entry',mass:10000,account:{vip:true,premium:true}};accrual.reset(actor,0);let event;
    for(let at=50;at<=30000;at+=50)event=accrual.sample(actor,at,false,3)||event;
    const old={...event,ruleVersion:4,sequence:1,killUnits:8*accrual.KILL_DENOMINATOR},fresh={...event,sequence:2};
    store.applyArenaProgress('v5-pg-awards',[{type:'lifeStarted',lifeId:actor.lifeId,profileId:user.profile.id},{...old,profileId:user.profile.id},{...fresh,profileId:user.profile.id}],30000);
    assert.equal(store.find(user.token).progress.session.kills,13);assert.equal(store.find(user.token).progress.session.xp,60);
    const world={...store.data,_journalRevision:2},next=pack(world,{}),put=state.put;
    state.put=async function(client,docs){await put.call(this,client,docs.slice(0,1));throw Error('v5 injected persistence failure');};
    await assert.rejects(state.sync(next),/v5 injected/);state.put=put;assert.deepEqual((await state.read()).world,beforeWorld);
    await state.sync(next);assert.deepEqual((await state.read()).world,world);
    const saved=JSON.stringify(store.find(user.token).progress);
    store.applyArenaProgress('v5-pg-replayed-events',[{...old,profileId:user.profile.id},{...fresh,profileId:user.profile.id}],30001);
    assert.equal(JSON.stringify(store.find(user.token).progress),saved);
  }finally{assert(/^heroether_test_[a-f0-9]{32}$/.test(cfg.schema));await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);state.manifestValue=null;await state.close();await store.close();}
});
