"use strict";
const {Pool}=require('pg'),{randomUUID}=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const {isDeepStrictEqual}=require('node:util');
const {unpack,hash}=require('./state-snapshot');
const {connection}=require('./postgresql-config');
const fail=code=>{throw Object.assign(Error(code),{code});};
function compatible(remote,local,sourceId){
 if(!remote||remote.version!==1||remote.sourceId!==sourceId)fail('PG_SOURCE_MISMATCH');
 if(local.revision<remote.revision)fail('PG_CLOUD_AHEAD');
 if(local.revision===remote.revision&&local.worldHash!==remote.worldHash)fail('PG_DIVERGED');
 if(local.chatRevision<(remote.chatRevision||0))fail('PG_CHAT_CLOUD_AHEAD');
 if(remote.chatHash&&local.chatRevision===remote.chatRevision&&local.chatHash!==remote.chatHash)fail('PG_CHAT_DIVERGED');
}
function encode(doc){return {_id:doc._id,value:gzipSync(Buffer.from(JSON.stringify(doc.value)),{level:1}),hash:doc.hash,chunked:!!doc.chunked};}
function decode(row){
 if(typeof row.id!=='string'||!Buffer.isBuffer(row.value)||!/^[a-f0-9]{64}$/.test(row.hash))fail('PG_CORRUPT_DOCUMENT');
 let value;try{value=JSON.parse(gunzipSync(row.value,{maxOutputLength:32*1024*1024}).toString('utf8'));}catch{fail('PG_CORRUPT_DOCUMENT');}
 if(hash(value)!==row.hash)fail('PG_CHECKSUM_FAILED');
 return {_id:row.id,value,hash:row.hash,...(row.chunked?{chunked:true}:{})};
}
function differences(previous,next){
 const writes=[],deletes=[];
 for(const [id,doc]of next.docs){const old=previous?.docs.get(id);if(old?.hash!==doc.hash||!!old.chunked!==!!doc.chunked)writes.push(encode(doc));}
 for(const id of previous?.docs.keys()||[])if(!next.docs.has(id))deletes.push(id);
 return {writes,deletes,payloadBytes:writes.reduce((n,d)=>n+d.value.length,0)};
}
function compact(snapshot){
 return {...snapshot,docs:new Map([...snapshot.docs].map(([id,doc])=>[id,{_id:id,hash:doc.hash,chunked:!!doc.chunked}]))};
}
class PostgreSQLState{
 constructor(config,{pool}={}){
  if(!/^heroether(?:_test_[a-z0-9_]+)?$/.test(config.schema||''))fail('PG_CONFIG');
  this.config=config;this.writer=config.writerId||randomUUID();this.pool=pool||new Pool(connection(config));
  this.pool.on?.('error',()=>{});
  this.table='"'+config.schema+'"';this.metrics=require('./database-metrics').observeDatabase();
  this.client={connect:()=>this.pool.query('SELECT 1'),close:()=>this.pool.end()};
 }
 async transaction(fn,{readOnly=false}={}){
  const c=await this.pool.connect();let broken=false;
  try{
   await c.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
   await c.query("SET LOCAL statement_timeout='20s'");await c.query("SET LOCAL lock_timeout='5s'");
   await c.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
   const result=await fn(c);await c.query('COMMIT');return result;
  }catch(e){try{await c.query('ROLLBACK');}catch{broken=true;}throw e;}finally{c.release(broken);}
 }
 async manifest(c,lock=false){
  return (await c.query(`SELECT document FROM ${this.table}.metadata WHERE id='state'${lock?' FOR UPDATE':''}`)).rows[0]?.document;
 }
 async read(){
  return this.metrics.run('read',async()=>{
   const {manifest,documents}=await this.transaction(async c=>{
    const manifest=await this.manifest(c);if(!manifest)fail('PG_NOT_INITIALIZED');
    const documents=[];let after='';
    for(;;){const rows=(await c.query(`SELECT id,value,hash,chunked FROM ${this.table}.state WHERE id>$1 ORDER BY id LIMIT 64`,[after])).rows;if(!rows.length)break;
     for(const row of rows)documents.push(decode(row));after=rows.at(-1).id;}
    return {manifest,documents};
   },{readOnly:true});
   return unpack(documents,manifest);
  });
 }
 async put(c,docs){
  for(let i=0;i<docs.length;i+=32){const batch=docs.slice(i,i+32),values=[];
   const tuples=batch.map((d,index)=>{values.push(d._id,d.value,d.hash,d.chunked);return '('+[1,2,3,4].map(n=>'$'+(index*4+n)).join(',')+')';});
   await c.query(`INSERT INTO ${this.table}.state(id,value,hash,chunked) VALUES ${tuples.join(',')} ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,hash=EXCLUDED.hash,chunked=EXCLUDED.chunked`,values);
  }
 }
 async initialize(snapshot){
  // A migration creates a new schema atomically and never overwrites one.
  const docs=[...snapshot.docs.values()].map(encode);
  const manifest={_id:'state',version:1,sourceId:this.config.sourceId,generation:1,revision:snapshot.revision,
   documentFormat:snapshot.documentFormat,chatFormat:snapshot.chatFormat,chatRevision:snapshot.chatRevision,
   chatHash:snapshot.chatHash,digest:snapshot.digest,worldHash:snapshot.worldHash,updatedAt:new Date().toISOString()};
  await this.transaction(async c=>{
   const exists=(await c.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[this.config.schema])).rows.length;
   if(exists)fail('PG_SCHEMA_NOT_EMPTY');
   await c.query(`CREATE SCHEMA ${this.table}`);
   await c.query(`CREATE TABLE ${this.table}.state(id text PRIMARY KEY,value bytea NOT NULL,hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),chunked boolean NOT NULL)`);
   await c.query(`CREATE TABLE ${this.table}.metadata(id text PRIMARY KEY CHECK(id='state'),document jsonb NOT NULL)`);
   await this.put(c,docs);
   await c.query(`INSERT INTO ${this.table}.metadata(id,document) VALUES('state',$1::jsonb)`,[JSON.stringify(manifest)]);
  });
  const verified=await this.read();if(verified.snapshot.digest!==snapshot.digest)fail('PG_CHECKSUM_FAILED');return verified;
 }
 async acquire(local){
  const remote=await this.read();compatible(remote.manifest,local,this.config.sourceId);
  const acquired=await this.transaction(async c=>{
   const current=await this.manifest(c,true);if(!isDeepStrictEqual(current,remote.manifest))fail('PG_CONCURRENT_WRITE');
   const now=Number((await c.query('SELECT extract(epoch from clock_timestamp())*1000 AS now')).rows[0].now);
   if(current.writer&&current.writer!==this.writer&&Date.parse(current.leaseUntil)>=now)fail('PG_WRITER_BUSY');
   const value={...current,writer:this.writer,leaseUntil:new Date(now+120000).toISOString()};
   await c.query(`UPDATE ${this.table}.metadata SET document=$1::jsonb WHERE id='state'`,[JSON.stringify(value)]);return value;
  });
  this.previous=compact(remote.snapshot);this.manifestValue=acquired;return {revision:acquired.revision,generation:acquired.generation};
 }
 prepare(next){compatible(this.manifestValue,next,this.config.sourceId);this.prepared={previous:this.previous,next,...differences(this.previous,next)};}
 async sync(next){
  if(this.pending&&this.pending.digest!==next.digest)await this.sync(this.pending);
  compatible(this.manifestValue,next,this.config.sourceId);this.pending=next;
  const batch=this.prepared?.previous===this.previous&&this.prepared.next===next?this.prepared:differences(this.previous,next);this.prepared=null;
  const base=this.manifestValue;
  const updated=await this.metrics.run('write',()=>this.transaction(async c=>{
   const current=await this.manifest(c,true);
   if(current?.sourceId!==this.config.sourceId||current.writer!==this.writer)fail('PG_WRITER_LOST');
   // Lost COMMIT acknowledgements must not replay a saved revision.
   if(current.generation===base.generation+1&&current.digest===next.digest&&current.revision===next.revision)return current;
   if(current.generation!==base.generation)fail('PG_CONCURRENT_WRITE');
   await this.put(c,batch.writes);
   if(batch.deletes.length)await c.query(`DELETE FROM ${this.table}.state WHERE id=ANY($1::text[])`,[batch.deletes]);
   const now=Number((await c.query('SELECT extract(epoch from clock_timestamp())*1000 AS now')).rows[0].now);
   const value={...base,generation:base.generation+1,revision:next.revision,documentFormat:next.documentFormat,
    chatFormat:next.chatFormat,chatRevision:next.chatRevision,chatHash:next.chatHash,digest:next.digest,
    worldHash:next.worldHash,updatedAt:new Date(now).toISOString(),writer:this.writer,leaseUntil:new Date(now+120000).toISOString()};
   await c.query(`UPDATE ${this.table}.metadata SET document=$1::jsonb WHERE id='state'`,[JSON.stringify(value)]);return value;
  }));
  this.previous=compact(next);this.manifestValue=updated;this.pending=null;
  return {revision:next.revision,generation:updated.generation,changedDocuments:batch.writes.length+batch.deletes.length,payloadBytes:batch.payloadBytes,syncedAt:Date.now()};
 }
 async close(){
  try{if(this.manifestValue)await this.transaction(async c=>{
   const current=await this.manifest(c,true);if(current?.writer!==this.writer)return;
   delete current.writer;delete current.leaseUntil;
   await c.query(`UPDATE ${this.table}.metadata SET document=$1::jsonb WHERE id='state'`,[JSON.stringify(current)]);
  });}finally{await this.pool.end();}
 }
}
module.exports={PostgreSQLState,encode,decode,differences,compatible};
