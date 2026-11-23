'use strict';
// Uses one reusable synthetic world for both variants. No live profiles are
// loaded and no production schema, admission limit or gameplay option is edited.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),{fork}=require('child_process');
const root=path.resolve(__dirname,'../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(fixtureFile){
 if(!fs.existsSync(fixtureFile)){
  const f=require('./database-room-fixture.cjs').createFixture(),op=require('../../src/server/profiles/operation-receipts');
  f.data.version=Math.max(14,f.data.version);
  // Active players have a retained operation history comparable to the larger
  // observed profiles. Tokens and records are synthetic, no owner data copied.
  for(const token of f.tokens.slice(0,40)){
   const p=f.data.profiles[sha(token)];
   assert(p,'Synthetic token must resolve');const buckets={};
   for(let n=0;n<15000;n++){const id='history-fixture-'+String(n).padStart(8,'0');(buckets[op.bucketFor(id)]||={})[id]='synthetic-completed-cast';}
   p.arenaReceipts=buckets;op.validate(p,f.data.version);
  }
  f.summary.arenaReceiptProfiles=40;f.summary.arenaReceiptsPerProfile=15000;
  fs.writeFileSync(fixtureFile,JSON.stringify(f),{flag:'wx',mode:0o600});
 }
 const bytes=fs.readFileSync(fixtureFile),f=JSON.parse(bytes);
 assert.equal(f.summary.arenaReceiptProfiles,40);assert.equal(f.summary.arenaReceiptsPerProfile,15000);
 assert.equal(Object.keys(f.data.profiles).length,1280);assert(Object.values(f.data.profiles).every(p=>p.testFixture==='database-capacity-20261110'));
 return {sha256:sha(bytes),bytes:bytes.length};
}
async function main(){
 const [configFile,fixtureFile,output]=process.argv.slice(2);
 if(!configFile||!fixtureFile||!output)throw Error('Usage: profile-history-capacity.cjs CONFIG SHARED_SYNTHETIC_FIXTURE NEW_OUTPUT');
 assert(path.isAbsolute(output)&&!output.startsWith(root+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{mode:0o700,recursive:true});
 const fixtureProof=fixture(fixtureFile),source=JSON.parse(fs.readFileSync(configFile)),schema='heroether_test_'+crypto.randomBytes(10).toString('hex');
 const config=path.join(output,'postgresql.local.json');fs.writeFileSync(config,JSON.stringify({...source,schema}),{mode:0o600});
 const summary={at:new Date().toISOString(),rooms:1,players:35,lobby:5,phaseSeconds:30,mode:'database',mixedSocial:true,fixture:fixtureProof,cpuQuota:3,
  scope:'35 arena and 5 active lobby clients on synthetic retained histories, five short phases, same host as live game; not maximum CCU',evidence:null};
 const run=path.join(output,'database-35-'+Date.parse(summary.at));fs.mkdirSync(run);
 const stdout=fs.openSync(run+'/stdout.txt','wx'),stderr=fs.openSync(run+'/stderr.txt','wx'),env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('LOAD_'))delete env[key];
 Object.assign(env,{LOAD_CLIENT:'0',LOAD_CAPACITY:'0',LOAD_COMBAT:'1',LOAD_ROOMS:'1',LOAD_PLAYERS:'35',LOAD_REJOIN:'1',LOAD_PHASES:'move,split,feed,boosters,combined',LOAD_PHASE_MS:'30000',LOAD_JOURNAL:'1',LOAD_CONNECT_INTERVAL:'100',LOAD_STATE_WORKERS:'3',LOAD_DRIVER_PER_ROOM:'1',LOAD_LOBBY:'5',LOAD_ALL_BOOSTERS:'1',LOAD_STOCK:'3000',LOAD_GC_METRICS:'1',LOAD_INCREMENTAL_SETTLEMENT:'1',LOAD_MIXED_SOCIAL:'1',LOAD_LOBBY_INTERVAL:'1500',LOAD_WORLD_FIXTURE:fixtureFile,LOAD_DATABASE_CONFIG:config,LOAD_ACK_DIR:output+'/acks'});
 const child=fork(__dirname+'/room-input-load.cjs',[],{cwd:root,execArgv:['--max-old-space-size=2048'],env,stdio:['ignore',stdout,stderr,'ipc']});
 child.on('message',m=>{if(m.type==='evidence'){summary.evidence=m.dir;fs.writeFileSync(run+'/running.json',JSON.stringify({...summary,pid:child.pid}));}});
 const timer=setTimeout(()=>child.kill('SIGTERM'),600000);timer.unref();
 try{Object.assign(summary,await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}));}
 finally{clearTimeout(timer);fs.closeSync(stdout);fs.closeSync(stderr);}
 summary.endedAt=new Date().toISOString();
 for(const [key,file]of [['rows','results.json'],['databaseVerification','database-verification.json']])if(summary.evidence&&fs.existsSync(summary.evidence+'/'+file))summary[key]=JSON.parse(fs.readFileSync(summary.evidence+'/'+file));
 summary.assessment=require('./capacity-assessment.cjs').assessCapacity(summary.rows||[],summary);
 const report=run+'/summary.json';fs.writeFileSync(report,JSON.stringify(summary,null,2));
 if(summary.code===0&&summary.databaseVerification?.matched){
  summary.ackAudit=require('./audit-capacity.cjs').audit(output);
  const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state'),state=new PostgreSQLState({...source,schema});
  try{assert(/^heroether_test_[a-f0-9]{20}$/.test(schema));await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);}finally{await state.close();}
  summary.testSchemaRemoved=true;fs.writeFileSync(report,JSON.stringify(summary,null,2));
 }
 assert.equal(sha(fs.readFileSync(fixtureFile)),fixtureProof.sha256,'Fixture changed');
 console.log(JSON.stringify({report,assessment:summary.assessment,ackAudit:summary.ackAudit}));
 if(!summary.assessment.shortRunMeetsTargets)process.exitCode=2;
}
module.exports={fixture};
if(require.main===module)main().catch(e=>{console.error(require('../../src/server/persistence/postgresql-config').safeError(e));process.exitCode=1;});
