"use strict";
const fs=require('node:fs/promises'),path=require('node:path');
const {empty,modes}=require('./service-availability');
const {diskCounters}=require('../runtime/disk-observation');
const {rate}=require('../runtime/service-observation-store');
const routes=new Set(['/api/admin/performance','/api/admin/monitoring','/api/admin/overview-calendar']);
const LIMIT=1024*1024;
async function load(file){
  let handle;
  try{handle=await fs.open(file,'r');const size=(await handle.stat()).size;if(size>LIMIT)throw Error('MONITOR_TOO_LARGE');
    const buffer=Buffer.alloc(size+1);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
    if(offset>size)throw Error('MONITOR_FILE_CHANGED');return JSON.parse(buffer.toString('utf8',0,offset));
  }catch(error){if(error.code==='ENOENT')return null;throw error;}finally{await handle?.close();}
}
function valid(route,value){
  if(!value||typeof value!=='object'||value.stale)return false;
  if(route.endsWith('/performance'))return Number.isFinite(value.capturedAt)&&value.arena&&value.persistence&&value.memoryMiB&&value.tickWorkMs&&value.tickIntervalMs;
  if(route.endsWith('/monitoring'))return Array.isArray(value.series)&&value.series.length<=720&&value.availability?.status;
  return Number.isFinite(value.serverNow);
}
// Diagnostics only: separate files from game saves, the game observer and watchdog.
// Reading the overview never opens profiles or connects to PostgreSQL.
class ControlMonitoring{
  constructor({directory,dataDir,now=Date.now,disk=diskCounters}){
    this.file=path.join(directory,'overview-cache.json');this.dataDir=dataDir;this.now=now;this.disk=disk;
    this.cache=new Map();this.series=[];this.diskState={available:false};this.lastSample=0;
    this.ready=this.restore();
  }
  async restore(){try{const saved=await load(this.file);if(saved?.version===1){
    for(const [route,value]of Object.entries(saved.snapshots||{}))if(routes.has(route)&&valid(route,value))this.cache.set(route,value);
    this.series=Array.isArray(saved.diskSeries)?saved.diskSeries.filter(p=>Number.isFinite(p.at)&&p.at<=this.now()&&p.at>=this.now()-3600000).slice(-720):[];
  }}catch(_){this.cacheError=true;}}
  async remember(route,value){await this.ready;if(!routes.has(route)||!valid(route,value))return;
    this.cache.set(route,value);this.dirty=true;
    if(!this.timer){this.timer=setTimeout(()=>{this.timer=null;this.flush();},1000);this.timer.unref();}
  }
  async flush(){
    if(this.writing){await this.writing;if(this.dirty)return this.flush();return;}
    if(!this.dirty)return;this.dirty=false;
    this.writing=(async()=>{try{
      const raw=JSON.stringify({version:1,snapshots:Object.fromEntries(this.cache),diskSeries:this.series});
      if(Buffer.byteLength(raw)>LIMIT)throw Error('MONITOR_TOO_LARGE');
      await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(this.file+'.tmp',raw,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);this.cacheError=false;
    }catch(_){this.cacheError=true;}finally{this.writing=null;}})();await this.writing;
  }
  sampleDisk(){
    const at=this.now();if(at-this.lastSample<4000)return;this.lastSample=at;
    const disk=this.disk(at);this.diskState={available:disk.available,device:disk.device,reason:disk.reason};
    const value=disk.available&&this.previousDisk&&at-this.previousDisk.at<20000?rate(this.previousDisk,disk,['read','write']):null;
    this.previousDisk=disk.available?disk:null;
    this.series=this.series.filter(p=>at-p.at<=3600000).slice(-719);this.series.push({at,disk:value});this.dirty=true;
  }
  async result(route,live,control){
    await this.ready;
    if(live)await this.remember(route,live);
    const previous=this.cache.get(route),checkedAt=this.now();
    if(!route.endsWith('/monitoring'))return live||{...(previous||{}),available:!!previous,stale:true,control,checkedAt};
    this.sampleDisk();
    let failed=false;const read=async file=>{try{return await load(file);}catch(_){failed=true;return null;}};
    const directory=path.join(this.dataDir,'monitoring');
    const [watchdog,saved,hint]=await Promise.all([
      read(path.join(directory,'watchdog.json')),
      !live&&!previous?read(path.join(directory,'series.json')):null,
      !live?read(path.join(path.dirname(this.dataDir),'maintenance-public.json')):null,
    ]);
    let result=live;
    if(!result){
      const planned=await fs.access(path.join(this.dataDir,'maintenance.enabled')).then(()=>true,()=>false);
      const status=planned?{maintenance:true,mode:'maintenance',title:'Техническое обновление',message:'Устанавливаем обновление игры.',...(hint||{})}:
        {maintenance:true,mode:'unavailable',title:'Игра временно недоступна',message:'Ожидаем ответа игрового сервера.'};
      const series=previous?.series||saved?.series||[];
      result={...(previous||{}),at:previous?.at||series.at(-1)?.at||null,series,collecting:false,stale:true,
        availability:{...(previous?.availability||empty()),modes,status,automatic:{active:false,since:null,faults:[]}}};
    }
    return {...result,watchdog:watchdog||result.watchdog,control,checkedAt,
      logError:failed||this.cacheError?'MONITOR_IO_ERROR':result.logError||null,
      independent:{at:this.lastSample,disk:this.diskState,series:this.series}};
  }
  async close(){clearTimeout(this.timer);await this.ready;await this.flush();}
}
module.exports={ControlMonitoring,routes};
