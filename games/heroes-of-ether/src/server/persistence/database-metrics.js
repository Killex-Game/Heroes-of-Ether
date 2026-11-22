"use strict";
const {randomUUID}=require('node:crypto');
// Count completed storage operations, without driver command events or payloads.
// Observe completed PostgreSQL transactions without exposing query payloads.
function observeDatabase(_client,now=Date.now){
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
  return snapshot;
}
module.exports={observeDatabase};
