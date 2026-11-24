"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {ProfileJournal,recover}=require("../../src/server/profiles/profile-journal");
const {readLocal,pack}=require("../../src/server/persistence/state-snapshot");
const {CheckpointCache}=require("../../src/server/persistence/checkpoint-cache");
const {DatabaseSync}=require("../../src/server/persistence/database-sync");
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"database-pin-")),file=path.join(dir,"profiles.json");const initial={profiles:{p:{coins:10,receipts:{old:true},history:[1,2,3]}},clans:{c:{members:["p"]}},_journalRevision:1};fs.writeFileSync(file,JSON.stringify(initial));const journal=new ProfileJournal(file,{intervalMs:300000});const pins=[];t.after(async()=>{for(const p of pins)p.release();await journal.close();fs.rmSync(dir,{recursive:true,force:true});});return{dir,file,initial,journal,async pin(){const p=await journal.pinSnapshot();pins.push(p);return p;}};}
test("Pinned durable revision survives later commits and checkpoint deletion without rewriting the snapshot",async t=>{
 const f=setup(t),before=fs.statSync(f.file).mtimeMs;
 const next={...f.initial,profiles:{p:{coins:9,receipts:{old:true,paid:true},history:[1,2,3,4]}}};f.journal.commit(next);
 const p=await f.pin();assert.equal(fs.statSync(f.file).mtimeMs,before);assert.equal(JSON.parse(fs.readFileSync(f.file)).profiles.p.coins,10);
 const expected=pack({...next,_journalRevision:2});assert.equal(readLocal(f.dir,false,p).snapshot.digest,expected.digest);
 f.journal.commit({...next,profiles:{p:{...next.profiles.p,coins:8}}});await f.journal.requestCheckpoint();
 assert.equal(readLocal(f.dir,false,p).snapshot.digest,expected.digest);assert.equal(readLocal(f.dir).world.profiles.p.coins,8);
 assert.equal(fs.readFileSync(p.file+'.wal-2').length>0,true);
 f.journal.readWindow.reset();assert.equal(fs.existsSync(path.dirname(p.file)),true);
 await p.release();assert.equal(fs.existsSync(path.dirname(p.file)),false);p.release();
});
test("Unchanged pinned revisions reuse packed cache; changed sealed WAL invalidates it",async t=>{
 const f=setup(t);let reads=0;const cache=new CheckpointCache(f.dir,(...args)=>{reads++;return readLocal(...args);});
 const a=await f.pin(),first=cache.snapshot(a);a.release();const b=await f.pin();assert.strictEqual(cache.snapshot(b),first);assert.equal(reads,1);b.release();
 f.journal.commit({...f.initial,profiles:{p:{coins:20,receipts:{},history:[]}}});const c=await f.pin();assert.equal(cache.snapshot(c).revision,2);assert.equal(reads,2);assert.notStrictEqual(cache.snapshot(c),first);
});
test("A pin waits for asynchronous fsync publication and contains the committed revision",async t=>{
 const f=setup(t);let published=false;const next={...f.initial,profiles:{p:{coins:12}}};
 const commit=f.journal.commitArena(next,()=>{published=true;});const pinned=f.pin();await commit;const p=await pinned;
 assert.equal(published,true);assert.equal(readLocal(f.dir,false,p).world.profiles.p.coins,12);assert.equal(p.revision,2);
});
test("Pinned input rejects a wrong revision, missing commit and corrupt sealed data",async t=>{
 const f=setup(t);f.journal.commit({...f.initial,profiles:{p:{coins:8}}});const p=await f.pin();
 assert.throws(()=>readLocal(f.dir,false,{file:p.file,revision:3}),{code:"DATABASE_INVALID_REVISION"});
 // Remove a link, never modify shared bytes of the original durable WAL.
 const segment=p.file+'.wal-2',valid=fs.readFileSync(segment);fs.unlinkSync(segment);
 // The explicit manifest requires this exact file; no directory rescan can
 // silently omit the lost segment and produce a shorter revision instead.
 assert.throws(()=>readLocal(f.dir,false,p),{code:"ENOENT"});
 fs.writeFileSync(segment,Buffer.from(valid.toString().replace('coins":8','coins":9')));
 assert.throws(()=>readLocal(f.dir,false,p),/checksum mismatch/);
});
test("A pin waits for an in-flight checkpoint and has the same full recovery digest",async t=>{
 const f=setup(t);f.journal.commit({...f.initial,profiles:{p:{coins:15}}});const checkpoint=f.journal.requestCheckpoint();const p=await f.pin();await checkpoint;
 assert.equal(readLocal(f.dir,false,p).snapshot.digest,readLocal(f.dir,true).snapshot.digest);
});
test("Closed journal refuses a new pin and stale crash links are cleaned on exclusive reopen",async t=>{
 const f=setup(t);const p=await f.pin();await f.journal.close();await assert.rejects(f.journal.pinSnapshot(),/unavailable/);
 const reopened=new ProfileJournal(f.file,{intervalMs:300000});assert.equal(fs.existsSync(path.dirname(p.file)),false);await reopened.close();
 // The previous process lost its release callback when it crashed.
 p.release=()=>{};
});
test("Regular database flush syncs pinned WAL without calling a full checkpoint and always releases it",async()=>{
 const calls=[];let fail=false;
 const owner={profiles:{journal:{async pinSnapshot(){calls.push('pin');return{file:'immutable',revision:4,release(){calls.push('release');}}},requestCheckpoint(){throw Error('unnecessary full rewrite');}}},chat:{writer:{async checkpoint(){calls.push('chat');}}},async command(name,source){calls.push(name);assert.deepEqual(source,{file:'immutable',revision:4});if(fail)throw Error('network');return{revision:4};}};
 assert.deepEqual(await DatabaseSync.prototype.flush.call(owner),{revision:4});assert.deepEqual(calls,['chat','pin','prepare','sync','release']);fail=true;await assert.rejects(DatabaseSync.prototype.flush.call(owner),/network/);assert.equal(calls.at(-1),'release');
});
test("Final database flush uses the already closed durable checkpoint without opening new links",async()=>{
 const commands=[];
 const owner={profiles:{journal:{pinSnapshot(){throw Error('journal closed');}}},async command(name,source){commands.push(name);assert.equal(source,null);return{revision:5};}};
 assert.deepEqual(await DatabaseSync.prototype.flush.call(owner,true),{revision:5});
 assert.deepEqual(commands,['prepare','sync']);
});

test("Database sync waits for asynchronous pin cleanup after the durable response",async()=>{
 let begin,finish,settled=false;const entered=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>finish=resolve);
 const calls=[],owner={profiles:{journal:{async pinSnapshot(){return{file:'immutable',revision:4,
  release(){throw Error('Blocking cleanup must not run');},async releaseAsync(){calls.push('cleanup');begin();await gate;}};}}},
  async command(name){calls.push(name);return{revision:4};}};
 const pending=DatabaseSync.prototype.flush.call(owner).then(value=>{settled=true;return value;});
 await entered;assert.deepEqual(calls,['prepare','sync','cleanup']);assert.equal(settled,false);assert(owner.running);
 finish();assert.deepEqual(await pending,{revision:4});assert.equal(owner.running,null);
});
