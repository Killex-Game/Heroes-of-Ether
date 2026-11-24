"use strict";
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gzipSync}=require('node:zlib');
const {SnapshotBuilder}=require('../../src/server/persistence/snapshot-builder');
const {encode}=require('../../src/server/persistence/postgresql-state');
const [mode,output]=process.argv.slice(2);
assert(['legacy','cached'].includes(mode)&&output&&!fs.existsSync(output)&&global.gc);
const world={_journalRevision:1,version:14,profiles:{},clans:{}};
for(let i=0;i<1280;i++)world.profiles['p'+i]={id:'p'+i,wallet:{coins:100000},history:Array.from({length:500},(_,j)=>({
  id:'historical-'+i+'-'+j,at:1700000000000+j,kind:'fixture',label:'Синтетическая покупка',
  changes:{coins:-1,crystals:0,ether:0},source:'compression-benchmark'}))};
const builder=new SnapshotBuilder();let previous=builder.pack(world);
const run=mode==='cached'?encode:doc=>({_id:doc._id,value:gzipSync(Buffer.from(JSON.stringify(doc.value)),{level:1}),hash:doc.hash,chunked:!!doc.chunked});
const rows=[];
for(let step=0;step<12;step++){
  world._journalRevision++;
  for(let i=0;i<30;i++)world.profiles['p'+((step*17+i)%60)].wallet.coins--;
  const next=builder.pack(world),changed=[...next.docs.values()].filter(doc=>previous.docs.get(doc._id)?.hash!==doc.hash);
  global.gc();const before=process.memoryUsage(),cpu=process.cpuUsage(),started=performance.now();
  const encoded=changed.map(run),elapsedMs=performance.now()-started,used=process.cpuUsage(cpu),after=process.memoryUsage();
  const checksum=createHash('sha256');let bytes=0;
  for(const doc of encoded){checksum.update(JSON.stringify([doc._id,doc.hash,doc.chunked]));checksum.update(doc.value);bytes+=doc.value.length;}
  rows.push({step,documents:changed.length,elapsedMs,cpuMs:(used.user+used.system)/1000,bytes,encodedHash:checksum.digest('hex'),
    revision:next.revision,digest:next.digest,worldHash:next.worldHash,before,after,maxRSSKiB:process.resourceUsage().maxRSS});
  previous=next;
}
const report={mode,scope:'Only changed PostgreSQL document encoding; identical synthetic history and commands; forced GC between samples, not whole-game performance',rows};
fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
const sorted=rows.slice(2).map(r=>r.elapsedMs).sort((a,b)=>a-b);
console.log(JSON.stringify({mode,medianMs:sorted[Math.floor(sorted.length/2)],documents:rows[0].documents,bytes:rows[0].bytes,maxRSSKiB:process.resourceUsage().maxRSS}));
