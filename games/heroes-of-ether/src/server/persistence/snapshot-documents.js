"use strict";
// Storage-only fragmentation. Gameplay keeps the exact logical profile and
// every receipt; all fragments and the manifest commit in the same transaction.
const {documentSize}=require('./snapshot-size');
const { createHash } = require("node:crypto");
const PREFIX = "chunk:", LIMIT = 8 * 1024 * 1024, CHARS = 512 * 1024;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const invalid = () => { throw Object.assign(Error("Invalid document fragments"), {code:"DATABASE_INVALID_DOCUMENT_FRAGMENTS"}); };
function store(id, value, docs, format) {
  const doc = { _id:id, value, hash:hash(value) };
  const bytes = documentSize(doc);
  if (format === 0 || bytes <= LIMIT) {
    if(bytes > 14*1024*1024)throw Object.assign(Error("DATABASE_DOCUMENT_TOO_LARGE"),{code:"DATABASE_DOCUMENT_TOO_LARGE"});
    docs.set(id,doc);return;
  }
  const json = JSON.stringify(value), prefix = PREFIX + Buffer.from(id).toString("base64url") + ":";
  let count = 0;
  for(let start=0;start<json.length;) {
    let end=Math.min(start+CHARS,json.length);
    // Stored strings use UTF-8. Never split a surrogate pair in half.
    if(end<json.length && /[\uD800-\uDBFF]/.test(json[end-1]))end--;
    const part=json.slice(start,end), key=prefix+count++;
    docs.set(key,{_id:key,value:part,hash:hash(part)});start=end;
  }
  const descriptor={count,hash:doc.hash};
  docs.set(id,{_id:id,value:descriptor,hash:hash(descriptor),chunked:true});
}
function restore(documents,format) {
  if(format!==0&&format!==1)return invalid();
  const ids=new Map();
  for(const doc of documents) {
    if(typeof doc._id!=="string"||ids.has(doc._id))return invalid();
    ids.set(doc._id,doc);
  }
  const used=new Set(),logical=[];
  for(const doc of documents) {
    if(doc._id.startsWith(PREFIX))continue;
    if(!doc.chunked){logical.push(doc);continue;}
    const {count,hash:expected}=doc.value||{};
    if(format!==1||!Number.isSafeInteger(count)||count<1||count>documents.length||typeof expected!=="string")return invalid();
    const prefix=PREFIX+Buffer.from(doc._id).toString("base64url")+":";
    const parts=[];
    for(let i=0;i<count;i++) {
      const key=prefix+i,part=ids.get(key);
      if(!part||typeof part.value!=="string"||part.chunked||used.has(key))return invalid();
      used.add(key);parts.push(part.value);
    }
    let value;try{value=JSON.parse(parts.join(""));}catch(_){return invalid();}
    if(hash(value)!==expected)return invalid();
    logical.push({_id:doc._id,value,hash:expected});
  }
  for(const id of ids.keys())if(id.startsWith(PREFIX)&&!used.has(id))return invalid();
  return logical;
}
module.exports={store,restore,PREFIX,LIMIT};
