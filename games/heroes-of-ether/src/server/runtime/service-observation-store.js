"use strict";
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
function atomic(file,value){
  const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);
}
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
// Backwards pagination does not read the whole, never automatically deleted, journal.
function events(file,cursor=null,limit=30){
  let fd;try{fd=fs.openSync(file,'r');}catch(e){if(e.code==='ENOENT')return {entries:[],cursor:null};throw e;}
  try{
    let end=Math.min(fs.fstatSync(fd).size,Number.isSafeInteger(cursor)&&cursor>=0?cursor:Infinity),start=end,buffer=Buffer.alloc(0);
    while(start>0&&buffer.toString('utf8').split('\n').length<=limit+1){const count=Math.min(65536,start),chunk=Buffer.alloc(count);start-=count;fs.readSync(fd,chunk,0,count,start);buffer=Buffer.concat([chunk,buffer]);}
    const lines=buffer.toString('utf8').split('\n');if(start>0){const head=lines.shift();start+=Buffer.byteLength(head)+1;}if(lines.at(-1)==='')lines.pop();
    const chosen=lines.slice(-limit),offset=start+lines.slice(0,-chosen.length||lines.length).reduce((n,s)=>n+Buffer.byteLength(s)+1,0);
    return {entries:chosen.reverse().map(s=>JSON.parse(s)),cursor:offset>0?offset:null};
  }finally{fs.closeSync(fd);}
}
class ObservationStore{
  constructor(directory,name='runtime'){
    fs.mkdirSync(directory,{recursive:true});this.file=path.join(directory,name+'.jsonl');
    // An incomplete final line from a power loss is not an acknowledged event.
    if(fs.existsSync(this.file)){
      const fd=fs.openSync(this.file,'r+');try{const size=fs.fstatSync(fd).size;if(size){const b=Buffer.alloc(Math.min(size,1024*1024));fs.readSync(fd,b,0,b.length,size-b.length);if(b.at(-1)!==10){const last=b.lastIndexOf(10);if(last<0&&size>b.length)throw Error('MONITOR_JOURNAL_CORRUPT');fs.ftruncateSync(fd,size-b.length+last+1);fs.fsyncSync(fd);}}}finally{fs.closeSync(fd);}
    }
    const last=events(this.file,null,1).entries[0];this.active=last?.active||{};
  }
  update(next,at){
    for(const [key,value] of Object.entries(this.active))if(!next[key])this.record(key,value,false,at);
    for(const [key,value] of Object.entries(next))if(!this.active[key])this.record(key,value,true,at);
  }
  record(key,value,started,at){
    const next={...this.active};if(started)next[key]=value;else delete next[key];
    const event={id:randomUUID(),at,kind:started?'started':'ended',key,...value,active:next};
    const fd=fs.openSync(this.file,'a');try{fs.writeFileSync(fd,JSON.stringify(event)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    this.active=next;
  }
}
function activeModes(snapshot,at){
  const active={};
  for(const w of snapshot.windows||[])if(w.enabled&&w.startsAt<=at&&at<w.endsAt)active['manual:'+w.mode+':'+w.startsAt+':'+w.endsAt]={mode:w.mode,source:'manual',startsAt:w.startsAt,endsAt:w.endsAt,reason:'Период, установленный владельцем'};
  if(snapshot.deployment)active.deployment={mode:'maintenance',source:'deployment',reason:'Технический режим выпуска'};
  for(const fault of snapshot.faults||[])active['automatic:'+fault]={mode:'failure',source:'automatic',reason:fault};
  return active;
}
function rate(previous,current,keys){
  if(!previous||!current||previous.epoch!==current.epoch||current.at<=previous.at)return null;
  const seconds=(current.at-previous.at)/1000,result={};
  for(const key of keys){if(!Number.isFinite(current[key])||current[key]<previous[key])return null;result[key]=(current[key]-previous[key])/seconds;}
  return result;
}
module.exports={ObservationStore,atomic,read,events,activeModes,rate};
