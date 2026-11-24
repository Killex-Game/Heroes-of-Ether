'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ProfileJournal,recover}=require('../../src/server/profiles/profile-journal');
const writer=require('../../src/server/profiles/profile-arena-file');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'async-arena-wal-')),file=path.join(dir,'profiles.json');
 const initial={profiles:{p:{coins:100,xp:0}},clans:{},_journalRevision:1};fs.writeFileSync(file,JSON.stringify(initial));
 const journal=new ProfileJournal(file,{asyncArenaWrites:true,intervalMs:300000});
 t.after(async()=>{await journal.close();assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'async-arena-wal-'));fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,file,journal,next(values){return{...journal.previous,profiles:{p:{...journal.previous.profiles.p,...values}}};}};
}

test('Slow unpublished arena write leaves the loop responsive and acknowledges only the fsynced promoted segment',{timeout:20000},async t=>{
 const gate=deferred(),entered=deferred();t.after(()=>gate.resolve());const f=setup(t),real=writer.writePending;let published=0;
 t.mock.method(writer,'writePending',async(...args)=>{await real(...args);entered.resolve();await gate.promise;});
 const next=f.next({xp:5}),pending=f.journal.commitArena(next,()=>published++);await entered.promise;
 for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(published,0);assert.equal(f.journal.revision,1);assert.equal(recover(f.file).data.profiles.p.xp,0);
 assert(fs.existsSync(f.file+'.arena-pending'));
 gate.resolve();assert.equal(await pending,true);assert.equal(published,1);assert.equal(f.journal.revision,2);
 assert.equal(recover(f.file).data.profiles.p.xp,5);assert(!fs.existsSync(f.file+'.arena-pending'));
});

test('A synchronous wallet commit supersedes a written but unpublished arena file and the arena retries on the new revision',{timeout:20000},async t=>{
 const gate=deferred(),entered=deferred();t.after(()=>gate.resolve());const f=setup(t),real=writer.writePending;let published=0;
 const mock=t.mock.method(writer,'writePending',async(...args)=>{await real(...args);entered.resolve();await gate.promise;});
 const pending=f.journal.commitArena(f.next({xp:5}),()=>published++);await entered.promise;
 f.journal.commit(f.next({coins:80}));assert.equal(f.journal.revision,2);
 gate.resolve();assert.equal(await pending,false);mock.mock.restore();assert.equal(published,0);
 assert.deepEqual(recover(f.file).data.profiles.p,{coins:80,xp:0});
 assert.equal(await f.journal.commitArena(f.next({xp:5}),()=>published++),true);
 assert.equal(published,1);assert.equal(f.journal.revision,3);assert.deepEqual(recover(f.file).data.profiles.p,{coins:80,xp:5});
});

test('A failed partial arena file never enters recovery, and exact retry preserves the previous committed world',async t=>{
 const f=setup(t),mock=t.mock.method(writer,'writePending',async(file,bytes)=>{await fs.promises.writeFile(file,bytes.subarray(0,Math.floor(bytes.length/2)));throw Object.assign(Error('injected'),{code:'EIO'});});
 let published=0;await assert.rejects(f.journal.commitArena(f.next({xp:5}),()=>published++),{code:'EIO'});mock.mock.restore();
 assert.equal(published,0);assert.equal(f.journal.revision,1);assert.equal(recover(f.file).data.profiles.p.xp,0);assert(!fs.existsSync(f.file+'.arena-pending'));
 assert.equal(await f.journal.commitArena(f.next({xp:5}),()=>published++),true);assert.equal(published,1);assert.equal(recover(f.file).data.profiles.p.xp,5);
});

