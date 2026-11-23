'use strict';
// Offline only. The backup and all measured profiles remain unchanged. Output
// contains aggregate sizes and timings, never identifiers or receipt contents.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{performance}=require('perf_hooks');
const [baselineArg,backupArg,outArg]=process.argv.slice(2);
if(!baselineArg||!backupArg||!outArg)throw Error('Usage: node --expose-gc profile-history-sharing.cjs BASELINE_GAME PG_BACKUP OUTPUT_JSON');
const baseline=path.resolve(baselineArg),backup=path.resolve(backupArg),out=path.resolve(outArg);
const before=require(baseline+'/src/server/profiles/owned-profile-draft'),after=require('../../src/server/profiles/owned-profile-draft');
const {shareArenaData}=require('../../src/server/profiles/arena-profile-copy');
const world=require('../../src/server/persistence/postgresql-backup').loadSnapshot(backup).world;
const ranked=Object.values(world.profiles).map(p=>({p,bytes:Buffer.byteLength(JSON.stringify(p.arenaReceipts||{}))})).sort((a,b)=>b.bytes-a.bytes);
const selected=ranked.slice(0,5),copies=40,rounds=5;
const canonical=selected.map(({p})=>JSON.stringify(p));
function exercise(mod){
 let receipts=0;for(let i=0;i<copies;i++)for(const {p}of selected){const q=mod.lobbyDraft(p);q.wallet={...q.wallet,coins:q.wallet.coins+1};const result=shareArenaData(p,q);receipts+=Object.keys(result.arenaReceipts||{}).length;}
 return receipts;
}
for(let i=0;i<selected.length;i++){
 const p=selected[i].p,a=before.lobbyDraft(p),b=after.lobbyDraft(p);assert.deepEqual(a,b);assert.deepEqual(b,p);
 assert.strictEqual(b.arenaReceipts,p.arenaReceipts);assert.strictEqual(shareArenaData(p,b),p);
}
const samples=[];
for(let round=0;round<rounds;round++){
 const row={round};for(const name of (round%2?['after','before']:['before','after'])){
  global.gc?.();const heap=process.memoryUsage().heapUsed,t=performance.now();const receiptBuckets=exercise(name==='before'?before:after);
  row[name]={ms:performance.now()-t,heapDeltaBytes:process.memoryUsage().heapUsed-heap,receiptBuckets};
 }assert.equal(row.before.receiptBuckets,row.after.receiptBuckets);samples.push(row);
}
for(let i=0;i<selected.length;i++)assert.equal(JSON.stringify(selected[i].p),canonical[i]);
const result={kind:'offline-copy-and-reconcile-only',baseline,profiles:Object.keys(world.profiles).length,selected:5,copiesPerProfilePerRound:copies,rounds,receiptBytes:selected.map(x=>x.bytes),profileBytes:canonical.map(x=>Buffer.byteLength(x)),allFieldsEqual:true,sourceUnchanged:true,samples,wholeGameCapacityProven:false};
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
