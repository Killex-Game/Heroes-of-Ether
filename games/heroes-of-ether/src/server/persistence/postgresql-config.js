"use strict";
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util');
const fail=()=>{throw Object.assign(Error('Invalid PostgreSQL configuration'),{code:'PG_CONFIG'});};
function loadConfig(root){
 const file=path.join(root,'config/postgresql.local.json');if(!fs.existsSync(file))return null;
 const c=JSON.parse(fs.readFileSync(file,'utf8'));if(!c.enabled)return null;
 if(!path.isAbsolute(c.credentialsFile||'')||!path.isAbsolute(c.caFile||'')||
   typeof c.host!=='string'||!c.host||!Number.isInteger(c.port)||c.port<1||c.port>65535||
   !/^[a-zA-Z0-9_-]{1,63}$/.test(c.database||'')||!/^heroether(?:_test_[a-z0-9_]+)?$/.test(c.schema||'')||
   !/^[0-9a-f-]{36}$/.test(c.sourceId||''))fail();
 return {...c,backend:'postgresql',intervalMs:30000};
}
function connection(c){
 const e=parseEnv(fs.readFileSync(c.credentialsFile,'utf8'));if(!e.PGUSER||!e.PGPASSWORD)fail();
 return {host:c.host,port:c.port,database:c.database,user:e.PGUSER,password:e.PGPASSWORD,
   ssl:{ca:fs.readFileSync(c.caFile,'utf8'),rejectUnauthorized:true},max:2,idleTimeoutMillis:60000,
   connectionTimeoutMillis:10000,statement_timeout:20000,application_name:'HeroEther-persistence'};
}
function safeError(error){
 const code=error?.code;if(typeof code==='string'&&/^(?:PG|DATABASE)_[A-Z_0-9]{1,45}$/.test(code))return code;
 if(code==='28P01')return 'PG_AUTH_FAILED';if(code==='42501')return 'PG_PERMISSION_DENIED';
 if(code==='57014')return 'PG_QUERY_TIMEOUT';if(code==='3D000')return 'PG_DATABASE_MISSING';
 if(['ECONNREFUSED','ETIMEDOUT','ENOTFOUND','ECONNRESET'].includes(code))return 'PG_CONNECTION_FAILED';
 return 'PG_OPERATION_FAILED';
}
module.exports={loadConfig,connection,safeError};
