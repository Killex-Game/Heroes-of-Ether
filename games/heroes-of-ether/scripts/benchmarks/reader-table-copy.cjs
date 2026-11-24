"use strict";
// Exact offline replay of private immutable snapshots, without a database or
// game clients. Large table figures describe preparation cost, not CCU.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict'),{isDeepStrictEqual}=require('node:util');
const {createHash}=require('node:crypto');
const [baselineFile,output]=process.argv.slice(2);assert(baselineFile&&output&&global.gc&&!fs.existsSync(output));
const file=require.resolve('../../src/server/persistence/pinned-world-reader');
const baseline=new Module(file,module);baseline.filename=file;baseline.paths=Module._nodeModulePaths(path.dirname(file));
baseline._compile(fs.readFileSync(baselineFile,'utf8'),file);
const implementations=[baseline.exports.draftWriter,require(file).draftWriter],rows=[];
for(const size of [1280,10000,100000]){
  const original={version:14,profiles:{},clans:{},_journalRevision:1};
  for(let i=0;i<size;i++)original.profiles['p'+i]={id:'p'+i,wallet:{coins:1000},arenaReceipts:{old:'unchanged'}};
  const changes=Array.from({length:16},(_,step)=>({set:{},remove:[],tables:{profileEdits:Object.fromEntries(
    Array.from({length:30},(_,i)=>['p'+((step*31+i)%size),{set:{wallet:{coins:step}},remove:[]}]))}}));
  let reference;
  for(const mode of [0,1,1,0]){
    global.gc();const start=performance.now(),cpu=process.cpuUsage();let actual=original;
    for(let step=0;step<changes.length;step++){
      const draft=implementations[mode](actual);draft.apply(changes[step]);actual=draft.finish(step+2);
    }
    const elapsedMs=performance.now()-start,used=process.cpuUsage(cpu),memory=process.memoryUsage();
    if(reference)assert(isDeepStrictEqual(actual,reference),'Exact reconstructed world differs');else reference=actual;
    assert.equal(original.profiles.p0.wallet.coins,1000);
    assert.equal(actual.profiles['p'+(size-1)],original.profiles['p'+(size-1)]);
    rows.push({size,mode:mode?'candidate':'baseline',elapsedMs,cpuMs:(used.user+used.system)/1000,
      heapMiB:memory.heapUsed/1048576,rssMiB:memory.rss/1048576,
      hash:createHash('sha256').update(JSON.stringify(actual)).digest('hex')});
  }
}
const report={at:new Date().toISOString(),node:process.version,platform:process.platform,exact:true,
  scope:'Private pinned-reader table copy; synthetic in-memory replay only, no persistence or capacity claim',rows};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
