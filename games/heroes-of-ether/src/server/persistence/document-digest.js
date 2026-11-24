'use strict';
const {createHash}=require('node:crypto');
// Snapshot documents expose only a string ID and a SHA string here. Reusing
// their private pairs avoids rebuilding/canonicalizing a second manifest tree.
// Input order is checked too: localeCompare ties must retain Map insertion order.
class DocumentDigest {
  constructor(){this.inputIds=null;this.sortedIds=[];this.pairs=[];this.records=new WeakMap();this.lastHash=null;}
  digest(docs){
    let sameOrder=docs.size===this.inputIds?.length,index=0;
    if(sameOrder)for(const id of docs.keys())if(id!==this.inputIds[index++]){sameOrder=false;break;}
    if(!sameOrder){
      this.inputIds=[...docs.keys()];this.sortedIds=this.inputIds.slice().sort((a,b)=>a.localeCompare(b));this.pairs=[];
    }
    let unchanged=sameOrder&&this.lastHash!==null;
    for(let i=0;i<this.sortedIds.length;i++){
      const id=this.sortedIds[i],doc=docs.get(id),hash=doc.hash;
      let record=this.records.get(doc);
      if(!record||record.id!==id||record.hash!==hash){record={id,hash,pair:[id,hash]};this.records.set(doc,record);}
      if(this.pairs[i]!==record.pair){unchanged=false;this.pairs[i]=record.pair;}
    }
    if(!unchanged)this.lastHash=createHash('sha256').update(JSON.stringify(this.pairs)).digest('hex');
    return this.lastHash;
  }
}
module.exports={DocumentDigest};
