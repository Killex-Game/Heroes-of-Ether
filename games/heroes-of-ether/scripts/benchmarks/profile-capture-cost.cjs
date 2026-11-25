'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {ProfileReadWindow}=require('../../src/server/profiles/profile-read-window');
const [output,countText='512']=process.argv.slice(2),count=Number(countText);assert(output&&!fs.existsSync(output)&&Number.isInteger(count)&&count>=16&&count<=2048);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'heroether-capture-cost-')),file=path.join(root,'profiles.json'),files=[],rows=[];
 fs.writeFileSync(file,'{}');for(let i=1;i<=count;i++){const source=file+'.wal-'+i;fs.writeFileSync(source,'segment-'+i+'\n'+'x'.repeat(1024));files.push(source);}
 try{
  for(const mode of ['sync','async','async','sync']){
   const window=new ProfileReadWindow(file),pin=window.pin([],0),gaps=[];let last=performance.now();
   const timer=setInterval(()=>{const at=performance.now();gaps.push(at-last);last=at;},1);
   await pause(30);const started=performance.now(),cpu=process.cpuUsage();
   if(mode==='async')await window.captureAsync(files);else window.capture(files);
   const elapsedMs=performance.now()-started,used=process.cpuUsage(cpu);await pause(30);clearInterval(timer);
   assert(window.current);assert.equal(window.current.rows.size,count);
   for(const source of files){const suffix=source.slice(source.lastIndexOf('-')+1),target=window.current.rows.get(suffix).target;
    assert.deepEqual(fs.readFileSync(source),fs.readFileSync(target));assert.equal(fs.readFileSync(source,'utf8'),'segment-'+suffix+'\n'+'x'.repeat(1024));}
   gaps.sort((a,b)=>a-b);rows.push({mode,elapsedMs,cpuMs:(used.user+used.system)/1000,eventLoopGapMaxMs:gaps.at(-1),eventLoopGapP95Ms:gaps[Math.floor((gaps.length-1)*.95)],samples:gaps.length});
   pin.release();window.reset();await window.drainCleanup();assert(!fs.existsSync(path.dirname(pin.file)));
  }
  const report={at:new Date().toISOString(),node:process.version,platform:process.platform,segments:count,rows,sourceFilesUnchanged:true,scope:'Closed WAL-link capture only; initial pin, checkpoint, simulation, PostgreSQL and file writes excluded; not whole-game throughput'};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
 }finally{
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'heroether-capture-cost-'));
  for(const name of fs.readdirSync(root)){const target=path.join(root,name);assert(fs.lstatSync(target).isFile());fs.unlinkSync(target);}fs.rmdirSync(root);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
