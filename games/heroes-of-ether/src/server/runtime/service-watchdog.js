"use strict";
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https');
const {ObservationStore,atomic,read}=require('./service-observation-store');
class ServiceWatchdog{
  constructor({directory,maintenanceFile,now=Date.now}){
    this.directory=directory;this.maintenanceFile=maintenanceFile;this.now=now;this.store=new ObservationStore(directory,'watchdog');
    this.active=!!this.store.active['automatic:server'];this.bad=0;this.good=0;
  }
  observe(healthy){
    const at=this.now(),planned=fs.existsSync(this.maintenanceFile);
    if(healthy){this.bad=0;this.good++;}
    else if(planned&&!this.active){this.bad=0;this.good=0;this.firstBadAt=null;}
    else{if(!this.bad)this.firstBadAt=at;this.bad++;this.good=0;}
    if(!planned&&this.bad>=2)this.active=true;
    // A maintenance flag must not conceal an incident that was already detected.
    if(this.active&&this.good>=2)this.active=false;
    const active=this.active?{'automatic:server':{mode:'failure',source:'automatic',reason:'SERVER_UNREACHABLE',startsAt:this.store.active['automatic:server']?.startsAt||this.firstBadAt||at}}:{};
    this.store.update(active,at);
    const value={checkedAt:at,active:this.active,healthy,planned,startsAt:active['automatic:server']?.startsAt||null};
    atomic(path.join(this.directory,'watchdog.json'),value);return value;
  }
}
function probe(url,timeoutMs=4000){
  const target=new URL(url);if(!['127.0.0.1','[::1]','localhost'].includes(target.hostname))throw Error('Watchdog target must be loopback');
  return new Promise(resolve=>{
    const transport=target.protocol==='https:'?https:http;
    const request=transport.get(target,{rejectUnauthorized:false,agent:false},response=>{
      let value='',size=0;response.on('data',chunk=>{size+=chunk.length;if(size>16384){request.destroy();return;}value+=chunk;});
      response.on('end',()=>{clearTimeout(timer);try{const data=JSON.parse(value);resolve(response.statusCode===200&&typeof data.maintenance==='boolean'&&Number.isFinite(data.serverNow));}catch(_){resolve(false);}});
      response.on('error',()=>{clearTimeout(timer);resolve(false);});
    });
    const timer=setTimeout(()=>request.destroy(),timeoutMs);
    request.on('error',()=>{clearTimeout(timer);resolve(false);});
  });
}
module.exports={ServiceWatchdog,probe};
