"use strict";
const path=require('node:path');
const {loadConfig,safeError}=require('../../src/server/persistence/postgresql-config');
const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state');
const backup=require('../../src/server/persistence/postgresql-backup');
(async()=>{
 const [command,destination]=process.argv.slice(2);if(!['export','verify'].includes(command)||!destination)throw Object.assign(Error('Usage: postgresql-backup.cjs export|verify DIRECTORY'),{code:'PG_COMMAND'});
 if(command==='verify'){console.log(JSON.stringify(backup.verifySnapshot(path.resolve(destination))));return;}
 const config=loadConfig(path.resolve(__dirname,'../..'));if(!config)throw Object.assign(Error('Missing PostgreSQL config'),{code:'PG_CONFIG'});
 const state=new PostgreSQLState(config);try{console.log(JSON.stringify({...await backup.exportSnapshot(state,path.resolve(destination)),database:config.database}));}finally{await state.close();}
})().catch(error=>{console.error(safeError(error));process.exitCode=1;});
