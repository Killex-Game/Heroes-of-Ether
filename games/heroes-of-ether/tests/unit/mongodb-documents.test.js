"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {BSON}=require('mongodb');
const {pack,unpack,changes,hash,assertCompatible}=require('../../src/server/persistence/mongodb-state');
const big=()=>({profiles:{p:{wallet:{coins:7},roulette:{results:['🧪'.repeat(2300000)]},receipts:{a:{ok:true}}}},clans:{},_journalRevision:3});
const apply=(previous,operations)=>{
 const rows=new Map([...previous.docs].map(([id,doc])=>[id,structuredClone(doc)]));
 for(const op of operations){
  if(op.insertOne){const d=op.insertOne.document;assert(!rows.has(d._id));rows.set(d._id,structuredClone(d));continue;}
  if(op.deleteOne){assert(rows.delete(op.deleteOne.filter._id));continue;}
  const doc=rows.get(op.updateOne.filter._id);assert(doc);
  for(const [kind,fields]of Object.entries(op.updateOne.update))for(const [key,value]of Object.entries(fields)){
   const keys=key.split('.');let target=doc;for(const k of keys.slice(0,-1))target=target[k];
   if(kind==='$set')target[keys.at(-1)]=structuredClone(value);else delete target[keys.at(-1)];
  }
 }return [...rows.values()];
};
test('large profiles round-trip exact Unicode, balances and receipts through small BSON documents',()=>{
 const world=big(),snapshot=pack(world);
 assert(snapshot.docs.get('profiles:p').chunked);assert([...snapshot.docs.values()].every(d=>BSON.calculateObjectSize(d)<3*1024*1024));
 // Real BSON encoding detects a surrogate accidentally split across chunks.
 const wire=[...snapshot.docs.values()].map(d=>BSON.deserialize(BSON.serialize(d))).reverse();
 assert.deepEqual(unpack(wire,snapshot).world,world);
 assert.equal(snapshot.worldHash,hash(world));
 world.profiles.p.wallet.coins++;assert.equal(unpack(wire,snapshot).world.profiles.p.wallet.coins,7);
});
test('legacy profile migrates and later shrinks atomically without changing logical history',()=>{
 const world=big(),old=pack(world,{}, {documentFormat:0}),next=pack(world);
 assertCompatible({...old,version:1,sourceId:'s'},next,'s');
 assert.deepEqual(unpack(apply(old,changes(old,next)),next).world,world);
 const legacy={...old};delete legacy.documentFormat;assert.deepEqual(unpack([...old.docs.values()],legacy).world,world);
 world.profiles.p.roulette.results=[];world._journalRevision++;
 const small=pack(world);assert.deepEqual(unpack(apply(next,changes(next,small)),small).world,world);
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
test('a profile beyond the old 14 MiB guard is kept intact without raising the BSON limit',()=>{
 const world=big();world.profiles.p.roulette.results.push('x'.repeat(7*1024*1024));
 assert.throws(()=>pack(world,{}, {documentFormat:0}),{code:'MONGO_DOCUMENT_TOO_LARGE'});
 const snapshot=pack(world);assert.deepEqual(unpack([...snapshot.docs.values()],snapshot).world,world);
 const same=pack(world);assert.deepEqual(changes(snapshot,same),[]);
});
