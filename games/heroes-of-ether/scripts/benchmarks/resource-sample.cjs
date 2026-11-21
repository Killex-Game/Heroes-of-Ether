'use strict';
// Diagnostic only. Read cgroup counters at phase boundaries, never per tick.
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
function cgroupCpu({platform=process.platform,read=file=>fs.readFileSync(file,'utf8')}={}){
  if(platform!=='linux')return null;
  try{
    const group=/^0::(\/[^\r\n]*)$/m.exec(read('/proc/self/cgroup'))?.[1];
    if(!group)return null;
    const directory=path.posix.resolve('/sys/fs/cgroup','.'+group);
    if(directory!=='/sys/fs/cgroup'&&!directory.startsWith('/sys/fs/cgroup/'))return null;
    const counters={};
    for(const line of read(directory+'/cpu.stat').trim().split('\n')){
      const [name,text]=line.trim().split(/\s+/),value=Number(text);
      if(/^[a-z_]+$/.test(name)&&/^\d+$/.test(text)&&Number.isSafeInteger(value))counters[name]=value;
    }
    if(!Number.isSafeInteger(counters.usage_usec))return null;
    return {scope:directory,version:2,cpuMax:read(directory+'/cpu.max').trim(),counters};
  }catch{return null;}
}
function sample(){
  let threadCpu=null;try{threadCpu=process.threadCpuUsage();}catch{}
  return {at:performance.now(),processCpu:process.cpuUsage(),threadCpu,
    elu:performance.eventLoopUtilization(),cgroup:cgroupCpu()};
}
function delta(before,after=sample()){
  const elapsedMs=after.at-before.at;
  const cpu=(a,b)=>a&&b?{userMs:(b.user-a.user)/1000,systemMs:(b.system-a.system)/1000,
    percent:elapsedMs>0?((b.user-a.user+b.system-a.system)/elapsedMs/10):null}:null;
  let cgroup=null;
  if(before.cgroup&&after.cgroup?.scope===before.cgroup.scope){
    const counters={};
    for(const [key,value]of Object.entries(after.cgroup.counters))
      if(Number.isSafeInteger(before.cgroup.counters[key])&&value>=before.cgroup.counters[key])counters[key]=value-before.cgroup.counters[key];
    cgroup={scope:after.cgroup.scope,cpuMax:after.cgroup.cpuMax,counters,
      // This is a group counter, including co-located generators and workers.
      throttledPeriodFraction:counters.nr_periods>0?counters.nr_throttled/counters.nr_periods:null};
  }
  const activeMs=after.elu.active-before.elu.active,idleMs=after.elu.idle-before.elu.idle;
  return {elapsedMs,processCpu:cpu(before.processCpu,after.processCpu),mainThreadCpu:cpu(before.threadCpu,after.threadCpu),
    mainThreadElu:{activeMs,idleMs,utilization:activeMs+idleMs>0?activeMs/(activeMs+idleMs):0},cgroup};
}
module.exports={cgroupCpu,sample,delta};
