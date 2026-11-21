'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {share}=require('../../src/server/profiles/recovery-sharing');
const {ProfileJournal,atomicSnapshot,recover,difference}=require('../../src/server/profiles/profile-journal');
test('startup shares equal archives, preserves migrations and does not mutate either input',()=>{
 const previous={profiles:{p:{receipts:{a:{ok:true}},transactions:{entries:[{id:'old'}]},progress:{xp:1},extra:[1,2]}}};
 const next=structuredClone(previous);next.profiles.p.progress.xp=2;next.profiles.p.transactions.entries.push({id:'new'});delete next.profiles.p.extra;
 const before=structuredClone(previous),after=structuredClone(next),result=share(previous,next);
 assert.deepEqual(result,after);assert.deepEqual(previous,before);assert.deepEqual(next,after);
 assert.strictEqual(result.profiles.p.receipts,previous.profiles.p.receipts);assert.strictEqual(result.profiles.p.transactions.entries[0],previous.profiles.p.transactions.entries[0]);
 assert.notStrictEqual(result.profiles.p.progress,previous.profiles.p.progress);
});
test('first commit after restart stays small despite large identical archives, replays full world',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-share-')),file=path.join(dir,'profiles.json');
 const old={version:1,profiles:{p:{revision:1,receipts:{},roulette:{results:{}},transactions:{entries:[]}}},clans:{}};
 for(let i=0;i<3000;i++){old.profiles.p.roulette.results[i]={id:String(i),result:'x'.repeat(500)};old.profiles.p.transactions.entries.push({id:String(i),detail:'y'.repeat(150)});}
 atomicSnapshot(file,old);const journal=new ProfileJournal(file,{maxPendingBytes:65536});t.after(async()=>{await journal.close();fs.rmSync(dir,{recursive:true,force:true});});
 const next=JSON.parse(fs.readFileSync(file,'utf8'));next.profiles.p.revision++;next.profiles.p.transactions.entries.push({id:'new',detail:'migration'});
 assert(Buffer.byteLength(JSON.stringify(difference(next,journal.previous)))>1000000);
 const merged=share(journal.previous,next);assert(Buffer.byteLength(JSON.stringify(difference(merged,journal.previous)))<2000);
 journal.commit(merged);const saved=recover(file);delete saved.data._journalRevision;assert.deepEqual(saved.data,next);assert.equal(saved.revision,1);
});
test('unknown keys, prototype-like keys, deletions and array lengths remain exact',()=>{
 const a=JSON.parse('{"__proto__":{"x":1},"array":[1,2],"gone":2}'),b=JSON.parse('{"__proto__":{"x":2},"array":[1],"new":null}');
 assert.deepEqual(share(a,b),b);assert.equal({}.x,undefined);assert.deepEqual(share(a,structuredClone(a)),a);
});
