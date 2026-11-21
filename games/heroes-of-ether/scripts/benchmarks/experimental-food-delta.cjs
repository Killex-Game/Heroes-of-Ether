/* Isolated transport probe; authoritative mechanics never read these tables. */
"use strict";
const threads = require('node:worker_threads');
class FoodDeltaEncoder {
  constructor(){this.rooms=new Map();}
  pack(job){
    const transfer=[];
    const rooms=job.rooms.map(room=>{
      let prior=this.rooms.get(room.id)||new Map();
      const states=room.states.map(group=>{
        const rows=group.snapshot.ether;
        if(!Array.isArray(rows))return group;
        const next=new Map(), added=[], removed=[], ids=[], moved=new Float64Array(rows.length*3);
        let used=0;
        for(let i=0;i<rows.length;i++){
          const row=rows[i],old=prior.get(row.id);
          const {x,y,...meta}=row, text=JSON.stringify(meta);
          ids.push(row.id);
          if(!old||old.meta!==text)added.push(row);
          else if(old.x!==x||old.y!==y){moved[used++]=i;moved[used++]=x;moved[used++]=y;}
          next.set(row.id,{meta:text,x,y});
        }
        for(const id of prior.keys())if(!next.has(id))removed.push(id);
        prior=next;
        transfer.push(moved.buffer);
        return {...group,snapshot:{...group.snapshot,ether:undefined},foodDelta:{ids,added,removed,moved,used}};
      });
      this.rooms.set(room.id,prior);
      return {...room,states};
    });
    return [{...job,rooms,foodDeltaTransfer:true},transfer];
  }
}
class FoodDeltaDecoder {
 constructor(){this.rooms=new Map();}
 unpack(job){
  if(!job.foodDeltaTransfer)return job;
  delete job.foodDeltaTransfer;
  for(const room of job.rooms){
   let rows=this.rooms.get(room.id);if(!rows)this.rooms.set(room.id,rows=new Map());
   for(const group of room.states){const d=group.foodDelta;if(!d)continue;
    for(const id of d.removed)rows.delete(id);
    for(const row of d.added)rows.set(row.id,row);
    for(let i=0;i<d.used;i+=3){const id=d.ids[d.moved[i]];rows.set(id,{...rows.get(id),x:d.moved[i+1],y:d.moved[i+2]});}
    group.snapshot.ether=d.ids.map(id=>rows.get(id));delete group.foodDelta;
   }
  }
  return job;
 }
}
if(process.env.LOAD_FOOD_DELTA==='1'){
 if(threads.isMainThread){const send=threads.Worker.prototype.postMessage,encoders=new WeakMap();
  threads.Worker.prototype.postMessage=function(job,transfers){if(!job.rooms||!job.id)return send.call(this,job,transfers);
   let encoder=encoders.get(this);if(!encoder)encoders.set(this,encoder=new FoodDeltaEncoder());
   return send.call(this,...encoder.pack(job));};
 }else if(threads.parentPort){const on=threads.parentPort.on,decoder=new FoodDeltaDecoder();
  threads.parentPort.on=function(name,listener){return name==='message'?on.call(this,name,job=>listener(decoder.unpack(job))):on.call(this,name,listener);};
 }
}
module.exports={FoodDeltaEncoder,FoodDeltaDecoder};
