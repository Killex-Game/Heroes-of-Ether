"use strict";
const path=require('node:path'),{Worker}=require('node:worker_threads');
class ServiceObserver{
  constructor({directory,source,onFailure,onMetrics=()=>{},now=Date.now,intervalMs=5000}){
    this.source=source;this.onFailure=onFailure;this.onMetrics=onMetrics;this.now=now;this.pending=new Map();this.serial=0;this.metricsUntil=0;
    this.value={at:null,series:[],active:{},logError:null};
    try{
    this.worker=new Worker(path.join(__dirname,'service-observer-worker.js'),{workerData:{directory}});
    this.worker.on('message',m=>{
      if(!m||typeof m!=='object')return;
      if(m.type==='snapshot'){
        if(!m.value||!Array.isArray(m.value.series)){this.value.logError='MONITOR_RESPONSE_INVALID';this.sampling=false;return;}
        this.value=m.value;this.sampling=false;this.applyFailure();
      }
      if(m.type==='error'){this.value.logError=m.error;this.sampling=false;}
      if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}
    });
    this.worker.on('error',()=>this.failed());this.worker.on('exit',()=>{if(!this.closed)this.failed();});
    }catch(_){this.failed();}
    this.timer=setInterval(()=>this.sample(),intervalMs);this.timer.unref();this.sample();
  }
  rejectPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('MONITOR_WORKER_FAILED'));}this.pending.clear();}
  failed(){this.workerUnavailable=true;this.sampling=false;this.value.logError='MONITOR_WORKER_FAILED';this.rejectPending();this.switchMetrics(false);}
  switchMetrics(enabled){
    if(this.collectMetrics===enabled&&!this.metricsControlError)return;
    try{if(this.onMetrics(enabled)===false)throw Error('Metrics unavailable');this.collectMetrics=enabled;this.metricsControlError=null;}
    catch(_){this.metricsControlError='MONITOR_METRICS_UNAVAILABLE';}
  }
  post(message){
    if(this.closed||this.workerUnavailable)return false;
    try{this.worker.postMessage(message);return true;}
    catch(_){this.value.logError='MONITOR_MESSAGE_FAILED';return false;}
  }
  sourceSnapshot(collectMetrics){
    try{return {...this.source(),at:this.now(),collectMetrics};}
    catch(_){this.value.logError='MONITOR_SOURCE_UNAVAILABLE';return null;}
  }
  applyFailure(){
    // Optional diagnostics cannot invent or clear a confirmed storage fault.
    const watch=this.value.watchdog;
    const faults=[...(this.latest?.faults||[])];
    if(watch?.active)faults.push('SERVER_UNREACHABLE');
    try{this.onFailure?.(faults);}catch(_){this.value.logError='MONITOR_STATUS_UNAVAILABLE';}
  }
  sample(){
    if(this.closed)return;const collectMetrics=!this.workerUnavailable&&this.now()<this.metricsUntil;
    this.switchMetrics(collectMetrics);
    const snapshot=this.sourceSnapshot(collectMetrics);if(!snapshot)return;this.latest=snapshot;this.applyFailure();
    if(this.sampling||this.workerUnavailable)return;this.sampling=this.post({type:'sample',snapshot});
  }
  snapshot(){return {...this.value,logError:this.metricsControlError||this.value.logError,stale:this.workerUnavailable||this.value.at===null||this.now()-this.value.at>20000};}
  requestMetrics(){this.metricsUntil=this.now()+15000;if(!this.collectMetrics)this.sample();}
  observe(){if(!this.closed){const snapshot=this.sourceSnapshot(false);if(snapshot)this.post({type:'observe',snapshot});}}
  request(message){return new Promise((resolve,reject)=>{
    if(this.closed||this.workerUnavailable)return reject(Error('MONITOR_WORKER_FAILED'));
    const id=++this.serial,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('MONITOR_TIMEOUT'));},5000);
    this.pending.set(id,{resolve,reject,timer});
    if(!this.post({...message,id})){clearTimeout(timer);this.pending.delete(id);reject(Error('MONITOR_MESSAGE_FAILED'));}
  });}
  journal(source,cursor){return this.request({type:'journal',source,cursor});}
  async close(){
    if(this.closed)return;clearInterval(this.timer);this.switchMetrics(false);
    try{if(!this.workerUnavailable)await this.request({type:'flush'});}
    catch(_){this.value.logError='MONITOR_FLUSH_FAILED';}
    finally{this.closed=true;this.rejectPending();try{await this.worker?.terminate();}catch(_){this.value.logError='MONITOR_WORKER_FAILED';}}
  }
}
module.exports={ServiceObserver};
