'use strict';
const {createHash}=require('node:crypto');
const {documentSize}=require('./snapshot-size');
const TABLES=['clans','achievementCounts','messageReceipts'];
const PREFIX='auxchat:',MAX_BYTES=2*1024*1024;
const invalid=()=>{throw Object.assign(Error('Invalid chat snapshot'),{code:'DATABASE_INVALID_CHAT_SNAPSHOT'});};
function packChat(chat,add){
  if(!chat||typeof chat!=='object'||Array.isArray(chat))return invalid();
  const root={...chat};
  for(const table of TABLES){
    if(!Object.hasOwn(chat,table))continue;
    const values=chat[table];if(!values||typeof values!=='object'||Array.isArray(values))return invalid();
    root[table]={};
    const buckets=new Map();
    for(const [key,value]of Object.entries(values)){
      const digest=createHash('sha256').update(key).digest('hex'),prefix=digest.slice(0,2);
      if(!buckets.has(prefix))buckets.set(prefix,[]);
      buckets.get(prefix).push({key,value,digest});
    }
    function emit(prefix,rows){
      const value=Object.fromEntries(rows.map(r=>[r.key,r.value]));
      if(documentSize(value)<=MAX_BYTES){add(PREFIX+table+':'+prefix,value);return;}
      if(prefix.length>=64)return invalid();
      const children=new Map();for(const row of rows){const p=row.digest.slice(0,prefix.length+1);
        if(!children.has(p))children.set(p,[]);children.get(p).push(row);}
      for(const [p,group]of children)emit(p,group);
    }
    for(const [prefix,rows]of buckets)emit(prefix,rows);
  }
  add('aux:clan-chat.json',root);
}
function restoreChat(auxiliary,shards){
  if(!shards.length)return;
  const source=auxiliary['clan-chat.json'];if(!source)return invalid();
  const chat={...source};
  for(const table of TABLES)if(Object.hasOwn(source,table))chat[table]={...source[table]};
  for(const {id,value}of shards){
    const match=/^auxchat:(clans|achievementCounts|messageReceipts):([a-f0-9]{2,64})$/.exec(id);
    if(!match||!chat[match[1]]||!value||typeof value!=='object'||Array.isArray(value))return invalid();
    const target=chat[match[1]];
    for(const [key,row]of Object.entries(value)){
      if(Object.hasOwn(target,key)||!createHash('sha256').update(key).digest('hex').startsWith(match[2]))return invalid();
      Object.defineProperty(target,key,{value:row,writable:true,enumerable:true,configurable:true});
    }
  }
  auxiliary['clan-chat.json']=chat;
}
module.exports={packChat,restoreChat,PREFIX};
