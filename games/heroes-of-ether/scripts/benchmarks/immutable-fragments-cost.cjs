"use strict";
const path=require("node:path"),fs=require("node:fs"),cp=require("node:child_process"),assert=require("node:assert/strict");
const {performance}=require("node:perf_hooks");
if(process.argv[2]!=="child"){
  const baseline=path.resolve(process.argv[2]||"");assert(fs.existsSync(baseline));
  const results=[];
  for(const variant of ["baseline","candidate","candidate","baseline"]){
    const child=cp.spawnSync(process.execPath,[__filename,"child",variant,baseline],{encoding:"utf8",windowsHide:true,maxBuffer:8*1024*1024});
    assert.equal(child.status,0,child.stderr);results.push(JSON.parse(child.stdout));
  }
  for(const row of results)assert.deepEqual(row.frames,results[0].frames);
  console.log(JSON.stringify({at:new Date().toISOString(),platform:process.platform,node:process.version,
    scope:"Oversized synthetic profile snapshot component only; no live data, whole-game CPU or CCU claim",exactFrames:results[0].frames.length,
    results:results.map(({frames,...row})=>row)},null,2));
}else{
  const variant=process.argv[3],file=variant==="baseline"?process.argv[4]:path.resolve(__dirname,"../../src/server/persistence/snapshot-builder.js");
  const {SnapshotBuilder}=require(file),arenaReceipts={};
  for(let bucket=0;bucket<32;bucket++){
    const values={};for(let i=0;i<1000;i++)values[`receipt-${bucket}-${i}`]='🧪я"\\'.repeat(36);
    arenaReceipts[`bucket-${bucket}`]=values;
  }
  let owned={_journalRevision:1,profiles:{p:{wallet:{coins:7},arenaReceipts}},clans:{}};
  const builder=new SnapshotBuilder({immutableSource:{owns:value=>value===owned}}),frames=[];
  const cpu=process.cpuUsage(),start=performance.now(),initial=builder.pack(owned),coldMs=performance.now()-start;
  assert(initial.docs.get("profiles:p").chunked);
  const capture=s=>frames.push({worldHash:s.worldHash,digest:s.digest,documents:s.docs.size});capture(initial);
  const warmStart=performance.now();let fieldsReused=0;
  for(let tick=0;tick<12;tick++){
    const before=owned.profiles.p;
    const receipts=tick===7?{...before.arenaReceipts,"bucket-1":{...before.arenaReceipts["bucket-1"],last:"new😀"}}:before.arenaReceipts;
    owned={...owned,_journalRevision:tick+2,profiles:{p:{...before,wallet:{coins:8+tick},arenaReceipts:receipts}}};
    capture(builder.pack(owned));fieldsReused+=builder.stats.fieldReused;
  }
  const warmMs=performance.now()-warmStart,usage=process.cpuUsage(cpu);
  console.log(JSON.stringify({variant,coldMs,warmMs,cpuMs:(usage.user+usage.system)/1000,maxRSSKiB:process.resourceUsage().maxRSS,
    memory:process.memoryUsage(),fieldsReused,frames}));
}
