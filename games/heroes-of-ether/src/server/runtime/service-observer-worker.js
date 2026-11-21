"use strict";
const {parentPort,workerData}=require('node:worker_threads'),path=require('node:path');
const {ObservationStore,atomic,read,events,activeModes,rate}=require('./service-observation-store'),{diskCounters}=require('./disk-observation');
const directory=workerData.directory,store=new ObservationStore(directory),seriesFile=path.join(directory,'series.json');
let series=(read(seriesFile)?.series||[]).slice(-720),previousDisk=null,previousMongo=null,lastDisk={available:false,reason:'Замеры диска ещё не запрошены'},lastSaved=0,dirty=false;
const persist=()=>{if(dirty){atomic(seriesFile,{series});dirty=false;}};
parentPort.on('message',message=>{
  try{
    if(message.type==='flush'){persist();return parentPort.postMessage({id:message.id,result:{ok:true}});}
    if(message.type==='journal'){
      const file=path.join(directory,message.source==='watchdog'?'watchdog.jsonl':'runtime.jsonl');
      return parentPort.postMessage({id:message.id,result:events(file,message.cursor,10)});
    }
    if(message.type==='observe'){store.update(activeModes(message.snapshot,message.snapshot.at),message.snapshot.at);return;}
    if(message.type!=='sample')return;
    const snapshot=message.snapshot,at=snapshot.at;store.update(activeModes(snapshot,at),at);
    const mongo=snapshot.mongo,watchdog=read(path.join(directory,'watchdog.json'));
    if(snapshot.collectMetrics){
      const disk=diskCounters(at);lastDisk={available:disk.available,device:disk.device,reason:disk.reason};
      const diskRate=disk.available?rate(previousDisk,disk,['read','write']):null;
      const mongoRate=mongo?.health?.state==='ok'?rate(previousMongo,mongo.metrics,['read','write']):null;
      previousDisk=disk.available?disk:null;previousMongo=mongo?.health?.state==='ok'?mongo.metrics:null;
      if(!series.length||at-series.at(-1).at>=4000){series.push({at,disk:diskRate,mongo:mongoRate});dirty=true;}
      if(at-lastSaved>=30000){persist();lastSaved=at;}
    }else{previousDisk=null;previousMongo=null;persist();}
    series=series.filter(p=>at-p.at<=3600000).slice(-720);
    parentPort.postMessage({type:'snapshot',value:{at,series,collecting:!!snapshot.collectMetrics,disk:lastDisk,mongo:{enabled:!!mongo?.enabled,health:mongo?.health||null},active:store.active,watchdog,logError:null}});
  }catch(error){parentPort.postMessage({id:message.id,error:'MONITOR_IO_ERROR',type:'error'});}
});
