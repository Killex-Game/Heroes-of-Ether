'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {CheckpointCache}=require('../../src/server/persistence/checkpoint-cache');
test('unchanged atomic checkpoints reuse private snapshot; every source replacement invalidates it',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-cache-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let reads=0;const read=()=>({snapshot:{generation:++reads}}),cache=new CheckpointCache(dir,read);
 const first=cache.snapshot();assert.strictEqual(cache.snapshot(),first);assert.equal(reads,1);
 for(const file of cache.files){fs.writeFileSync(path.join(dir,file),'one');const a=cache.snapshot();assert.notStrictEqual(a,first);assert.strictEqual(cache.snapshot(),a);
  const old=fs.statSync(path.join(dir,file));fs.writeFileSync(path.join(dir,file+'.new'),'two');fs.utimesSync(path.join(dir,file+'.new'),old.atime,old.mtime);fs.renameSync(path.join(dir,file+'.new'),path.join(dir,file));assert.notStrictEqual(cache.snapshot(),a);
 }
 assert.equal(reads,7);
 fs.unlinkSync(path.join(dir,'clan-chat.json'));cache.snapshot();assert.equal(reads,8);
});
test('moving or failed checkpoint reads never install a stale cache',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-cache-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let calls=0;
 const cache=new CheckpointCache(dir,()=>{calls++;if(calls===1)fs.writeFileSync(path.join(dir,'profiles.json'),'created');if(calls===2)throw Error('read failed');return {snapshot:{calls}};});
 assert.equal(cache.snapshot().calls,1);assert.throws(()=>cache.snapshot(),/read failed/);assert.equal(cache.snapshot().calls,3);assert.equal(cache.snapshot().calls,3);
});
