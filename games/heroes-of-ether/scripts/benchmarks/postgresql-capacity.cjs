'use strict';
// Separate synthetic schema, temporary WAL, loopback-only clients. Never start
// this process against a production data directory or reuse its schema name.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fork}=require('node:child_process'),{randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
async function main(){
  const [configFile,output,roomText='1']=process.argv.slice(2),rooms=Number(roomText);
  if(!configFile||!output||!Number.isInteger(rooms)||rooms<1||rooms>3)
    throw Error('Usage: node scripts/benchmarks/postgresql-capacity.cjs CONFIG OUTPUT_DIRECTORY ROOMS(1..3)');
  let repository=root;
  for(let dir=root;path.dirname(dir)!==dir;dir=path.dirname(dir))
    if(fs.existsSync(path.join(dir,'.git'))){repository=dir;break;}
  const out=path.resolve(output),relative=path.relative(repository,out);
  if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))
    throw Error('Keep private benchmark output outside the game repository');
  if(fs.existsSync(out))throw Error('Output directory must be new');
  const source=JSON.parse(fs.readFileSync(path.resolve(configFile),'utf8'));
  const schema='heroether_test_'+randomBytes(10).toString('hex');
  fs.mkdirSync(out,{recursive:true,mode:0o700});
  const privateConfig=path.join(out,'postgresql.local.json');
  fs.writeFileSync(privateConfig,JSON.stringify({...source,schema}),{mode:0o600});
  const fixture=path.join(out,'synthetic-world.json');
  fs.writeFileSync(fixture,JSON.stringify(require('./database-room-fixture.cjs').createFixture()),{mode:0o600});
  const perRoom=require('../../config/arena-rooms.json').arenaCapacity;
  const summary={at:new Date().toISOString(),rooms,perRoom,players:rooms*perRoom,lobby:5,phaseSeconds:30,mode:'database',
    scope:'Synthetic PostgreSQL schema and loopback WebSocket clients; no browser FPS or long-run guarantee',evidence:null};
  const run=path.join(out,'database-'+summary.players+'-'+Date.parse(summary.at));fs.mkdirSync(run,{mode:0o700});
  const stdout=fs.openSync(path.join(run,'stdout.txt'),'wx',0o600),stderr=fs.openSync(path.join(run,'stderr.txt'),'wx',0o600);
  const env={...process.env};
  // Old shell experiment flags must not silently change a production-parity run.
  for(const key of Object.keys(env))if(key.startsWith('LOAD_'))delete env[key];
  Object.assign(env,{LOAD_CLIENT:'0',LOAD_CAPACITY:'0',LOAD_COMBAT:'1',LOAD_ROOMS:String(rooms),LOAD_PLAYERS:String(perRoom),LOAD_REJOIN:'1',
      LOAD_PHASES:'move,split,feed,boosters,combined',LOAD_PHASE_MS:'30000',LOAD_JOURNAL:'1',LOAD_CONNECT_INTERVAL:'100',
      LOAD_STATE_WORKERS:'3',LOAD_DRIVER_PER_ROOM:'1',LOAD_LOBBY:'5',LOAD_ALL_BOOSTERS:'1',LOAD_STOCK:'3000',LOAD_GC_METRICS:'1',
      LOAD_INCREMENTAL_SETTLEMENT:'1',LOAD_WORLD_FIXTURE:fixture,LOAD_DATABASE_CONFIG:privateConfig,LOAD_ACK_DIR:path.join(out,'acks')});
  if(process.env.CAPACITY_DIAGNOSTICS==='1')Object.assign(env,{LOAD_STAGE_METRICS:'1',LOAD_PHYSICS_STAGES:'1',LOAD_CPU_PHASE:'combined'});
  if(process.env.CAPACITY_WIRE_DIAGNOSTICS==='1'){
    summary.diagnosticOnly=true;
    summary.wireDiagnostics={fieldUnit:'UTF-8 bytes of JSON values',samplesPerPhasePerRoom:5,
      caveat:'Extra client serialization and bounded capture affect timing; not a capacity or A/B run.'};
    Object.assign(env,{LOAD_WIRE_DIAG:'1',LOAD_CAPTURE_WIRE:path.join(out,'wire')});
  }
  const child=fork(path.join(__dirname,'room-input-load.cjs'),[],{cwd:root,execArgv:['--max-old-space-size=2048'],env,
    stdio:['ignore',stdout,stderr,'ipc']});
  child.on('message',message=>{
    if(message.type!=='evidence')return;
    assert(path.basename(message.dir).startsWith('sferorumia-input-load-'));
    summary.evidence=message.dir;
    fs.writeFileSync(path.join(run,'running.json'),JSON.stringify({...summary,pid:child.pid},null,2),{mode:0o600});
  });
  const timer=setTimeout(()=>child.kill('SIGTERM'),600000);timer.unref();
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
    // Cleanup only this random test schema after both independent validations.
    const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
    const state=new PostgreSQLState({...source,schema});
    try{assert(/^heroether_test_[a-f0-9]{20}$/.test(schema));await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);}
    finally{await state.close();}
    summary.testSchemaRemoved=true;
    fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n',{mode:0o600});
  }
  console.log(JSON.stringify({summary:summaryFile,assessment:summary.assessment,ackAudit:summary.ackAudit}));
  if(!summary.assessment.shortRunMeetsTargets)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{console.error(require('../../src/server/persistence/postgresql-config').safeError(error));process.exitCode=1;});
