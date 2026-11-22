"use strict";
// Stream compressed documents without materializing several copies of the world.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {decode}=require('./postgresql-state'),{hash,unpack}=require('./state-snapshot');
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Object.assign(Error('PG_BACKUP_CORRUPT'),{code:'PG_BACKUP_CORRUPT'});};
const durable=(file,bytes)=>{const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const digest=rows=>hash(rows.map(r=>[r.id,r.hash]).sort(([a],[b])=>a.localeCompare(b)));
function summary(index){return {ok:true,backend:'postgresql',format:index.format,revision:index.manifest.revision,generation:index.manifest.generation,digest:index.manifest.digest,storageDigest:index.manifest.digest,snapshotHash:index.manifest.worldHash,documents:index.rows.length,profiles:index.rows.filter(r=>r.id.startsWith('profiles:')).length,clans:index.rows.filter(r=>r.id.startsWith('clans:')).length,updatedAt:index.manifest.updatedAt};}
async function exportSnapshot(state,destination){
 fs.mkdirSync(destination,{mode:0o700});
 const index=await state.transaction(async c=>{
  const manifest=await state.manifest(c);if(!manifest||manifest.version!==1||manifest.sourceId!==state.config.sourceId)fail();
  const rows=[];let after='';
  for(;;){const page=(await c.query(`SELECT id,value,hash,chunked FROM ${state.table}.state WHERE id>$1 ORDER BY id LIMIT 32`,[after])).rows;if(!page.length)break;
   for(const row of page){decode(row);const file=sha(row.id)+'.gz';durable(path.join(destination,file),row.value);rows.push({id:row.id,hash:row.hash,chunked:row.chunked,file,sha256:sha(row.value)});}after=page.at(-1).id;
  }
  if(digest(rows)!==manifest.digest)fail();return {format:'postgresql-documents-v1',manifest,rows};
 },{readOnly:true});
 durable(path.join(destination,'postgresql-backup.json'),JSON.stringify(index));
 if(process.platform!=='win32'){const fd=fs.openSync(destination,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 return verifySnapshot(destination);
}
function visit(directory,visitor){
 const indexFile=path.join(directory,'postgresql-backup.json');if(fs.lstatSync(directory).isSymbolicLink()||fs.lstatSync(indexFile).isSymbolicLink())fail();
 const index=JSON.parse(fs.readFileSync(indexFile,'utf8'));
 if(index.format!=='postgresql-documents-v1'||index.manifest?.version!==1||!Array.isArray(index.rows)||!index.rows.length)fail();
 if(new Set(index.rows.map(r=>r.id)).size!==index.rows.length||new Set(index.rows.map(r=>r.file)).size!==index.rows.length||fs.readdirSync(directory).length!==index.rows.length+1)fail();
 for(const row of index.rows){
  if(typeof row.id!=='string'||row.file!==sha(row.id)+'.gz'||typeof row.chunked!=='boolean')fail();
  const file=path.join(directory,row.file);if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size>34*1024*1024)fail();
  const value=fs.readFileSync(file);if(sha(value)!==row.sha256)fail();const doc=decode({...row,value});visitor?.(doc);
 }
 if(digest(index.rows)!==index.manifest.digest)fail();return index;
}
function verifySnapshot(directory){return summary(visit(directory));}
function loadSnapshot(directory){const documents=[];const index=visit(directory,doc=>documents.push(doc));return unpack(documents,index.manifest);}
module.exports={exportSnapshot,verifySnapshot,loadSnapshot};
