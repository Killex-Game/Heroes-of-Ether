'use strict';
// Run separately for each implementation against the same private checkpoint.
// node --expose-gc scripts/benchmarks/snapshot-builder.cjs baseline|cached INPUT.json[.gz] OUTPUT.json
const fs=require('node:fs'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {pack}=require('../../src/server/persistence/state-snapshot');
const {SnapshotBuilder}=require('../../src/server/persistence/snapshot-builder');
const [mode,input,output]=process.argv.slice(2);
assert(['baseline','cached'].includes(mode)&&input&&output&&global.gc,'Expected mode, checkpoint, output and --expose-gc');
assert(!fs.existsSync(output),'Refusing to overwrite benchmark evidence');
const bytes=fs.readFileSync(input),world=JSON.parse(input.endsWith('.gz')?zlib.gunzipSync(bytes):bytes);
const builder=new SnapshotBuilder(),run=mode==='baseline'?pack:(...args)=>builder.pack(...args);
const sizes=Object.entries(world.profiles).map(([id,p])=>({id,size:JSON.stringify(p).length})).sort((a,b)=>a.size-b.size);
assert(sizes.length>0);let snapshot=null;const results=[];
for(let i=0;i<4;i++){
  if(i>=2){world._journalRevision=(world._journalRevision||0)+1;const row=i===2?sizes[0]:sizes.at(-1);world.profiles[row.id].snapshotBenchmarkOnly={sequence:i};}
  snapshot=null;global.gc();const before=process.memoryUsage(),started=performance.now();snapshot=run(world);
  const result={scenario:['cold','unchanged','small-record-change','largest-record-change'][i],ms:performance.now()-started,
    before,after:process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS,cache:builder.stats,
    revision:snapshot.revision,worldHash:snapshot.worldHash,digest:snapshot.digest,documents:snapshot.docs.size};
  results.push(result);console.log(JSON.stringify(result));
}
fs.writeFileSync(output,JSON.stringify({mode,scope:'Offline packing only; excludes disk read, PostgreSQL I/O and live gameplay',results},null,2),{flag:'wx',mode:0o600});
