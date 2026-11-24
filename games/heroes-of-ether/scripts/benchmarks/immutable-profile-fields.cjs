'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),Module=require('module'),{createHash}=require('crypto');
const game=path.resolve(__dirname,'../..');
const [mode,output,baselineFile]=process.argv.slice(2);assert(['baseline','fields'].includes(mode)&&output&&!fs.existsSync(output)&&global.gc);
let implementation=require('../../src/server/persistence/snapshot-builder');
if(mode==='baseline'){
 assert(baselineFile);const filename=require.resolve('../../src/server/persistence/snapshot-builder'),m=new Module(filename,module);
 m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(fs.readFileSync(baselineFile,'utf8'),filename);implementation=m.exports;
}
const {recordArena,bucketFor}=require(game+'/src/server/profiles/operation-receipts');
let world={version:14,_journalRevision:1,profiles:{},clans:{}};
for(let i=0;i<512;i++){
 const p={id:'p'+i,wallet:{coins:100000},receipts:{},arenaReceipts:{},progress:{xp:0}};
 for(let j=0;j<2048;j++){const id='history_request_'+i+'_'+j,b=bucketFor(id);(p.arenaReceipts[b]||=(Object.create(null)))[id]='подтверждённое применение '+j;}
 world.profiles['p'+i]=p;
}
const source={owns:value=>value===world},builder=new implementation.SnapshotBuilder({immutableSource:source});
const rows=[];let previous=null;
for(let step=0;step<12;step++){
 if(step){const profiles={...world.profiles};for(let i=0;i<30;i++){
  const key='p'+((step*17+i)%60),p={...profiles[key],progress:{xp:step*5}};
  recordArena(p,'new_request_'+step+'_'+i,'cast-'+step+'-'+i);profiles[key]=p;
 }world={...world,_journalRevision:step+1,profiles};}
 global.gc();const cpu=process.cpuUsage(),start=performance.now(),next=builder.pack(world),elapsedMs=performance.now()-start,used=process.cpuUsage(cpu);
 const compressed=createHash('sha256');let bytes=0;
 for(const [id,doc]of next.docs)if(previous?.docs.get(id)?.hash!==doc.hash){const b=implementation.gzipDocumentValue(doc);compressed.update(id);compressed.update(b);bytes+=b.length;}
 rows.push({step,elapsedMs,cpuMs:(used.user+used.system)/1000,worldHash:next.worldHash,digest:next.digest,encodedHash:compressed.digest('hex'),bytes,
   stats:builder.stats,memory:process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS});previous=next;
}
fs.writeFileSync(output,JSON.stringify({mode,scope:'Immutable record preparation with receipt bucket changes; synthetic, no network or physics',profiles:512,originalReceipts:1048576,rows},null,2),{flag:'wx'});
console.log(JSON.stringify({mode,cold:rows[0].elapsedMs,warm:rows.slice(1).map(r=>r.elapsedMs),maxRSSKiB:process.resourceUsage().maxRSS}));
