"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const file=require.resolve('../../src/server/profiles/profile-transfer');
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(process.env.BASELINE_TRANSFER,'utf8'),file);
const apply=[old.exports.applyTransfer,require(file).applyTransfer],results=[];
async function run(){
for(const count of [35,1280,5000])for(const edits of [1,35])for(const envelope of ['edits','shard-combined']){
 const profiles=Object.fromEntries(Array.from({length:count},(_,i)=>['player-'+i,{id:'player-'+i,revision:0,wallet:{coins:100},unchanged:{avatar:'one'}}]));
 const baseline={profiles,clans:{one:{xp:100}},revision:0};
 let expected;
 for(const variant of [0,1,1,0]){
  let next=baseline,ms=0;
  for(let step=1;step<=1500;step++){
   const changes=Object.fromEntries(Array.from({length:edits},(_,i)=>['player-'+i,{set:{revision:step},remove:[],nested:{wallet:{set:{coins:100+step},remove:[]}}}]));
   const tables=envelope==='shard-combined'?{profiles:{set:{},remove:[]},profileEdits:changes}:{profileEdits:changes};
   const patch={set:{revision:step},remove:[],tables};
   const start=performance.now();next=apply[variant](next,patch);ms+=performance.now()-start;
   // WeakRef targets remain alive until this JS job ends. Real IPC applies
   // patches in separate jobs; allow the same release here, outside timing.
   if(step%16===0)await new Promise(resolve=>setImmediate(resolve));
  }
  if(expected)assert.deepEqual(next,expected);else expected=next;
  assert.equal(baseline.profiles['player-0'].revision,0);
  results.push({count,edits,envelope,variant:variant?'candidate':'baseline',ms});
 }
}
console.log(JSON.stringify({exact:true,baseline:process.env.BASELINE_TRANSFER,candidate:file,scope:'apply worker profile edits, unchanged nested values retained; no capacity claim',results}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
