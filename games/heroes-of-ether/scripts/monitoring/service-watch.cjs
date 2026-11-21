"use strict";
const path=require('node:path');
const {ServiceWatchdog,probe}=require('../../src/server/runtime/service-watchdog');
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
if(!args.includes('--data')||!args.includes('--url'))throw Error('Use --data DATA_DIRECTORY --url LOOPBACK_SERVICE_STATUS_URL');
const data=path.resolve(value('--data')),directory=path.join(data,'monitoring');
require('node:fs').mkdirSync(directory,{recursive:true});
const release=require('../../src/server/runtime/process-lock').acquireServerLock(path.join(directory,'watchdog.lock'));process.on('exit',release);
const watcher=new ServiceWatchdog({directory,maintenanceFile:path.join(data,'maintenance.enabled')});
let closing=false,timer;
async function check(){
  try{watcher.observe(await probe(value('--url')));}catch(_){console.error('MONITOR_WATCHDOG_IO_ERROR');process.exitCode=1;closing=true;}
  if(!closing)timer=setTimeout(check,5000);
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{closing=true;clearTimeout(timer);});
void check();
