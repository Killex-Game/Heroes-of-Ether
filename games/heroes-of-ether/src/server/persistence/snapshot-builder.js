"use strict";
const {createHash}=require('node:crypto');
const {canonical,hash,AUXILIARY}=require('./state-snapshot');
const {REVISION}=require('../profiles/profile-journal');
const storage=require('./snapshot-documents');
const chat=require('./snapshot-chat');
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw Object.assign(Error(code),{code});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
// Object enumeration places integer keys before other sorted keys. Keep the
// same ordering as canonical(), including unusual profile IDs and root keys.
const keys=value=>Object.keys(Object.fromEntries(Object.keys(value).sort().map(key=>[key,0])));

function recordFor(id,value,documentFormat,fingerprint){
  const ordered=canonical(value),json=Buffer.from(JSON.stringify(ordered));
  const docs=new Map();storage.store(id,ordered,docs,documentFormat);
  let offset=0;
  const parts=[];
  for(const doc of docs.values()){
    const part={_id:doc._id,hash:doc.hash};
    if(doc.chunked){part.chunked=true;part.descriptor=JSON.stringify(doc.value);}
    else if(doc._id!==id){part.start=offset;offset+=Buffer.byteLength(doc.value);part.end=offset;}
    parts.push(part);
  }
  return {fingerprint,documentFormat,json,parts};
}
function documentFor(record,part){
  const doc={_id:part._id,hash:part.hash};
  if(part.chunked)doc.chunked=true;
  // Keep canonical bytes outside the JS object heap. PostgreSQL materializes
  // values only for changed documents. Getters cannot expose the cached buffer
  // or let callers mutate an acknowledged record used by a later snapshot.
  Object.defineProperty(doc,'value',{enumerable:true,get(){
    if(part.descriptor)return JSON.parse(part.descriptor);
    if(part.start!==undefined)return record.json.toString('utf8',part.start,part.end);
    return JSON.parse(record.json.toString('utf8'));
  }});
  return Object.freeze(doc);
}
class SnapshotBuilder{
  constructor({immutableSource=null}={}){this.records=new Map();this.stats=null;this.immutableSource=immutableSource;this.identities=null;}
  pack(world,auxiliary={}, {chatFormat=1,documentFormat=1}={}){
    if(!object(world)||!object(world.profiles)||!object(world.clans))fail('DATABASE_INVALID_SNAPSHOT');
    const revision=world[REVISION]||0;
    if(!Number.isSafeInteger(revision)||revision<0)fail('DATABASE_INVALID_REVISION');
    if(documentFormat!==0&&documentFormat!==1)fail('DATABASE_INVALID_DOCUMENT_FORMAT');
    if(chatFormat!==0&&chatFormat!==1)fail('DATABASE_INVALID_CHAT_FORMAT');
    const immutable=this.immutableSource?.owns(world)===true;
    const identities=immutable?new WeakMap():null;
    const docs=new Map(),next=new Map(),stats={reused:0,rebuilt:0,bytes:0,identityReused:0};
    const add=(id,value,owned=false)=>{
      // Only the verified pinned reader can share record identities: it owns
      // this complete world and detaches every changed WAL ancestor. Generic
      // callers, auxiliary files and future mutable sources still inspect bytes.
      let record=this.records.get(id);
      const identity=immutable&&owned&&value&&typeof value==='object';
      if(identity&&record&&this.identities?.get(value)===record&&record.documentFormat===documentFormat){
        stats.reused++;stats.identityReused++;
      }else{
        const fingerprint=digest(JSON.stringify(value));
        if(record?.fingerprint===fingerprint&&record.documentFormat===documentFormat)stats.reused++;
        else{record=recordFor(id,value,documentFormat,fingerprint);stats.rebuilt++;}
      }
      if(identity)identities.set(value,record);
      next.set(id,record);stats.bytes+=record.json.length;
      for(const part of record.parts)docs.set(part._id,documentFor(record,part));
    };
    for(const table of ['profiles','clans'])
      for(const [key,value]of Object.entries(world[table]))add(`${table}:${key}`,value,true);
    add('world',Object.fromEntries(Object.entries(world).filter(([key])=>!['profiles','clans'].includes(key))));
    for(const file of AUXILIARY)if(Object.hasOwn(auxiliary,file)){
      if(file==='clan-chat.json'&&chatFormat===1)chat.packChat(auxiliary[file],add);
      else add(`aux:${file}`,auxiliary[file]);
    }
    const chatRevision=auxiliary['clan-chat.json']?.[REVISION]||0;
    if(!Number.isSafeInteger(chatRevision)||chatRevision<0)fail('DATABASE_INVALID_CHAT_REVISION');
    // Stream the exact legacy canonical JSON into SHA-256, without allocating
    // another complete world tree or a giant UTF-16 world string.
    const root=JSON.parse(next.get('world').json.toString('utf8'));
    const checksum=createHash('sha256');checksum.update('{');let first=true;
    for(const key of keys(world)){
      if(key!=='profiles'&&key!=='clans'&&!Object.hasOwn(root,key))continue;
      if(!first)checksum.update(',');first=false;
      checksum.update(JSON.stringify(key)+':');
      if(key==='profiles'||key==='clans'){
        checksum.update('{');let firstRow=true;
        for(const id of keys(world[key])){
          if(!firstRow)checksum.update(',');firstRow=false;
          checksum.update(JSON.stringify(id)+':');checksum.update(next.get(`${key}:${id}`).json);
        }
        checksum.update('}');
      }else checksum.update(JSON.stringify(root[key]));
    }
    checksum.update('}');
    const snapshot={docs,revision,documentFormat,chatFormat,chatRevision,
      chatHash:hash(auxiliary['clan-chat.json']||null),worldHash:checksum.digest('hex'),
      digest:hash([...docs].map(([id,doc])=>[id,doc.hash]).sort(([a],[b])=>a.localeCompare(b)))};
    // Publish cache replacements only after the entire snapshot validates.
    // Earlier snapshots retain their own bytes across retries and removals.
    this.records=next;this.identities=identities;this.stats=stats;return snapshot;
  }
}
module.exports={SnapshotBuilder};
