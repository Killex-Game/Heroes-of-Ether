"use strict";
const {randomUUID}=require('node:crypto');
// Count completed storage operations, without driver command events or payloads.
// monitorCommands is copied into connections at creation: toggling the client
// property later does not enable existing connections. Keep it disabled and
// observe the public collection operations used by this persistence owner.
function observeMongo(_client,now=Date.now){
  const counts={epoch:randomUUID(),read:0,write:0,failed:0};let active=false;
  const snapshot=()=>active?{...counts,at:now()}:null;
  snapshot.enable=value=>{if(active===!!value)return;active=!!value;Object.assign(counts,{epoch:randomUUID(),read:0,write:0,failed:0});};
  snapshot.run=(kind,operation)=>{
    if(!active||!['read','write'].includes(kind))return operation();
    const epoch=counts.epoch;
    const finish=failed=>{if(active&&counts.epoch===epoch)counts[failed?'failed':kind]++;};
    let result;try{result=operation();}catch(error){finish(true);throw error;}
    return Promise.resolve(result).then(value=>{finish(false);return value;},error=>{finish(true);throw error;});
  };
  const reads=new Set(['findOne','countDocuments','estimatedDocumentCount','distinct']);
  const writes=new Set(['insertOne','insertMany','updateOne','updateMany','replaceOne','deleteOne','deleteMany','findOneAndUpdate','findOneAndReplace','findOneAndDelete','bulkWrite']);
  snapshot.collection=collection=>{
    const methods=new Map();
    return new Proxy(collection,{get(target,key){
      const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      let cached=methods.get(key);if(cached?.original===value)return cached.call;
      const kind=reads.has(key)?'read':writes.has(key)?'write':null;
      const call=kind?function(...args){
        if(!active)return value.apply(target,args);
        return snapshot.run(kind,()=>value.apply(target,args));
      }:value.bind(target);
      methods.set(key,{original:value,call});return call;
    }});
  };
  return snapshot;
}
module.exports={observeMongo};
