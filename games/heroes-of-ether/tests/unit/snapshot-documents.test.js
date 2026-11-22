"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {documentSize}=require('../../src/server/persistence/snapshot-size');
const {compatible:assertCompatible,differences,encode,decode}=require('../../src/server/persistence/postgresql-state');
const {pack,unpack,hash}=require('../../src/server/persistence/state-snapshot');
const big=()=>({profiles:{p:{wallet:{coins:7},roulette:{results:['🧪'.repeat(2300000)]},receipts:{a:{ok:true}}}},clans:{},_journalRevision:3});
const wire=doc=>{const row=encode(doc);return decode({...row,id:row._id});};
const apply=(previous,next)=>{
 const rows=new Map([...previous.docs].map(([id,doc])=>[id,wire(doc)])),delta=differences(previous,next);
 for(const id of delta.deletes)rows.delete(id);
 for(const row of delta.writes)rows.set(row._id,decode({...row,id:row._id}));
 return [...rows.values()];
};
test('large profiles round-trip exact Unicode, balances and receipts through compressed database documents',()=>{
 const world=big(),snapshot=pack(world);
 assert(snapshot.docs.get('profiles:p').chunked);assert([...snapshot.docs.values()].every(d=>documentSize(d)<3*1024*1024));
 // Real UTF-8 compression detects surrogate loss across fragment boundaries.
 const rows=[...snapshot.docs.values()].map(wire).reverse();
 assert.deepEqual(unpack(rows,snapshot).world,world);
 assert.equal(snapshot.worldHash,hash(world));
 world.profiles.p.wallet.coins++;assert.equal(unpack(rows,snapshot).world.profiles.p.wallet.coins,7);
});
test('legacy profile migrates and later shrinks atomically without changing logical history',()=>{
 const world=big(),old=pack(world,{}, {documentFormat:0}),next=pack(world);
 assertCompatible({...old,version:1,sourceId:'s'},next,'s');
 assert.deepEqual(unpack(apply(old,next),next).world,world);
 const legacy={...old};delete legacy.documentFormat;assert.deepEqual(unpack([...old.docs.values()],legacy).world,world);
 world.profiles.p.roulette.results=[];world._journalRevision++;
 const small=pack(world);assert.deepEqual(unpack(apply(next,small),small).world,world);
});
test('missing, duplicate, orphaned, corrupt and wrongly tagged fragments fail closed',()=>{
 const snapshot=pack(big()),docs=[...snapshot.docs.values()];
 const reject=items=>assert.throws(()=>unpack(items,snapshot));
 reject(docs.slice(1));reject([...docs,docs[0]]);
 reject(docs.map((d,i)=>i===0?{...d,value:d.value+'x'}:d));
 reject(docs.map(d=>d.chunked?{...d,chunked:false}:d));
 reject([...docs,{_id:'chunk:orphan:0',value:'{}',hash:hash('{}')}]);
 reject(docs.map(d=>d.chunked?{...d,value:{count:999999999,hash:d.value.hash},hash:hash({count:999999999,hash:d.value.hash})}:d));
 assert.throws(()=>unpack(docs,{...snapshot,documentFormat:0}));
 assert.throws(()=>unpack(docs,{...snapshot,documentFormat:2}));
});
test('a profile beyond the old 14 MiB guard is kept intact without raising version-1 size limits',()=>{
 const world=big();world.profiles.p.roulette.results.push('x'.repeat(7*1024*1024));
 assert.throws(()=>pack(world,{}, {documentFormat:0}),{code:'DATABASE_DOCUMENT_TOO_LARGE'});
 const snapshot=pack(world);assert.deepEqual(unpack([...snapshot.docs.values()],snapshot).world,world);
 const same=pack(world);assert.equal(differences(snapshot,same).writes.length,0);
});
