"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const snapshots=require('../../src/server/profiles/profile-read-snapshot');
const [output,countText='512']=process.argv.slice(2),count=Number(countText);assert(output&&Number.isInteger(count)&&count>=16&&count<=2048);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'heroether-retirement-cost-')),file=path.join(root,'profiles.json'),files=[],rows=[];
 fs.writeFileSync(file,'{}');for(let i=1;i<=count;i++){const source=file+'.wal-'+i;fs.writeFileSync(source,'x'.repeat(1024));files.push(source);}
 try{
  for(const mode of ['sync','async','async','sync']){
   const pin=snapshots.pin(file,files,count),gaps=[];let last=performance.now();
   const timer=setInterval(()=>{const at=performance.now();gaps.push(at-last);last=at;},1);
   await pause(30);const started=performance.now();
   if(mode==='async')await pin.releaseAsync();else pin.release();
   const elapsedMs=performance.now()-started;await pause(30);clearInterval(timer);
   gaps.sort((a,b)=>a-b);assert(!fs.existsSync(path.dirname(pin.file)));
   for(const source of files)assert.equal(fs.readFileSync(source,'utf8'),'x'.repeat(1024));
   rows.push({mode,elapsedMs,eventLoopGapMaxMs:gaps.at(-1),eventLoopGapP95Ms:gaps[Math.floor((gaps.length-1)*.95)],samples:gaps.length});
  }
  const report={node:process.version,platform:process.platform,segments:count,rows,sourceFilesUnchanged:true,scope:'Closed snapshot-link retirement only; excludes initial pin, game logic and PostgreSQL throughput'};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
 }finally{
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'heroether-retirement-cost-'));
  for(const name of fs.readdirSync(root)){const target=path.join(root,name);assert(fs.lstatSync(target).isFile());fs.unlinkSync(target);}fs.rmdirSync(root);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
