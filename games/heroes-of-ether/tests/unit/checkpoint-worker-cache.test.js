"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {createCheckpointWriter,checkpoint,recover,atomicSnapshot}=require('../../src/server/profiles/profile-journal');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-worker-cache-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'profiles.json');}
function wal(file,revision,change){const body=JSON.stringify({revision,change}),bytes=createHash('sha256').update(body).digest('hex')+' '+body+'\n';fs.writeFileSync(file+'.wal-'+revision,bytes);return bytes;}
const edit=(coins,receipt)=>({set:{future:{nested:['Ж 🐲',receipt]}},remove:[],tables:{profileEdits:{p:{set:{coins},remove:[],nested:{receipts:{set:{[receipt]:coins},remove:[]}}}}}});
const base=()=>({version:14,profiles:{p:{coins:100,receipts:{old:1}},idle:{history:['preserved']}},clans:{c:{xp:9}},_journalRevision:1});
function warm(t){const file=setup(t),write=createCheckpointWriter(file);atomicSnapshot(file,base());wal(file,2,edit(90,'first'));write();return {file,write};}

test('Repeated cached checkpoints preserve exact cold recovery bytes and fresh writer recovery',t=>{
 const {file,write}=warm(t),reference=setup(t);fs.copyFileSync(file,reference);
 for(let revision=3;revision<=8;revision++){
  const change=edit(100-revision,'r'+revision);wal(file,revision,change);wal(reference,revision,change);
  // An active, unfinished append is never included in a sealed checkpoint.
  fs.writeFileSync(file+'.wal','torn active');
  const result=(revision===6?createCheckpointWriter(file):write)();checkpoint(reference);
  assert.equal(result.revision,revision);assert.deepEqual(fs.readFileSync(file),fs.readFileSync(reference));
  assert.deepEqual(recover(file).data,recover(reference).data);
 }
 assert.deepEqual(write(),{revision:0,bytes:0});
});

test('An external checkpoint replacement invalidates the cached base',t=>{
 const {file,write}=warm(t),external=base();external.profiles.p.coins=700;external.profiles.p.receipts.external='retained';external._journalRevision=20;
 atomicSnapshot(file,external);wal(file,21,edit(680,'after-external'));
 const expected=recover(file).data;write();assert.deepEqual(recover(file).data,expected);assert.equal(expected.profiles.p.receipts.external,'retained');
});

test('Changed in-place checkpoint bytes are read again rather than silently trusted',t=>{
 const {file,write}=warm(t);fs.writeFileSync(file,'{broken');wal(file,3,edit(80,'third'));
 assert.throws(write,SyntaxError);assert(fs.existsSync(file+'.wal-3'));
 const restored=base();restored._journalRevision=2;atomicSnapshot(file,restored);const expected=recover(file).data;write();assert.deepEqual(recover(file).data,expected);
});

test('A missing cached checkpoint cannot hide the missing journal history',t=>{
 const {file,write}=warm(t);fs.unlinkSync(file);wal(file,3,edit(80,'third'));
 assert.throws(write,/Missing profile journal commit/);assert(fs.existsSync(file+'.wal-3'));
});

test('A malformed later edit discards partially replayed cached data',t=>{
 const {file,write}=warm(t),before=fs.readFileSync(file);
 wal(file,3,edit(80,'third'));wal(file,4,{set:{},remove:[],tables:{profileEdits:{missing:{set:{coins:0},remove:[]}}}});
 assert.throws(write,/Missing base profile/);assert.deepEqual(fs.readFileSync(file),before);
 wal(file,4,edit(70,'fourth'));const expected=recover(file).data;write();assert.deepEqual(recover(file).data,expected);assert.deepEqual(expected.profiles.p.receipts,{old:1,first:90,third:80,fourth:70});
});

for(const fault of ['writeFileSync','fsyncSync','renameSync'])test('Warm checkpoint survives '+fault+' failure and exact retry',t=>{
 const {file,write}=warm(t),before=fs.readFileSync(file),bytes=wal(file,3,edit(80,'third')),expected=recover(file).data;
 const original=fs[fault];let failed=false;
 const mock=t.mock.method(fs,fault,(...args)=>{if(!failed){failed=true;throw Error('injected '+fault);}return original(...args);});
 assert.throws(write,/injected/);mock.mock.restore();
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.readFileSync(file+'.wal-3','utf8'),bytes);assert.deepEqual(recover(file).data,expected);
 write();assert.deepEqual(recover(file).data,expected);assert.equal(fs.existsSync(file+'.wal-3'),false);
});

test('Partial cleanup reports removed bytes and replays remaining old segments without duplicates',t=>{
 const {file,write}=warm(t),first=wal(file,3,edit(80,'third'));wal(file,4,edit(70,'fourth'));const expected=recover(file).data;
 const original=fs.unlinkSync,mock=t.mock.method(fs,'unlinkSync',p=>{if(p===file+'.wal-4')throw Error('injected cleanup');return original(p);});
 assert.throws(write,e=>e.message==='injected cleanup'&&e.removedBytes===Buffer.byteLength(first));mock.mock.restore();
 assert.deepEqual(recover(file).data,expected);write();assert.deepEqual(recover(file).data,expected);assert.equal(fs.existsSync(file+'.wal-4'),false);
});

test('Warm reuse still verifies sealed checksums, complete records and revision sequence',t=>{
 for(const damage of ['checksum','truncated','gap']){
  const {file,write}=warm(t),before=fs.readFileSync(file),bytes=wal(file,3,edit(80,'third'));
  if(damage==='checksum')fs.writeFileSync(file+'.wal-3',bytes.replace('80','81'));
  if(damage==='truncated')fs.writeFileSync(file+'.wal-3',bytes.slice(0,-1));
  if(damage==='gap'){fs.unlinkSync(file+'.wal-3');wal(file,4,edit(70,'fourth'));}
  assert.throws(write,/checksum|Truncated|Missing profile journal commit/);assert.deepEqual(fs.readFileSync(file),before);
 }
});
