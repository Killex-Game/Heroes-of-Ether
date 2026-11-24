"use strict";
const {createHash}=require('node:crypto');
const {canonical}=require('./state-snapshot');
const {documentSize}=require('./snapshot-size');
const {LIMIT}=require('./snapshot-documents');
const {canonicalKeys}=require('./canonical-key-order');
const open=Buffer.from('{'),close=Buffer.from('}'),comma=Buffer.from(',');
const prefixes=new Map();
const prefix=key=>{
  let bytes=prefixes.get(key);
  if(!bytes){bytes=Buffer.from(JSON.stringify(key)+':');if(prefixes.size<256)prefixes.set(key,bytes);}
  return bytes;
};
// A profile's immutable histories are already shared by the pinned reader.
// Retain their canonical bytes separately instead of cloning/encoding them
// again for every change to a sibling counter. Segments avoid a second full
// canonical world buffer. Only verified immutable records may use this cache.
function immutableRecord(id,value,format,cache,stats,{captureFields=false}={}){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const inserted=[];
  const remember=(item,encoded)=>{cache.set(item,encoded);inserted.push(item);};
  const segments=[open],keys=canonicalKeys(value),fields=captureFields?new Map():null;
  let size=5,bytes=2,first=true;
  for(const key of keys){
    const item=value[key];
    if(item===undefined)continue;
    let encoded;
    if(item&&typeof item==='object'){
      encoded=cache.get(item);
      if(encoded)stats.fieldReused++;
      else{
        if(key==='arenaReceipts'&&!Array.isArray(item)&&Object.values(item).every(bucket=>bucket&&typeof bucket==='object'&&!Array.isArray(bucket))){
          const chunks=[open];let chunkSize=5,chunkFirst=true;
          for(const bucketKey of canonicalKeys(item)){
            const bucket=item[bucketKey];
            let child=cache.get(bucket);
            if(child)stats.fieldReused++;
            else{child={json:Buffer.from(JSON.stringify(canonical(bucket))),size:documentSize(bucket)};remember(bucket,child);stats.fieldRebuilt++;}
            if(!chunkFirst)chunks.push(comma);chunkFirst=false;
            chunks.push(prefix(bucketKey),child.json);
            chunkSize+=1+Buffer.byteLength(bucketKey)+1+child.size;
          }
          chunks.push(close);encoded={segments:chunks,size:chunkSize};
        }else encoded={json:Buffer.from(JSON.stringify(canonical(item))),size:documentSize(item)};
        remember(item,encoded);stats.fieldRebuilt++;
      }
      size+=1+Buffer.byteLength(key)+1+encoded.size;
    }else{
      size+=documentSize({[key]:item})-5;
      encoded={json:Buffer.from(JSON.stringify(item))};
    }
    if(fields)fields.set(key,encoded);
    if(!first){segments.push(comma);bytes++;}first=false;
    const header=prefix(key);segments.push(header);bytes+=header.length;
    for(const chunk of encoded.segments||[encoded.json]){segments.push(chunk);bytes+=chunk.length;}
  }
  segments.push(close);
  const storedSize=documentSize({_id:id,value:{},hash:'0'.repeat(64)})-5+size;
  // Legacy format zero retains its established exceptional-size validation.
  // Fragmentable records retain immutable field segments even when large.
  if(format===0&&storedSize>14*1024*1024){
    // The fallback owns one complete canonical record. Do not also retain
    // freshly encoded field copies of an oversized fragmented profile.
    for(const item of inserted)cache.delete(item);
    return null;
  }
  const checksum=createHash('sha256');for(const segment of segments)checksum.update(segment);
  const valueHash=checksum.digest('hex');
  const parts=format===1&&storedSize>LIMIT
    ? require('./canonical-fragments').fragmentParts(id,segments,bytes,valueHash)
    : [{_id:id,hash:valueHash}];
  return {fingerprint:null,documentFormat:format,segments,bytes,fields,parts};
}
module.exports={immutableRecord};