test('Failed promotion leaves only committed WAL and does not acknowledge the pending file',async t=>{
 const f=setup(t);f.journal.commit(f.next({coins:90}));const real=fs.renameSync;
 const mock=t.mock.method(fs,'renameSync',(a,b)=>{if(a===f.file+'.arena-pending')throw Object.assign(Error('injected rename'),{code:'EACCES'});return real(a,b);});let published=0;
 await assert.rejects(f.journal.commitArena(f.next({xp:5}),()=>published++),{code:'EACCES'});mock.mock.restore();
 assert.equal(published,0);assert.deepEqual(recover(f.file).data.profiles.p,{coins:90,xp:0});
 assert.equal(await f.journal.commitArena(f.next({xp:5}),()=>published++),true);assert.equal(published,1);assert.deepEqual(recover(f.file).data.profiles.p,{coins:90,xp:5});
});

test('Checkpoint and reader wait for the arena file to settle and include its confirmed revision exactly once',{timeout:20000},async t=>{
 const gate=deferred(),entered=deferred();t.after(()=>gate.resolve());const f=setup(t),real=writer.writePending;
 t.mock.method(writer,'writePending',async(...args)=>{await real(...args);entered.resolve();await gate.promise;});
 const pending=f.journal.commitArena(f.next({xp:5}),()=>{});await entered.promise;
 let checkpointDone=false,readerDone=false;const checkpoint=f.journal.requestCheckpoint().then(()=>checkpointDone=true),reading=f.journal.pinSnapshot().then(pin=>{readerDone=true;return pin;});
 await new Promise(resolve=>setImmediate(resolve));assert(!checkpointDone&&!readerDone);
 gate.resolve();await pending;await checkpoint;const pin=await reading;
 try{assert.equal(pin.revision,2);assert.deepEqual(recover(pin.file,false,pin.files).data,recover(f.file).data);}finally{pin.release();}
});

for(const mode of ['partial','zero','sync-failure'])test('Pending arena handles '+mode+' I/O without publishing incomplete bytes',async t=>{
 const f=setup(t),real=fs.promises.open;let writes=0,syncs=0,published=0;
 const mock=t.mock.method(fs.promises,'open',async(...args)=>{
  const handle=await real(...args);if(args[0]!==f.file+'.arena-pending')return handle;
  const write=handle.write.bind(handle),sync=handle.sync.bind(handle);
  handle.write=async(buffer,offset,length,position)=>{writes++;if(mode==='zero')return{bytesWritten:0};return write(buffer,offset,Math.min(length,7),position);};
  handle.sync=async()=>{syncs++;if(mode==='sync-failure')throw Object.assign(Error('injected sync'),{code:'EIO'});return sync();};return handle;
 });
 const pending=f.journal.commitArena(f.next({xp:5}),()=>published++);
 if(mode==='partial'){assert.equal(await pending,true);assert(writes>1);assert.equal(syncs,1);assert.equal(published,1);assert.equal(recover(f.file).data.profiles.p.xp,5);}
 else{await assert.rejects(pending);assert.equal(published,0);assert.equal(recover(f.file).data.profiles.p.xp,0);}
 mock.mock.restore();
});

test('Repeated arena commits, synchronous winners and checkpoints keep every confirmed counter and receipt exactly once',async t=>{
 const f=setup(t);let confirmed=0,coins=100;
 for(let i=0;i<32;i++){
  const next=f.next({xp:confirmed+1,receipts:{...f.journal.previous.profiles.p.receipts,[i]:'confirmed'}});
  const pending=f.journal.commitArena(next,()=>confirmed++);
  if(i%2===0){coins--;f.journal.commit(f.next({coins}));assert.equal(await pending,false);
   const retry=f.next({xp:confirmed+1,receipts:{...f.journal.previous.profiles.p.receipts,[i]:'confirmed'}});
   assert.equal(await f.journal.commitArena(retry,()=>confirmed++),true);
  }else assert.equal(await pending,true);
  if(i%5===0)await f.journal.requestCheckpoint();
  const restored=recover(f.file).data.profiles.p;assert.equal(restored.coins,coins);assert.equal(restored.xp,confirmed);assert.equal(Object.keys(restored.receipts).length,confirmed);
 }
 assert.equal(confirmed,32);const pin=await f.journal.pinSnapshot();try{assert.deepEqual(recover(pin.file,false,pin.files).data,recover(f.file).data);}finally{pin.release();}
});
