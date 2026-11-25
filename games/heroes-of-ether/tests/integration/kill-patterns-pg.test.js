"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
test('pattern evidence is atomic in PostgreSQL and does not modify rewards or moderation',{skip:!process.env.HEROETHER_PG_TEST_CONFIG},async()=>{
 const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state'),{pack}=require('../../src/server/persistence/state-snapshot'),{ProfileStore}=require('../../src/server/profiles/profile-store'),{KillDetector}=require('../../src/server/arena/kill-detector');
 const patterns=require('../../src/server/arena/kill-patterns'),epoch=Date.UTC(2026,10,26),now=()=>epoch+300000;
 const cfg={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG)),schema:'heroether_test_'+randomUUID().replaceAll('-','')},state=new PostgreSQLState(cfg),store=new ProfileStore({now}),u=store.open();
 const beforeWorld={...store.data,_journalRevision:1},before=pack(beforeWorld,{}),savedInventory=structuredClone(store.find(u.token).inventory);
 try{
  await state.initialize(before);await state.acquire(before);const session=patterns.session();let evidence;
  for(let at=0;at<240000;at+=1000)evidence ||= patterns.observe(session,{type:'split'},at,{wallAt:epoch+at,spawn:1});
  assert(evidence);const detector=new KillDetector({profiles:store,now});assert(await detector.report(u.profile.id,evidence));
  const world={...store.data,_journalRevision:2},next=pack(world,{}),put=state.put;
  state.put=async function(client,docs){await put.call(this,client,docs.slice(0,1));throw Error('injected review failure');};
  await assert.rejects(state.sync(next),/injected review failure/);state.put=put;assert.deepEqual((await state.read()).world,beforeWorld);
  await state.sync(next);const restored=(await state.read()).world;assert.deepEqual(restored,world);
  const p=Object.values(restored.profiles).find(p=>p.id===u.profile.id);assert.equal(p.kill.reason,'arena-repeated-patterns');assert(!p.moderation?.ban);assert.deepEqual(p.inventory,savedInventory);
  assert.equal(await detector.report(p.id,evidence),false);
 }finally{assert(/^heroether_test_[a-f0-9]{32}$/.test(cfg.schema));await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);state.manifestValue=null;await state.close();}
});
