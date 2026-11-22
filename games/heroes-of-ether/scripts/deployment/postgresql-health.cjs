"use strict";
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {loadConfig,connection,safeError}=require('../../src/server/persistence/postgresql-config');
const {syncHealth}=require('../../src/server/persistence/database-health');
(async()=>{
 if(process.argv.slice(2).some(arg=>arg!=='--database'))throw Object.assign(Error('Invalid arguments'),{code:'PG_COMMAND'});
 const root=path.resolve(__dirname,'../..'),config=loadConfig(root);if(!config){console.log(JSON.stringify({enabled:false}));return;}
 const file=path.join(root,'data/postgresql-status.json'),local=syncHealth(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null,Date.now(),config.intervalMs);
 const report={enabled:true,backend:'postgresql',local};
 if(process.argv.includes('--database')){
  const client=new(require('pg').Client)(connection(config));
  try{await client.connect();const started=performance.now(),result=await client.query('SELECT document FROM "'+config.schema+'".metadata WHERE id=$1',['state']);report.database={reachable:true,pingMs:Math.round(performance.now()-started),revision:result.rows[0]?.document.revision};}
  catch(error){report.database={reachable:false,error:safeError(error)};}finally{await client.end();}
 }
 console.log(JSON.stringify(report,null,2));if(local.state!=='ok'||report.database?.reachable===false)process.exitCode=2;
})().catch(error=>{console.error(safeError(error));process.exitCode=1;});
