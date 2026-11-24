"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ProfileJournal}=require('../../src/server/profiles/profile-journal');
const {PinnedWorldReader}=require('../../src/server/persistence/pinned-world-reader');
const {readLocal}=require('../../src/server/persistence/state-snapshot');
const {CheckpointCache}=require('../../src/server/persistence/checkpoint-cache');
const {DatabaseSync}=require('../../src/server/persistence/database-sync');
const {filesFor}=require('../../src/server/profiles/profile-read-snapshot');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-lease-')),file=path.join(dir,'profiles.json');
 fs.writeFileSync(file,JSON.stringify({_journalRevision:1,profiles:{p:{coins:10}},clans:{}}));
 const journal=new ProfileJournal(file,{intervalMs:300000}),pins=[];
 t.after(async()=>{pins.forEach(p=>p.release());await journal.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,journal,async pin(){const p=await journal.pinSnapshot();pins.push(p);return p;},commit(coins){journal.commit({...journal.previous,profiles:{p:{coins}}});}};
}
test('A reader manifest stays exact while the shared directory grows; no links created by another reader',async t=>{
 const f=setup(t),first=await f.pin(),reader=new PinnedWorldReader();const original=reader.read(first).data;
 f.commit(9);await f.journal.requestCheckpoint();const second=await f.pin();
 assert.equal(first.file,second.file);assert.equal(first.files.length,0);assert.equal(second.files.length,1);assert(Object.isFrozen(first.files));
 assert.deepEqual(new PinnedWorldReader().read(first).data,original);
 assert.deepEqual(readLocal(f.dir,false,first).world,original);
 const cache=new CheckpointCache(f.dir,(...args)=>readLocal(...args));const old=cache.snapshot(first);
 assert.equal(cache.snapshot(second).revision,2);assert.equal(cache.snapshot(first).digest,old.digest);
 const link=t.mock.method(fs,'linkSync',()=>{throw Error('Reader must not create more links');});
 const third=await f.pin();assert.deepEqual(third.files,second.files);assert.equal(reader.read(third).data.profiles.p.coins,9);link.mock.restore();
});
test('Retirement and writer close cannot remove inputs until all reader leases finish',async t=>{
 const f=setup(t),a=await f.pin(),b=await f.pin(),directory=path.dirname(a.file);
 f.journal.readWindow.reset();assert(fs.existsSync(directory));a.release();a.release();assert(fs.existsSync(directory));
 await f.journal.close();assert(fs.existsSync(directory));assert.equal(new PinnedWorldReader().read(b).data.profiles.p.coins,10);
 await b.release();assert(!fs.existsSync(directory));
});
test('Explicit WAL manifests reject duplicates, reversed order, active appends and other paths',()=>{
 const file='/snapshot.json';
 assert.deepEqual(filesFor({file,files:[]}),[]);
 for(const files of [null,[file+'.wal'],[file+'.wal-1',file+'.wal-1'],[file+'.wal-2',file+'.wal-1'],['/other.wal-1'],[file+'.wal-9007199254740993']])
  assert.throws(()=>filesFor({file,files}),/Invalid profile snapshot/);
});
test('Database worker commands receive the exact immutable manifest and release after failure',async()=>{
 const files=['/snapshot.json.wal-1'];let released=0;const seen=[];
 const owner={profiles:{journal:{async pinSnapshot(){return{file:'/snapshot.json',files,revision:1,release(){released++;}};}}},
  async command(name,source){seen.push(source);if(name==='sync')throw Error('offline');}};
 await assert.rejects(DatabaseSync.prototype.flush.call(owner),/offline/);assert.equal(released,1);
 assert.deepEqual(seen,[{file:'/snapshot.json',files,revision:1},{file:'/snapshot.json',files,revision:1}]);
});
