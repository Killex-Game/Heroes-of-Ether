"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ProfileJournal,recover,segments,checkpoint}=require('../../src/server/profiles/profile-journal');
const {PinnedWorldReader}=require('../../src/server/persistence/pinned-world-reader');
const saved=pin=>recover(pin.file,false,pin.files).data;
function setup(t,limits={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-window-')),file=path.join(dir,'profiles.json');
 const initial={profiles:{p:{coins:100,history:[1,2,3]},other:{history:['keep']}},clans:{},_journalRevision:1};
 fs.writeFileSync(file,JSON.stringify(initial));const journal=new ProfileJournal(file,{intervalMs:300000,readWindow:limits}),reader=new PinnedWorldReader(),pins=[];
 t.after(async()=>{for(const p of pins)p.release();await journal.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,file,journal,reader,commit(n){const current=journal.previous;const next={...current,profiles:{...current.profiles,p:{...current.profiles.p,coins:n}}};journal.commit(next);},async pin(){const p=await journal.pinSnapshot();pins.push(p);return p;}};
}
test('Repeated checkpoints preserve a single immutable reader base and exact new WAL replay',async t=>{
 const f=setup(t),old=await f.pin(),first=f.reader.read(old).data,original=structuredClone(first);
 for(let n=1;n<=12;n++){
  f.commit(100-n);await f.journal.requestCheckpoint();const p=await f.pin(),result=f.reader.read(p);
  assert.equal(f.reader.stats.incremental,true);assert.equal(f.reader.stats.replayed,1);
  assert.deepEqual(result.data,recover(f.file).data);assert.strictEqual(result.data.profiles.other,first.profiles.other);
  assert.deepEqual(saved(old),original);p.release();
 }
 assert.deepEqual(first,original);
});
test('Reader pins remain valid while the retained window grows and expires',async t=>{
 let at=100;const f=setup(t,{now:()=>at,maxAgeMs:10});f.commit(90);const old=await f.pin(),world=saved(old);
 f.reader.read(old);at+=10;f.commit(80);await f.journal.requestCheckpoint();const next=await f.pin();
 assert.deepEqual(f.reader.read(next).data,recover(f.file).data);assert.equal(f.reader.stats.incremental,false);
 assert.deepEqual(saved(old),world);assert(f.journal.readWindow.current.at===at);
});
for(const limits of [{maxFiles:2},{maxBytes:500}])test('Retained journal bounds force a complete verified rebase: '+JSON.stringify(limits),async t=>{
 const f=setup(t,limits);f.reader.read(await f.pin());let rebased=false;
 for(let n=1;n<=9;n++){
  f.commit(n);await f.journal.requestCheckpoint();const p=await f.pin();assert.deepEqual(f.reader.read(p).data,recover(f.file).data);
  rebased ||= !f.reader.stats.incremental;
  const w=f.journal.readWindow.current;if(w){assert(w.rows.size<=(limits.maxFiles||2048));assert(w.bytes<=(limits.maxBytes||16*1024*1024));}p.release();
 }
 assert(rebased);
});
test('Failure to retain a link falls back to canonical recovery without losing or duplicating a commit',async t=>{
 const f=setup(t);f.reader.read(await f.pin());const oldDir=path.dirname(f.journal.readWindow.current.pin.file);f.commit(99);
 const original=fs.promises.link;let injected=false;const m=t.mock.method(fs.promises,'link',async(a,b)=>{if(!injected&&path.dirname(b)===oldDir){injected=true;throw Object.assign(Error('injected'),{code:'ENOSPC'});}return original(a,b);});
 await f.journal.requestCheckpoint();m.mock.restore();assert(injected);assert.equal(f.journal.readWindow.current,null);
 const p=await f.pin();assert.deepEqual(f.reader.read(p).data,recover(f.file).data);assert.equal(f.reader.stats.incremental,false);
 assert.equal(f.reader.previous.revision,2);assert.equal(f.journal.readWindow.lastError,'ENOSPC');
});
test('Checkpoint only consumes its captured segments, leaving a later sealed commit for the next window',async t=>{
 const f=setup(t);f.commit(90);f.journal.sealActive();const selected=segments(f.file);
 f.commit(80);f.journal.sealActive();const all=segments(f.file);assert.equal(all.length,2);
 const result=checkpoint(f.file,selected);assert.equal(result.revision,2);assert.equal(JSON.parse(fs.readFileSync(f.file)).profiles.p.coins,90);
 assert.equal(fs.existsSync(all[1]),true);assert.equal(recover(f.file).data.profiles.p.coins,80);
});
test('A staged cast arriving during a checkpoint is retained before its later checkpoint deletes it',async t=>{
 const f=setup(t);f.reader.read(await f.pin());f.commit(90);const pending=f.journal.requestCheckpoint();
 const next=structuredClone(f.journal.previous);next.profiles.p.coins=80;const entry=await f.journal.stage(next);assert(f.journal.publishStaged(entry,next));
 await pending;await f.journal.requestCheckpoint();const p=await f.pin();assert.deepEqual(f.reader.read(p).data,recover(f.file).data);assert.equal(f.reader.stats.incremental,true);assert.equal(f.reader.previous.revision,3);
});

function pauseLink(t, directory) {
 let release, entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 const original=fs.promises.link;let once=false;
 const mock=t.mock.method(fs.promises,'link',async(a,b)=>{
   if(!once&&path.dirname(b)===directory){once=true;entered();await gate;}
   return original(a,b);
 });
 t.after(()=>{release();mock.mock.restore();});
 return {ready,release,restore:()=>mock.mock.restore()};
}

test('Delayed async retention leaves the event loop free and preserves concurrent commits and reader order',{timeout:20000},async t=>{
 let hold;t.after(()=>hold?.release());
 const f=setup(t),old=await f.pin(),before=saved(old),directory=path.dirname(old.file);
 f.commit(90);hold=pauseLink(t,directory);const pending=f.journal.requestCheckpoint();await hold.ready;
 assert(f.journal.running);const files=segments(f.file);assert.equal(files.length,1);assert(fs.existsSync(files[0]));
 let ready=false;const reading=f.journal.pinSnapshot().then(pin=>{ready=true;return pin;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ready,false);
 f.commit(80);assert.equal(recover(f.file).data.profiles.p.coins,80);
 hold.release();await pending;const pin=await reading;
 try{assert.deepEqual(saved(pin),recover(f.file).data);assert.equal(saved(pin).profiles.p.coins,80);assert.deepEqual(saved(old),before);}
 finally{pin.release();}
});

test('Retiring a window during an async link waits for capture before removing its directory',{timeout:20000},async t=>{
 let hold;t.after(()=>hold?.release());
 const f=setup(t),old=await f.pin(),directory=path.dirname(old.file);f.commit(90);f.journal.sealActive();
 hold=pauseLink(t,directory);const capture=f.journal.readWindow.captureAsync(segments(f.file));await hold.ready;
 old.release();f.journal.readWindow.reset();let drained=false;
 const cleanup=f.journal.readWindow.drainCleanup().then(()=>drained=true);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);assert(fs.existsSync(directory));
 hold.release();await capture;await cleanup;assert.equal(fs.existsSync(directory),false);
 assert.equal(recover(f.file).data.profiles.p.coins,90);
});

test('A checkpoint worker exiting during delayed retention rejects once and a fresh worker recovers the exact WAL',{timeout:20000},async t=>{
 let hold;t.after(()=>hold?.release());
 const f=setup(t),old=await f.pin();f.commit(95);await f.journal.requestCheckpoint();f.commit(90);
 hold=pauseLink(t,path.dirname(old.file));const pending=f.journal.requestCheckpoint();
 const rejected=assert.rejects(pending,/checkpoint worker exited/);await hold.ready;
 await f.journal.worker.terminate();await rejected;
 assert.equal(recover(f.file).data.profiles.p.coins,90);
 hold.release();await f.journal.checkpointCapture;hold.restore();
 await f.journal.requestCheckpoint();const latest=await f.pin();assert.deepEqual(saved(latest),recover(f.file).data);
 assert.equal(saved(latest).profiles.p.coins,90);
});
