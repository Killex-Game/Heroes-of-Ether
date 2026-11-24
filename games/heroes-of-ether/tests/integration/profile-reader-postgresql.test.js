'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
const {ProfileReader}=require('../../src/server/persistence/profile-reader');
const {pack}=require('../../src/server/persistence/state-snapshot');
test('addressed reader against isolated PostgreSQL preserves versions, fragmented histories and concurrent saves',
  {skip:!process.env.HEROETHER_PG_TEST_CONFIG},async t=>{
  const config={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG,'utf8')),
    schema:'heroether_test_'+randomUUID().replaceAll('-','')};
  const state=new PostgreSQLState(config),reader=new ProfileReader(state);
  let world={version:13,_journalRevision:1,profiles:Object.fromEntries(Array.from({length:80},(_,i)=>
    ['key'+i,{id:'player'+i,revision:1,wallet:{coins:i},receipts:{'op-1':'saved 😀'}}])),clans:{}};
  world.profiles.key0.archive='Ж😀'.repeat(1800000);
  try{
    const first=pack(world);await state.initialize(first);await state.acquire(first);
    await t.test('one normal profile fetch does not read its neighbours or the large history',async()=>{
      const result=await reader.read([{key:'key1',id:'player1'}]);
      assert.deepEqual(result.profiles.get('player1'),world.profiles.key1);assert.equal(reader.metrics.documents,1);
      assert.equal(reader.cache.size,1);
    });
    await t.test('one fragmented profile is restored exactly and retains all historical data',async()=>{
      const result=await reader.read([{key:'key0',id:'player0'}]);
      assert.deepEqual(result.profiles.get('player0'),world.profiles.key0);
      assert(reader.metrics.documents<30);assert(reader.cacheBytes<=reader.maxCacheBytes);
    });
    await t.test('a concurrent committed generation cannot mix profiles within the read',async()=>{
      reader.clear();const changed=structuredClone(world);changed._journalRevision++;
      changed.profiles.key1.wallet.coins+=10;changed.profiles.key2.wallet.coins+=10;
      const next=pack(changed),original=state.transaction;let fired=false;
      state.transaction=function(fn,options){return original.call(this,async c=>fn({query:async(...args)=>{
        const result=await c.query(...args);
        if(options?.readOnly&&!fired&&String(args[0]).includes('metadata')){fired=true;await state.sync(next);}
        return result;
      }}),options);};
      try{const result=await reader.read([{key:'key1',id:'player1'},{key:'key2',id:'player2'}]);
        assert(fired);assert.deepEqual(result.profiles.get('player1'),world.profiles.key1);
        assert.deepEqual(result.profiles.get('player2'),world.profiles.key2);
      }finally{state.transaction=original;}
      world=changed;
      assert.deepEqual((await reader.read([{key:'key1',id:'player1'}])).profiles.get('player1'),world.profiles.key1);
    });
    await t.test('corruption and wrong identities fail before returning a profile',async()=>{
      reader.clear();await assert.rejects(reader.read([{key:'key2',id:'player3'}]),{code:'PG_PROFILE_IDENTITY'});
      await state.pool.query(`UPDATE ${state.table}.state SET hash=$1 WHERE id='profiles:key2'`,['0'.repeat(64)]);
      await assert.rejects(reader.read([{key:'key2',id:'player2'}]),{code:'PG_CHECKSUM_FAILED'});
    });
  }finally{
    assert(/^heroether_test_[a-f0-9]{32}$/.test(config.schema));
    await state.pool.query(`DROP SCHEMA IF EXISTS ${state.table} CASCADE`);state.manifestValue=null;await state.close();
  }
});
