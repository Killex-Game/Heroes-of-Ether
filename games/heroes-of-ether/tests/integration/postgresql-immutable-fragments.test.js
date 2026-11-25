"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {ProfileJournal}=require('../../src/server/profiles/profile-journal');
const {PinnedWorldReader}=require('../../src/server/persistence/pinned-world-reader');
const {SnapshotBuilder}=require('../../src/server/persistence/snapshot-builder');
const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
const {pack}=require('../../src/server/persistence/state-snapshot');

test('Real PostgreSQL preserves segmented immutable WAL snapshots across rollback, lost acknowledgement and history shrink',
  {skip:!process.env.HEROETHER_PG_TEST_CONFIG},async()=>{
  const config={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG,'utf8')),schema:'heroether_test_'+randomUUID().replaceAll('-','')};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'heroether-pg-segments-')),file=path.join(dir,'profiles.json');
  const initial={version:14,_journalRevision:1,profiles:{p:{id:'p',wallet:{coins:100},receipts:{old:'kept'},history:{payload:'😀я'.repeat(1500000)}}},clans:{}};
  fs.writeFileSync(file,JSON.stringify(initial));
  const journal=new ProfileJournal(file,{intervalMs:300000}),reader=new PinnedWorldReader(),builder=new SnapshotBuilder({immutableSource:reader});
  const state=new PostgreSQLState(config),pins=[];
  async function capture(){const pin=await journal.pinSnapshot();pins.push(pin);return builder.pack(reader.read(pin).data);}
  try{
    const first=await capture();assert(first.docs.get('profiles:p').chunked);assert.equal(first.digest,pack(initial).digest);
    await state.initialize(first);await state.acquire(first);
    const next={...initial,profiles:{p:{...initial.profiles.p,wallet:{coins:93},receipts:{old:'kept',paid:'once'}}}};
    journal.commit(next);const second=await capture(),expected={...next,_journalRevision:2};
    const put=state.put;
    state.put=async function(c,docs){await put.call(this,c,docs.slice(0,1));throw Error('injected fragmented write rollback');};
    await assert.rejects(state.sync(second),/injected fragmented write rollback/);state.put=put;
    assert.deepEqual((await state.read()).world,initial);
    await state.sync(second);assert.deepEqual((await state.read()).world,expected);
    const thirdWorld={...expected,profiles:{p:{...expected.profiles.p,wallet:{coins:91},receipts:{...expected.profiles.p.receipts,second:'once'}}}};
    journal.commit(thirdWorld);const third=await capture(),transaction=state.transaction;let lost=true;
    state.transaction=async function(fn,options){const result=await transaction.call(this,fn,options);if(lost){lost=false;throw Error('lost segmented commit acknowledgement');}return result;};
    await assert.rejects(state.sync(third),/lost segmented commit/);state.transaction=transaction;
    const committed=(await state.read()).manifest;await state.sync(third);
    assert.equal(state.manifestValue.generation,committed.generation);
    assert.deepEqual((await state.read()).world,{...thirdWorld,_journalRevision:3});
    assert.equal(first.digest,pack(initial).digest);
    const smaller={...thirdWorld,profiles:{p:{...thirdWorld.profiles.p,history:{payload:'explicit synthetic edit'}}}};
    journal.commit(smaller);await journal.requestCheckpoint();const fourth=await capture();
    assert(!fourth.docs.get('profiles:p').chunked);await state.sync(fourth);
    assert.deepEqual((await state.read()).world,{...smaller,_journalRevision:4});
    assert.equal((await state.pool.query(`SELECT count(*)::int AS count FROM ${state.table}.state WHERE id LIKE 'chunk:%'`)).rows[0].count,0);
  }finally{
    for(const pin of pins)await pin.releaseAsync();await journal.close();
    assert(/^heroether_test_[a-f0-9]{32}$/.test(config.schema));
    await state.pool.query(`DROP SCHEMA IF EXISTS ${state.table} CASCADE`);state.manifestValue=null;await state.close();
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'heroether-pg-segments-'));
    fs.rmSync(dir,{recursive:true});
  }
});
