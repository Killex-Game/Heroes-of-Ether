/* Isolated lossless worker transport probe. No game mechanics or network changes. */
"use strict";
const threads = require("node:worker_threads");
const partKeys = ["id,x,y,mass,radius,mergeVersion,mergeMs,burnMs",
  "id,x,y,mass,radius,mergeVersion,birth,mergeMs,burnMs"];
const foodKeys = ["id,x,y,value,radius,color", "id,x,y,value,radius,color,artValue,ejected",
  "id,x,y,value,radius,color,artValue,ejected,birth"];
const partNumbers = ["x", "y", "mass", "radius", "mergeVersion", "mergeMs", "burnMs"];
function pack(job) {
  const transfers = [];
  const rooms = job.rooms.map(room => ({...room, states:room.states.map(group => {
    const state=group.snapshot; if(!Array.isArray(state.players)||!Array.isArray(state.ether))return group;
    const players=state.players, food=state.ether;
    let count=0;
    const eligible=players.map(p => {
      const ok=Array.isArray(p.parts) && p.parts.length<65535 && p.parts.every(part =>
        partKeys.includes(Object.keys(part).join(",")) && partNumbers.every(k=>Number.isFinite(part[k])));
      if(ok) count+=p.parts.length;
      return ok;
    });
    const numbers=new Float64Array(count*7), ids=[], births=[], counts=new Uint16Array(players.length);
    let row=0;
    const changed=players.map((p,i)=>{
      if(!eligible[i]) {counts[i]=65535; return p;}
      counts[i]=p.parts.length;
      for(const part of p.parts){ids.push(part.id);births.push(Object.hasOwn(part,"birth")?[part.birth]:null);
        for(let k=0;k<7;k++) numbers[row*7+k]=part[partNumbers[k]]; row++;}
      return {...p,parts:null};
    });
    const positions=new Float64Array(food.length*5),types=new Uint8Array(food.length),foodIds=[],colors=[],launches=[],fallback=[];
    for(let i=0;i<food.length;i++){
      const f=food[i], type=foodKeys.indexOf(Object.keys(f).join(","));
      if(type<0 || ![f.x,f.y,f.value,f.radius].every(Number.isFinite) ||
          (type>0 && (!Number.isFinite(f.artValue) || f.ejected!==true))){types[i]=0;fallback.push([i,f]);continue;}
      types[i]=type+1; foodIds[i]=f.id; colors[i]=f.color; launches[i]=f.birth;
      const o=i*5;positions[o]=f.x;positions[o+1]=f.y;positions[o+2]=f.value;positions[o+3]=f.radius;positions[o+4]=type>0?f.artValue:0;
    }
    transfers.push(numbers.buffer,counts.buffer,positions.buffer,types.buffer);
    return {...group,snapshot:{...state,players:changed,ether:null},tables:{numbers,ids,births,counts,positions,types,foodIds,colors,launches,fallback}};
  })}));
  return [{...job,rooms,snapshotTables:true},transfers];
}
function unpack(job){
  if(!job.snapshotTables)return job;
  delete job.snapshotTables;
  for(const room of job.rooms)for(const group of room.states){
    const t=group.tables; if(!t)continue; const n=t.numbers;let row=0;
    for(let i=0;i<group.snapshot.players.length;i++){
      const p=group.snapshot.players[i];if(t.counts[i]===65535)continue;
      p.parts=Array.from({length:t.counts[i]},()=>{
        const o=row*7,part={id:t.ids[row],x:n[o],y:n[o+1],mass:n[o+2],radius:n[o+3],mergeVersion:n[o+4]};
        if(t.births[row])part.birth=t.births[row][0];
        part.mergeMs=n[o+5];part.burnMs=n[o+6];row++;return part;
      });
    }
    const f=t.positions;
    group.snapshot.ether=Array.from(t.types,(type,i)=>{
      if(!type)return null;const o=i*5,orb={id:t.foodIds[i],x:f[o],y:f[o+1],value:f[o+2],radius:f[o+3],color:t.colors[i]};
      if(type>1){orb.artValue=f[o+4];orb.ejected=true;}if(type===3)orb.birth=t.launches[i];return orb;
    });
    for(const [i,value] of t.fallback)group.snapshot.ether[i]=value;
    delete group.tables;
  }
  return job;
}
if(process.env.LOAD_SNAPSHOT_TABLES==='1'){
  if(threads.isMainThread){const send=threads.Worker.prototype.postMessage;
    threads.Worker.prototype.postMessage=function(job,list){return job.rooms&&job.id?send.call(this,...pack(job)):send.call(this,job,list);};
  }else if(threads.parentPort){const on=threads.parentPort.on;
    threads.parentPort.on=function(name,listener){return name==='message'?on.call(this,name,job=>listener(unpack(job))):on.call(this,name,listener);};
  }
}
module.exports={pack,unpack};
