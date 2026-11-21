'use strict';
// Diagnostic only. Scope a CPU profile to one load phase, excluding seeding,
// checkpoint shutdown and the other phases. Never imported by the live server.
const inspector=require('node:inspector/promises'),fs=require('node:fs/promises'),path=require('node:path');
async function start(phase,directory){
  if(process.env.LOAD_CPU_PHASE!==phase)return null;
  const session=new inspector.Session();session.connect();
  try{
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval',{interval:1000});
    await session.post('Profiler.start');
  }catch(e){session.disconnect();throw e;}
  return async()=>{try{
    const {profile}=await session.post('Profiler.stop');
    const file=path.join(directory,'phase-'+phase+'.cpuprofile');
    await fs.writeFile(file,JSON.stringify(profile));return path.basename(file);
  }finally{session.disconnect();}};
}
module.exports={start};
