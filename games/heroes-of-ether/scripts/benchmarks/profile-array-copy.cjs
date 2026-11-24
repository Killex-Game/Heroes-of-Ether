"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{createHash}=require('node:crypto');
const [beforeFile,output]=process.argv.slice(2);assert(beforeFile&&output);
const file=require.resolve('../../src/server/profiles/arena-profile-copy'),before=new Module(file,module);
before.filename=file;before.paths=Module._nodeModulePaths(path.dirname(file));before._compile(fs.readFileSync(path.resolve(beforeFile),'utf8'),file);
const implementations=[before.exports,require(file)];
function fixture(length){return{inventory:{meat:17,harpoon:12},rows:Array.from({length},(_,i)=>({id:'r'+i,at:i*1000,amount:i%17,seen:['one','two',null],nested:{key:'Эфир '+i,flag:i%2===0}})),unusual:[undefined,,NaN,Infinity,-0],map:JSON.parse('{"__proto__":{"saved":true}}')};}
const results=[];
for(const size of [32,1024,10000]){
 const source=fixture(size),expected=JSON.parse(JSON.stringify(source));
 const hash=createHash('sha256').update(JSON.stringify(expected)).digest('hex');
 for(const variant of [0,1,1,0]){
  global.gc?.();const api=implementations[variant],iterations=size===32?1000:size===1024?80:12;
  let copyMs=0,cloneMs=0,reconcileMs=0;const cpu=process.cpuUsage();
  for(let i=0;i<iterations;i++){
   const started=performance.now(),draft=api.copyArenaData(source),copied=performance.now(),transfer=structuredClone(draft),cloned=performance.now();
   draft.rows.at(-1).amount++;const reconciled=api.shareArenaData(expected,draft),ended=performance.now();
   copyMs+=copied-started;cloneMs+=cloned-copied;reconcileMs+=ended-cloned;
   if(i===0||i===iterations-1){assert.deepEqual(transfer,expected);assert.equal(reconciled.rows[0],expected.rows[0]);assert.equal(reconciled.rows.at(-1).amount,expected.rows.at(-1).amount+1);assert.equal(createHash('sha256').update(JSON.stringify(expected)).digest('hex'),hash);}
  }
  const used=process.cpuUsage(cpu);results.push({variant:variant?'candidate':'baseline',size,iterations,copyMs,cloneMs,reconcileMs,cpuMs:(used.user+used.system)/1000,hash,rssMiB:process.memoryUsage().rss/1048576});
 }
}
const report={node:process.version,platform:process.platform,results,scope:'Plain persisted JSON draft arrays, reconciliation and structuredClone only; no game load, network, filesystem or PostgreSQL; not a capacity claim'};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,rows:results.length}));
