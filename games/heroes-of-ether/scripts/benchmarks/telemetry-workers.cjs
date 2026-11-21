'use strict';
// Opt-in diagnostic preload. Never included by the game entry point.
const destination=process.env.LOAD_RESOURCE_LOG_DIR;
if(destination){
  const fs=require('node:fs'),path=require('node:path');
  const {performance,PerformanceObserver}=require('node:perf_hooks');
  const {threadId,isMainThread}=require('node:worker_threads');
  const resources=require('./resource-sample.cjs');
  fs.mkdirSync(destination,{recursive:true});
  const file=path.join(destination,`${process.pid}-${threadId}.ndjson`);
  let gcMs=0,gcCount=0,gcMaxMs=0,writing=false,skipped=0;
  const observer=new PerformanceObserver(list=>{
    for(const entry of list.getEntries()){
      gcMs+=entry.duration;gcCount++;gcMaxMs=Math.max(gcMaxMs,entry.duration);
    }
  });
  observer.observe({entryTypes:['gc']});
  const take=()=>({at:performance.now(),processCpu:process.cpuUsage(),
    threadCpu:process.threadCpuUsage(),elu:performance.eventLoopUtilization(),
    cgroup:isMainThread?resources.cgroupCpu():null});
  let before=take();
  const timer=setInterval(()=>{
    if(writing){skipped++;return;}
    const after=take(),row={at:Date.now(),pid:process.pid,threadId,isMainThread,
      resource:resources.delta(before,after),gc:{count:gcCount,totalMs:gcMs,maxMs:gcMaxMs},skipped};
    before=after;gcMs=gcCount=gcMaxMs=skipped=0;writing=true;
    fs.appendFile(file,JSON.stringify(row)+'\n',error=>{
      writing=false;
      if(error){clearInterval(timer);observer.disconnect();process.stderr.write('Diagnostic telemetry write failed\n');}
    });
  },1000);
  timer.unref();
}
