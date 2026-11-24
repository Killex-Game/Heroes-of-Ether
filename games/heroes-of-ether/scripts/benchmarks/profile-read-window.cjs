"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {ProfileJournal}=require('../../src/server/profiles/profile-journal');
const {PinnedWorldReader}=require('../../src/server/persistence/pinned-world-reader');
const {SnapshotBuilder}=require('../../src/server/persistence/snapshot-builder');
const [mode,fixtureArg,outArg]=process.argv.slice(2),fileSource=path.resolve(fixtureArg),out=path.resolve(outArg);
assert(['baseline','window'].includes(mode));assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const file=path.join(out,'profiles.json');fs.copyFileSync(fileSource,file);
const journal=new ProfileJournal(file,{intervalMs:300000,readWindow:mode==='window'?{}:false}),reader=new PinnedWorldReader(),builder=new SnapshotBuilder({immutableSource:reader});
const rows=[];
(async()=>{try{
 for(let n=0;n<10;n++){
  const world=journal.previous,profiles={...world.profiles};
  for(let i=0;i<30;i++){const p=profiles['p'+i];profiles['p'+i]={...p,coins:999-n};}
  journal.commit({...world,profiles});const start=performance.now();await journal.requestCheckpoint();const checkpointMs=performance.now()-start;
  const pinStart=performance.now(),pin=await journal.pinSnapshot(),pinMs=performance.now()-pinStart,cpu=process.cpuUsage(),readStart=performance.now();
  try{const data=reader.read(pin).data,snapshot=builder.pack(data,{}),cpuUsed=process.cpuUsage(cpu);
   rows.push({revision:pin.revision,checkpointMs,pinMs,readMs:performance.now()-readStart,cpuMs:(cpuUsed.user+cpuUsed.system)/1000,incremental:reader.stats.incremental,readFiles:reader.stats.readFiles,digest:snapshot.digest,worldHash:snapshot.worldHash,rssMiB:process.memoryUsage().rss/1048576,retainedFiles:journal.readWindow?.current?.rows.size||0,retainedBytes:journal.readWindow?.current?.bytes||0});
  }finally{pin.release();}
 }
}finally{await journal.close();}
const values=rows.slice(1).map(r=>r.readMs).sort((a,b)=>a-b),result={mode,rows,warmMedianMs:values[4],peakRssMiB:process.resourceUsage().maxRSS/1024,scope:'Offline checkpoint + PG prepare stage; no network, arena CPU or CCU claim'};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
