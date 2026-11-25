'use strict';
// Separate synthetic schema, temporary WAL, loopback-only clients. Never start
// this process against a production data directory or reuse its schema name.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fork}=require('node:child_process'),{randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
async function main(){
  const [configFile,output,roomText='1']=process.argv.slice(2),rooms=Number(roomText);
  if(!configFile||!output||!Number.isInteger(rooms)||rooms<1||rooms>(process.env.CAPACITY_REALISTIC==='1'?12:3))
    throw Error('Usage: node scripts/benchmarks/postgresql-capacity.cjs CONFIG OUTPUT_DIRECTORY ROOMS(1..3; realistic up to 12)');
  let repository=root;
  for(let dir=root;path.dirname(dir)!==dir;dir=path.dirname(dir))
    if(fs.existsSync(path.join(dir,'.git'))){repository=dir;break;}
  const out=path.resolve(output),relative=path.relative(repository,out);
  if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))
    throw Error('Keep private benchmark output outside the game repository');
  if(fs.existsSync(out))throw Error('Output directory must be new');
  const source=JSON.parse(fs.readFileSync(path.resolve(configFile),'utf8'));
  const gameClock=require('./game-clock.cjs').fromStart(process.env.CAPACITY_GAME_AT);
  if(process.env.CAPACITY_SEED&&process.env.CAPACITY_FIXTURE)
    throw Error('Choose a verified synthetic seed or a legacy fixture, not both');
  if(process.env.CAPACITY_SEED&&!process.env.CAPACITY_GAME_AT)
    throw Error('A verified synthetic seed requires CAPACITY_GAME_AT');
  if(gameClock.offsetMs && process.env.CAPACITY_FIXTURE)
    throw Error('A shifted game clock requires a freshly generated synthetic fixture');
  const schema='heroether_test_'+randomBytes(10).toString('hex');
  fs.mkdirSync(out,{recursive:true,mode:0o700});
  const privateConfig=path.join(out,'postgresql.local.json');
  fs.writeFileSync(privateConfig,JSON.stringify({...source,schema}),{mode:0o600});
  const fixture=path.join(out,'synthetic-world.json');
  const seed=process.env.CAPACITY_SEED?require('./capacity-seed.cjs').read(path.resolve(process.env.CAPACITY_SEED),gameClock):null;
  const fixtureData=seed?seed.fixture:process.env.CAPACITY_FIXTURE
    ? JSON.parse(fs.readFileSync(path.resolve(process.env.CAPACITY_FIXTURE),'utf8'))
    : require('./database-room-fixture.cjs').createFixture(Date.now()+gameClock.offsetMs);
  assert.equal(Object.keys(fixtureData.data.profiles).length,1280);
  assert(Object.values(fixtureData.data.profiles).every(p=>p.testFixture==='database-capacity-20261110'));
  const realistic=process.env.CAPACITY_REALISTIC==='1',mixedMinutes=Number(process.env.CAPACITY_MIXED_MINUTES||0);
  const progressBackend=require('./capacity-progress-backend.cjs').progressBackend(process.env.CAPACITY_PROGRESS_BACKEND);
  assert(Number.isInteger(mixedMinutes)&&mixedMinutes>=0&&mixedMinutes<=120);
  const perRoom=require('../../config/arena-rooms.json').arenaCapacity;
  if(process.env.CAPACITY_RETAINED_HISTORY==='1'){
    assert(!process.env.CAPACITY_FIXTURE,'Fresh retained histories cannot extend a supplied fixture');
    require('./retained-capacity-fixture.cjs').extend(fixtureData,{active:rooms*perRoom+5});
  }
  const stateWorkerPolicy=require('./capacity-worker-policy.cjs').workerPolicy(require('../../config/arena-state-workers.json'));
  const linkedLobby=Number(process.env.CAPACITY_LINKED_LOBBY||0);
  assert(Number.isInteger(linkedLobby)&&linkedLobby>=0&&linkedLobby<=4&&(!linkedLobby||realistic));
  if(realistic)require('./realistic-lobby-plan.cjs').detachLobby(fixtureData,rooms*perRoom,5,linkedLobby);
  fs.writeFileSync(fixture,JSON.stringify(fixtureData),{mode:0o600});
  const fixtureSha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(fixture)).digest('hex');
  const protocol=process.env.CAPACITY_PROTOCOL||require('../../public/shared/arena-wire').PROTOCOL;
  assert(['sferorumiya-state-v8','sferorumiya-state-v9','sferorumiya-state-v10'].includes(protocol),'Unsupported benchmark protocol');
  const summary={at:new Date().toISOString(),gameClock,rooms,perRoom,protocol,fixtureSha256,players:rooms*perRoom,lobby:5,phaseSeconds:30,mode:'database',
    scope:'Synthetic PostgreSQL schema and loopback WebSocket clients; no browser FPS or long-run guarantee',evidence:null};
  summary.stateWorkerPolicy={count:Number(stateWorkerPolicy.LOAD_STATE_WORKERS),maxRooms:Number(stateWorkerPolicy.LOAD_STATE_WORKER_ROOMS),source:'config/arena-state-workers.json'};
  summary.progressBackend=progressBackend.name;
  if(progressBackend.profileWorker){summary.profileWorker=true;summary.experimentalProgressBackend=true;}
  if(seed)summary.startingSeed=seed.proof;
  if(mixedMinutes)Object.assign(summary,{mixedMinutes,phaseSeconds:60});
  if(process.env.CAPACITY_ACTIVE_CLAN_QUESTS==='1')summary.requiresActiveClanQuests=true;
  if(fixtureData.summary?.retainedHistory)summary.retainedHistory={...fixtureData.summary.retainedHistory};
  if(process.env.CAPACITY_ALCHEMY==='1')Object.assign(summary,{alchemy:true,alchemyInventoryVersion:1});
  if(realistic)Object.assign(summary,{realistic:true,mixedSocial:true,scenario:{linkedLobby,movementHz:10,splitEverySeconds:3.7,feedEverySeconds:.7,
    boosterEverySeconds:2,emoteEverySeconds:5.3,lobbyIntervalMs:1500,syntheticFunds:true,
    notCovered:['real payment provider','external VK API','all seasonal events simultaneously','browser rendering']}});
  const run=path.join(out,'database-'+summary.players+'-'+Date.parse(summary.at));fs.mkdirSync(run,{mode:0o700});
  const stdout=fs.openSync(path.join(run,'stdout.txt'),'wx',0o600),stderr=fs.openSync(path.join(run,'stderr.txt'),'wx',0o600);
  const env={...process.env};
  // Old shell experiment flags must not silently change a production-parity run.
  for(const key of Object.keys(env))if(key.startsWith('LOAD_'))delete env[key];
  Object.assign(env,{LOAD_GAME_OFFSET_MS:String(gameClock.offsetMs),LOAD_PROTOCOL:protocol,LOAD_CLIENT:'0',LOAD_CAPACITY:'0',LOAD_COMBAT:'1',LOAD_ROOMS:String(rooms),LOAD_PLAYERS:String(perRoom),LOAD_REJOIN:'1',
      LOAD_PHASES:'move,split,feed,boosters,combined',LOAD_PHASE_MS:'30000',LOAD_JOURNAL:'1',LOAD_CONNECT_INTERVAL:'100',
      ...stateWorkerPolicy,LOAD_DRIVER_PER_ROOM:'1',LOAD_LOBBY:'5',LOAD_ALL_BOOSTERS:'1',LOAD_STOCK:'3000',LOAD_GC_METRICS:'1',
      LOAD_INCREMENTAL_SETTLEMENT:'1',LOAD_WORLD_FIXTURE:fixture,LOAD_DATABASE_CONFIG:privateConfig,LOAD_ACK_DIR:path.join(out,'acks')});
  if(mixedMinutes)Object.assign(env,{LOAD_PHASES:Array(mixedMinutes).fill('combined').join(','),LOAD_PHASE_MS:'60000'});
  Object.assign(env,progressBackend.environment);
  if(realistic)Object.assign(env,{LOAD_REALISTIC:'1',LOAD_MIXED_SOCIAL:'1',LOAD_LOBBY_INTERVAL:'1500'});
  if(summary.alchemy)Object.assign(env,{LOAD_ALCHEMY:'1',LOAD_EVENT:'ether-alchemy'});
  if(process.env.CAPACITY_DIAGNOSTICS==='1'){
    summary.diagnosticOnly=true;
    summary.diagnosticCaveat='Stage, CPU sampling and synchronous I/O probes add overhead; not a capacity acceptance run';
    Object.assign(env,{LOAD_STAGE_METRICS:'1',LOAD_PHYSICS_STAGES:'1',LOAD_CPU_PHASE:'combined',LOAD_SYNC_IO_PROBE:'1',LOAD_DISK_TIMING:'1'});
  }
  if(process.env.CAPACITY_WIRE_DIAGNOSTICS==='1'){
    summary.diagnosticOnly=true;
    summary.wireDiagnostics={fieldUnit:'UTF-8 bytes of JSON values',samplesPerPhasePerRoom:5,
      caveat:'Extra client serialization and bounded capture affect timing; not a capacity or A/B run.'};
    Object.assign(env,{LOAD_WIRE_DIAG:'1',LOAD_CAPTURE_WIRE:path.join(out,'wire')});
  }
  if(process.env.CAPACITY_QUEUE_DIAGNOSTICS==='1'){
    summary.diagnosticOnly=true;
    summary.queueDiagnostics='Bounded queue timeline and phase timings add overhead; not capacity acceptance.';
    Object.assign(env,{LOAD_QUEUE_TIMELINE:'1',LOAD_QUEUE_TIMING:'1'});
  }
  const child=fork(path.join(__dirname,'room-input-load.cjs'),[],{cwd:root,execArgv:['--max-old-space-size=2048'],env,
    stdio:['ignore',stdout,stderr,'ipc']});
  child.on('message',message=>{
    if(message.type!=='evidence')return;
    assert(path.basename(message.dir).startsWith('sferorumia-input-load-'));
    summary.evidence=message.dir;
    fs.writeFileSync(path.join(run,'running.json'),JSON.stringify({...summary,pid:child.pid},null,2),{mode:0o600});
  });
  const timer=setTimeout(()=>child.kill('SIGTERM'),Math.max(600000,mixedMinutes*60000+300000));timer.unref();
  try{Object.assign(summary,await new Promise((resolve,reject)=>{
    child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));
  }));}finally{clearTimeout(timer);fs.closeSync(stdout);fs.closeSync(stderr);}
  summary.endedAt=new Date().toISOString();
  for(const [key,file]of [['rows','results.json'],['databaseVerification','database-verification.json']])
    if(summary.evidence&&fs.existsSync(path.join(summary.evidence,file)))summary[key]=JSON.parse(fs.readFileSync(path.join(summary.evidence,file)));
  summary.assessment=require('./capacity-assessment.cjs').assessCapacity(summary.rows||[],summary);
  const summaryFile=path.join(run,'summary.json');
  fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n',{mode:0o600});
  if(summary.code===0&&summary.databaseVerification?.matched){
    summary.ackAudit=require('./audit-capacity.cjs').audit(out);
    // Preserve the durable-ACK result even if cleanup loses its connection.
    fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n',{mode:0o600});
    // Cleanup only this random test schema after both independent validations.
    const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
    const state=new PostgreSQLState({...source,schema});
    try{assert(/^heroether_test_[a-f0-9]{20}$/.test(schema));await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);}
    catch(error){
      summary.finalizationError={stage:'test-schema-cleanup',error:require('../../src/server/persistence/postgresql-config').safeError(error),
        ...(typeof error.code==='string'&&/^[A-Z0-9_]{2,50}$/.test(error.code)?{code:error.code}:{})};
      fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n',{mode:0o600});
      throw error;
    }
    finally{await state.close();}
    summary.testSchemaRemoved=true;
    fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n',{mode:0o600});
  }
  console.log(JSON.stringify({summary:summaryFile,assessment:summary.assessment,ackAudit:summary.ackAudit}));
  if(!summary.assessment.shortRunMeetsTargets)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{console.error(require('../../src/server/persistence/postgresql-config').safeError(error));process.exitCode=1;});
