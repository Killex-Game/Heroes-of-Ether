"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {encode,decode,differences,compatible,PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
const {pack,hash}=require('../../src/server/persistence/state-snapshot');
const {safeError}=require('../../src/server/persistence/postgresql-config');
test('PostgreSQL compressed documents preserve Unicode, unusual keys, money and receipts',()=>{
 const value=JSON.parse('{"__proto__":{"wallet":3},"кириллица":"😀","wallet":{"coins":120},"receipts":[{"id":"buy","amount":120}]}');
 const doc={_id:'profiles:a',value,hash:hash(value)},saved=encode(doc);
 assert.deepEqual(decode({id:saved._id,...saved}),doc);
 saved.value=Buffer.from('corrupt');assert.throws(()=>decode({id:saved._id,...saved}),{code:'PG_CORRUPT_DOCUMENT'});
 const wrong=encode(doc);wrong.hash='0'.repeat(64);assert.throws(()=>decode({id:wrong._id,...wrong}),{code:'PG_CHECKSUM_FAILED'});
});
test('PostgreSQL deltas retain immutable history and include deletion and latest balance',()=>{
 const world={_journalRevision:1,profiles:{a:{wallet:10,history:Array(100).fill('old')},b:{wallet:20}},clans:{}};
 const first=pack(world);world.profiles.a.wallet=11;delete world.profiles.b;world._journalRevision++;
 const next=pack(world),delta=differences(first,next);
 assert(delta.deletes.includes('profiles:b'));assert(delta.writes.some(d=>d._id==='profiles:a'));
 assert.equal(differences(next,next).writes.length,0);
 assert.equal(decode({id:delta.writes[0]._id,...delta.writes[0]}).value.wallet,11);
});
test('PostgreSQL source, revision, world and chat safeguards fail closed',()=>{
 const local={revision:8,worldHash:'a',chatRevision:4,chatHash:'b'},remote={version:1,sourceId:'s',...local};
 compatible(remote,local,'s');
 for(const [patch,code]of [[{sourceId:'x'},'PG_SOURCE_MISMATCH'],[{revision:9},'PG_CLOUD_AHEAD'],[{worldHash:'x'},'PG_DIVERGED'],[{chatRevision:5},'PG_CHAT_CLOUD_AHEAD'],[{chatHash:'x'},'PG_CHAT_DIVERGED']])assert.throws(()=>compatible({...remote,...patch},local,'s'),{code});
 assert.throws(()=>new PostgreSQLState({schema:'heroether;DROP'}),{code:'PG_CONFIG'});
 assert.equal(safeError({code:'28P01',message:'secret'}),'PG_AUTH_FAILED');assert(!safeError(Error('password')).includes('password'));
});
test('PostgreSQL transaction rolls back and releases the same client on every failure',async()=>{
 const commands=[],client={query:async q=>{commands.push(q);},release:broken=>commands.push(['release',broken])};
 const state=new PostgreSQLState({schema:'heroether_test_unit'},{pool:{connect:async()=>client}});
 await assert.rejects(state.transaction(async c=>{assert.equal(c,client);throw Error('failure');}),/failure/);
 assert(commands.includes('ROLLBACK'));assert(!commands.includes('COMMIT'));assert.deepEqual(commands.at(-1),['release',false]);
 commands.length=0;await state.transaction(async()=>42,{readOnly:true});assert(commands[0].includes('REPEATABLE READ READ ONLY'));assert(commands.includes('COMMIT'));
});
