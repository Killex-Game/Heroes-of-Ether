"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
const {pack}=require('../../src/server/persistence/state-snapshot');
test('PostgreSQL persistence against an isolated real database schema',{skip:!process.env.HEROETHER_PG_TEST_CONFIG},async t=>{
 const config={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG,'utf8')),schema:'heroether_test_'+randomUUID().replaceAll('-','')};
 const state=new PostgreSQLState(config),second=new PostgreSQLState(config);
 const aux={'game-events.json':{events:[{id:'test'}]},'clan-chat.json':{messages:[{text:'Привет 😀'}]}};
 let world={version:13,_journalRevision:1,profiles:Object.fromEntries(Array.from({length:80},(_,i)=>['p'+i,{wallet:{coins:i},receipts:[{id:'r'+i}],name:'Игрок 😀 '+i}])),clans:{c:{members:['p0']}}};
 world.profiles.p0.archive='Ж😀'.repeat(1800000);
 let snapshot=pack(world,aux);
 try{
  await t.test('full independent compressed read preserves large fragmented profiles and auxiliary documents',async()=>{
   const result=await state.initialize(snapshot);assert.deepEqual(result.world,world);assert.deepEqual(result.auxiliary,aux);
   assert.equal(result.snapshot.digest,snapshot.digest);assert.equal(snapshot.documentFormat,1);
   await assert.rejects(state.initialize(snapshot),{code:'PG_SCHEMA_NOT_EMPTY'});
  });
  await t.test('single writer excludes concurrent writers',async()=>{
   await state.acquire(snapshot);assert([...state.previous.docs.values()].every(d=>!Object.hasOwn(d,'value')));
   await state.sync(state.previous);assert.deepEqual((await state.read()).world,world);
   await assert.rejects(second.acquire(snapshot),{code:'PG_WRITER_BUSY'});
  });
  await t.test('rollback leaves all wallet, receipts, deletions and manifest unchanged',async()=>{
   const changed=structuredClone(world);changed._journalRevision++;changed.profiles.p1.wallet.coins++;delete changed.profiles.p2;
   const next=pack(changed,aux),put=state.put;state.put=async function(c,docs){await put.call(this,c,docs.slice(0,1));throw Error('injected write failure');};
   await assert.rejects(state.sync(next),/injected write failure/);state.put=put;
   assert.deepEqual((await state.read()).world,world);
   const saved=await state.sync(next);assert.equal(saved.revision,2);world=changed;snapshot=next;
  });
  await t.test('lost commit acknowledgement reconciles without replay or duplicate rewards',async()=>{
   const changed=structuredClone(world);changed._journalRevision++;changed.profiles.p1.wallet.coins+=5;changed.profiles.p1.receipts.push({id:'unique',amount:5});
   const next=pack(changed,aux),transaction=state.transaction;let lost=true;
   state.transaction=async function(fn,options){const result=await transaction.call(this,fn,options);if(lost){lost=false;throw Error('lost commit acknowledgement');}return result;};
   await assert.rejects(state.sync(next),/lost commit/);state.transaction=transaction;
   const remote=(await state.read()).manifest;await state.sync(next);
   assert.equal(state.manifestValue.generation,remote.generation);assert.deepEqual((await state.read()).world,changed);world=changed;snapshot=next;
  });
  await t.test('repeatable read never mixes two generations during a concurrent save',async()=>{
   const changed=structuredClone(world);changed._journalRevision++;changed.profiles.p79.wallet.coins+=7;
   const next=pack(changed,aux),transaction=state.transaction;let triggered=false;
   state.transaction=function(fn,options){return transaction.call(this,async c=>fn({query:async(...args)=>{
    const result=await c.query(...args);
    if(options?.readOnly&&!triggered&&String(args[0]).includes('ORDER BY id LIMIT 64')){triggered=true;await state.sync(next);}
    return result;
   }}),options);};
   const before=await state.read();state.transaction=transaction;assert(triggered);assert.deepEqual(before.world,world);
   assert.deepEqual((await state.read()).world,changed);world=changed;snapshot=next;
  });
  await t.test('checksum corruption is rejected before returning a world',async()=>{
   await state.pool.query(`UPDATE ${state.table}.state SET hash=$1 WHERE id='profiles:p1'`,['0'.repeat(64)]);
   await assert.rejects(state.read(),{code:'PG_CHECKSUM_FAILED'});
   await state.pool.query(`UPDATE ${state.table}.state SET hash=$1 WHERE id='profiles:p1'`,[snapshot.docs.get('profiles:p1').hash]);
  });
  await t.test('streamed backup restores all values and rejects changed or missing files',async()=>{
   const backup=require('../../src/server/persistence/postgresql-backup'),path=require('node:path'),os=require('node:os');
   const temp=fs.mkdtempSync(path.join(os.tmpdir(),'heroether-pg-backup-')),destination=path.join(temp,'snapshot');
   try{
    const report=await backup.exportSnapshot(state,destination);assert.equal(report.digest,snapshot.digest);
    const loaded=backup.loadSnapshot(destination);assert.deepEqual(loaded.world,world);assert.deepEqual(loaded.auxiliary,aux);
    const index=JSON.parse(fs.readFileSync(path.join(destination,'postgresql-backup.json'))),file=path.join(destination,index.rows[0].file),original=fs.readFileSync(file);
    fs.writeFileSync(file,Buffer.from('damaged'));assert.throws(()=>backup.verifySnapshot(destination),{code:'PG_BACKUP_CORRUPT'});
    fs.writeFileSync(file,original);fs.writeFileSync(path.join(destination,'extra'),'unexpected');assert.throws(()=>backup.verifySnapshot(destination),{code:'PG_BACKUP_CORRUPT'});
   }finally{assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'heroether-pg-backup-'));fs.rmSync(temp,{recursive:true});}
  });
  await t.test('lease takeover fences the previous writer and source divergence fails closed',async()=>{
   await state.pool.query(`UPDATE ${state.table}.metadata SET document=jsonb_set(document,'{leaseUntil}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id='state'`);
   await second.acquire(snapshot);await assert.rejects(state.sync(snapshot),{code:'PG_WRITER_LOST'});
   const oldSource=second.config.sourceId;second.config.sourceId=randomUUID();await assert.rejects(second.acquire(snapshot),{code:'PG_SOURCE_MISMATCH'});second.config.sourceId=oldSource;
   await assert.rejects(second.acquire({...snapshot,revision:snapshot.revision-1}),{code:'PG_CLOUD_AHEAD'});
   await second.close();await state.acquire(snapshot);await state.sync(snapshot);assert.deepEqual((await state.read()).world,world);
  });
 }finally{
  await second.close().catch(()=>{});
  assert(/^heroether_test_[a-f0-9]{32}$/.test(config.schema));
  await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);state.manifestValue=null;await state.close();
 }
});
