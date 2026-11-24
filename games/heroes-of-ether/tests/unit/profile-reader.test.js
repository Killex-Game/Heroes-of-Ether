'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ProfileReader}=require('../../src/server/persistence/profile-reader');
const {pack}=require('../../src/server/persistence/state-snapshot');
const {encode}=require('../../src/server/persistence/postgresql-state');
function fixture(options={}){
  const world={_journalRevision:1,profiles:{a:{id:'one',wallet:{coins:5},receipts:{'покупка':'😀'}},b:{id:'two',wallet:{coins:9}}},clans:{}};
  const state={config:{sourceId:'test'},table:'"heroether_test_unit"',generation:1,queries:[],
    manifest:async()=>({version:1,sourceId:'test',generation:state.generation,revision:world._journalRevision,documentFormat:1}),
    transaction:async(fn,o)=>{assert.equal(o.readOnly,true);return fn({query:async(sql,[ids])=>{
      assert(sql.includes('WHERE id=ANY($1::text[])'));state.queries.push(ids);
      return {rows:ids.map(id=>state.docs.get(id)).filter(Boolean).map(d=>({id:d._id,...d}))};
    }});}};
  const update=()=>{state.docs=new Map([...pack(world).docs].map(([k,v])=>[k,encode(v)]));};update();
  return {state,world,update,reader:new ProfileReader(state,options)};
}
test('addressed reads request only selected keys, detach results and preserve histories',async()=>{
  const {reader,state,world}=fixture(),locator=[{key:'a',id:'one'}];
  const first=await reader.read(locator);assert.deepEqual(first.profiles.get('one'),world.profiles.a);
  assert.deepEqual(state.queries,[['profiles:a']]);first.profiles.get('one').wallet.coins=0;
  assert.equal((await reader.read(locator)).profiles.get('one').wallet.coins,5);assert.equal(state.queries.length,1);
  assert.equal(reader.metrics.cacheHits,1);
  assert.equal((await reader.read([{key:'missing',id:'absent'}])).profiles.get('absent'),null);
});
test('generation changes, expected versions and identities cannot return stale balances',async()=>{
  const {reader,state,world,update}=fixture(),loc=[{key:'a',id:'one'}];await reader.read(loc);
  world.profiles.a.wallet.coins=12;world._journalRevision++;state.generation++;update();
  await assert.rejects(reader.read(loc,{expectedGeneration:1}),{code:'PG_PROFILE_GENERATION'});
  const r=await reader.read(loc,{expectedGeneration:2});assert.equal(r.profiles.get('one').wallet.coins,12);
  await assert.rejects(reader.read([{key:'a',id:'two'}]),{code:'PG_PROFILE_IDENTITY'});
});
test('bounded cache evicts old entries and oversized batches do not cache partial results',async()=>{
  const {reader,state}=fixture({maxCacheEntries:1});
  await reader.read([{key:'a',id:'one'}]);await reader.read([{key:'b',id:'two'}]);
  assert.equal(reader.cache.size,1);await reader.read([{key:'a',id:'one'}]);assert.equal(state.queries.length,3);
  const tiny=fixture({maxBatchBytes:5});await assert.rejects(tiny.reader.read([{key:'a',id:'one'}]),{code:'PG_PROFILE_BATCH_TOO_LARGE'});
  assert.equal(tiny.reader.cache.size,0);
});
test('corruption, malformed locators and unknown sources fail closed',async()=>{
  const {reader,state}=fixture();state.docs.get('profiles:a').hash='0'.repeat(64);
  await assert.rejects(reader.read([{key:'a',id:'one'}]),{code:'PG_CHECKSUM_FAILED'});
  for(const loc of [[],[{key:'a',id:'one'},{key:'b',id:'one'}],[{key:'a\0',id:'one'}]])
    await assert.rejects(reader.read(loc),{code:'PG_PROFILE_LOCATORS'});
  state.manifest=async()=>({version:1,sourceId:'other',generation:1,revision:1});
  await assert.rejects(reader.read([{key:'a',id:'one'}]),{code:'PG_SOURCE_MISMATCH'});
});
test('concurrent admission is bounded and released on rejection',async()=>{
  const {reader,state}=fixture({maxConcurrentReads:1});const original=state.transaction;
  let resume;state.transaction=(fn,options)=>new Promise(resolve=>{resume=()=>resolve(original(fn,options));});
  const pending=reader.read([{key:'a',id:'one'}]);
  await assert.rejects(reader.read([{key:'b',id:'two'}]),{code:'PG_PROFILE_BUSY'});
  resume();await pending;assert.equal(reader.pending,0);state.transaction=original;
  await assert.rejects(reader.read([{key:'a',id:'wrong'}]),{code:'PG_PROFILE_IDENTITY'});
  assert.equal(reader.pending,0);
});
test('batch budget rejects excessive output and covers cached entries',async()=>{
  const {reader,state,world}=fixture({maxBatchBytes:Buffer.byteLength(JSON.stringify({id:'one',wallet:{coins:5},receipts:{'покупка':'😀'}}))-1});
  await assert.rejects(reader.read([{key:'a',id:'one'},{key:'b',id:'two'}]),{code:'PG_PROFILE_BATCH_TOO_LARGE'});
  assert.deepEqual(state.queries,[['profiles:a','profiles:b']]);assert.equal(reader.cache.size,0);
  reader.maxBatchBytes=10000;await reader.read([{key:'a',id:'one'}]);
  reader.maxBatchBytes=1;await assert.rejects(reader.read([{key:'a',id:'one'}]),{code:'PG_PROFILE_BATCH_TOO_LARGE'});
  reader.maxBatchBytes=10000;reader.maxLogicalBytes=1;
  await assert.rejects(reader.read([{key:'a',id:'one'}]),{code:'PG_PROFILE_TOO_LARGE'});
});
