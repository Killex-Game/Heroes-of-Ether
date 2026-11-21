'use strict';
const {isMainThread,threadId}=require('node:worker_threads');
if(!isMainThread&&process.env.WORKER_PROFILE_DIR){
 const fs=require('node:fs'),path=require('node:path'),session=new(require('node:inspector').Session)();
 session.connect();session.post('Profiler.enable',()=>session.post('Profiler.start'));
 setTimeout(()=>session.post('Profiler.stop',(error,result)=>{
  if(!error&&result?.profile){fs.mkdirSync(process.env.WORKER_PROFILE_DIR,{recursive:true});
   fs.writeFileSync(path.join(process.env.WORKER_PROFILE_DIR,process.pid+'-'+threadId+'.cpuprofile'),JSON.stringify(result.profile));}
  session.disconnect();
 }),30000).unref();
}
