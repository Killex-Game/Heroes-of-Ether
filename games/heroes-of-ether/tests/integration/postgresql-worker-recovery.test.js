'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
const {DatabaseSync}=require('../../src/server/persistence/database-sync');
const {ProfileJournal}=require('../../src/server/profiles/profile-journal');
const {pack}=require('../../src/server/persistence/state-snapshot');

test('Real PostgreSQL worker resumes a pinned newer WAL after termination without losing history or repeating a mutation',
  {skip:!process.env.HEROETHER_PG_TEST_CONFIG},async()=>{
  const config={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG,'utf8')),schema:'heroether_test_'+randomUUID().replaceAll('-','')};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'heroether-pg-resume-')),data=path.join(root,'data');fs.mkdirSync(data);
  const file=path.join(data,'profiles.json');
  const initial={version:14,_journalRevision:1,profiles:{a:{id:'a',wallet:{coins:100},receipts:{old:{amount:1}},
    history:Array.from({length:10000},(_,i)=>({id:'past-'+i,text:'Сохранённая история 😀',amount:i}))}},clans:{c:{members:['a']}}};
  const auxiliary={'game-events.json':{events:[{id:'retained'}]},'clan-chat.json':{messages:[{text:'Привет'}]}};
  fs.writeFileSync(file,JSON.stringify(initial));
  for(const [name,value]of Object.entries(auxiliary))fs.writeFileSync(path.join(data,name),JSON.stringify(value));
  const state=new PostgreSQLState(config),journal=new ProfileJournal(file,{intervalMs:300000});let sync;
  try{
    await state.initialize(pack(initial,auxiliary));
    sync=new DatabaseSync(root,config);sync.profiles={journal};
    await sync.command('open');
    const next={...initial,profiles:{a:{...initial.profiles.a,wallet:{coins:93},receipts:{...initial.profiles.a.receipts,paid:{amount:7}}}}};
    journal.commit(next);
    await sync.worker.terminate();assert.equal(sync.failed,true);
    const result=await sync.flush();assert.equal(result.revision,2);assert.equal(sync.failed,false);
    const verified=await state.read();assert.deepEqual(verified.world,{...next,_journalRevision:2});
    assert.deepEqual(verified.auxiliary,auxiliary);
    await sync.flush();assert.deepEqual((await state.read()).world,verified.world);
    journal.commit({...next,profiles:{a:{...next.profiles.a,wallet:{coins:91},receipts:{...next.profiles.a.receipts,second:{amount:2}}}}});
    await journal.requestCheckpoint();await sync.worker.terminate();
    assert.equal((await sync.flush()).revision,3);
    const after=await state.read();assert.equal(after.world.profiles.a.wallet.coins,91);
    assert.deepEqual(after.world.profiles.a.history,initial.profiles.a.history);
    assert.deepEqual(Object.keys(after.world.profiles.a.receipts).sort(),['old','paid','second']);
  }finally{
    await sync?.close(false);await journal.close();
    assert(/^heroether_test_[a-f0-9]{32}$/.test(config.schema));
    await state.pool.query(`DROP SCHEMA IF EXISTS ${state.table} CASCADE`);await state.close();
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'heroether-pg-resume-'));
    fs.rmSync(root,{recursive:true});
  }
});
