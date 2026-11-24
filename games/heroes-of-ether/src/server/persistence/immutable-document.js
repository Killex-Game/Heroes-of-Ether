"use strict";
const {createHash}=require('node:crypto');
const {canonical}=require('./state-snapshot');
const {documentSize}=require('./snapshot-size');
const {LIMIT}=require('./snapshot-documents');
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
function immutableRecord(id,value,format,cache,stats){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const segments=[open],keys=Object.keys(Object.fromEntries(Object.keys(value).sort().map(key=>[key,0])));
  let size=5,bytes=2,first=true;
  for(const key of keys){
    const item=value[key];
    if(item===undefined||typeof item==='function'||typeof item==='symbol')continue;
    let encoded;
    if(item&&typeof item==='object'){
      encoded=cache.get(item);
      if(encoded)stats.fieldReused++;
      else{
        encoded={json:Buffer.from(JSON.stringify(canonical(item))),size:documentSize(item)};
        cache.set(item,encoded);stats.fieldRebuilt++;
      }
      size+=1+Buffer.byteLength(key)+1+encoded.size;
    }else{
      encoded={json:Buffer.from(JSON.stringify(item))};
      size+=documentSize({[key]:item})-5;
    }
    if(!first){segments.push(comma);bytes++;}first=false;
    const header=prefix(key);segments.push(header,encoded.json);bytes+=header.length+encoded.json.length;
  }
  segments.push(close);
  const storedSize=documentSize({_id:id,value:{},hash:'0'.repeat(64)})-5+size;
  // Preserve the exact existing fragmentation algorithm and exceptional-size
  // validation. Large records use the established implementation unchanged.
  if(storedSize>(format===0?14*1024*1024:LIMIT))return null;
  const checksum=createHash('sha256');for(const segment of segments)checksum.update(segment);
  return {fingerprint:null,documentFormat:format,segments,bytes,parts:[{_id:id,hash:checksum.digest('hex')}]};
}
module.exports={immutableRecord};
