"use strict";
// Offline, synthetic checkpoint + sealed WAL only. Each mode is a fresh process.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {checkpoint,createCheckpointWriter,atomicSnapshot}=require('../../src/server/profiles/profile-journal');
const [mode,fixtureArg,outputArg]=process.argv.slice(2),fixture=path.resolve(fixtureArg);
function hashFile(file){const hash=createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(65536);try{for(let n;(n=fs.readSync(fd,buffer,0,buffer.length,null));)hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}return hash.digest('hex');}
if(mode==='seed'){
 assert(!fs.existsSync(fixture));fs.mkdirSync(path.dirname(fixture),{recursive:true});
 const world={version:14,profiles:{},clans:{c:{members:[],xp:1}},_journalRevision:1};
 for(let i=0;i<1280;i++){
  const buckets=Object.fromEntries(Array.from({length:64},(_,n)=>[n,{}]));
  for(let n=0;n<500;n++)buckets[n%64]['synthetic-'+String(i).padStart(4,'0')+'-'+String(n).padStart(8,'0')+'-receipt']=1700000000000+n;
  world.profiles['p'+i]={id:'p'+i,name:'Проверка 🐲 '+i,coins:1000,arenaReceipts:{buckets},future:{unknown:['preserve',i]}};
 }
 atomicSnapshot(fixture,world,true);console.log(JSON.stringify({fixture,bytes:fs.statSync(fixture).size,sha256:hashFile(fixture),receipts:640000}));
}else{
 assert(['cold','cached'].includes(mode));const output=path.resolve(outputArg);assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
 const file=path.join(output,'profiles.json');fs.copyFileSync(fixture,file);const write=mode==='cached'?createCheckpointWriter(file):()=>checkpoint(file),rows=[];
 if(global.gc)global.gc();
 for(let n=0;n<10;n++){
  const edits={};for(let i=0;i<30;i++)edits['p'+i]={set:{coins:999-n},remove:[],nested:{arenaReceipts:{set:{},remove:[],nested:{buckets:{set:{},remove:[],nested:{[n%64]:{set:{['new-'+n]:1800000000000+n},remove:[]}}}}}}};
  const body=JSON.stringify({revision:n+2,change:{set:{},remove:[],tables:{profileEdits:edits}}});
  fs.writeFileSync(file+'.wal-'+(n+2),createHash('sha256').update(body).digest('hex')+' '+body+'\n');
  const cpu=process.cpuUsage(),start=performance.now(),result=write(),elapsedMs=performance.now()-start,used=process.cpuUsage(cpu);
  assert.equal(result.revision,n+2);const memory=process.memoryUsage();
  rows.push({revision:result.revision,elapsedMs,cpuMs:(used.user+used.system)/1000,rssMiB:memory.rss/1048576,heapMiB:memory.heapUsed/1048576,bytes:fs.statSync(file).size,sha256:hashFile(file)});
 }
 const peakRssMiB=process.resourceUsage().maxRSS/1024;if(global.gc)global.gc();
 const sorted=rows.slice(1).map(r=>r.elapsedMs).sort((a,b)=>a-b),summary={mode,fixtureSha256:hashFile(fixture),rows,coldMs:rows[0].elapsedMs,warmMedianMs:sorted[4],peakRssMiB,retainedRssMiB:process.memoryUsage().rss/1048576,retainedHeapMiB:process.memoryUsage().heapUsed/1048576,scope:'Checkpoint worker only; full synchronous write and fsync included. Not whole-game CPU/CCU.'};
 fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
