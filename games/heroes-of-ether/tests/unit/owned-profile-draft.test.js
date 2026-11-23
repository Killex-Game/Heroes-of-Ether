"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const {copyProfile,lobbyDraft}=require("../../src/server/profiles/owned-profile-draft");
const {ProfileStore}=require("../../src/server/profiles/profile-store");
const history=require("../../src/server/profiles/transaction-history");
const roulette=require("../../src/server/roulette/roulette-service");
const rules=require("../../public/shared/roulette-rules");
const operations=require("../../src/server/profiles/operation-receipts");
const at=Date.parse("2026-11-16T12:00:00Z");
const freeze=x=>{if(x&&typeof x==="object"&&!Object.isFrozen(x)){Object.freeze(x);Object.values(x).forEach(freeze);}return x;};
function fixture(){
 const s=new ProfileStore({now:()=>at,incrementalSettlement:true,rouletteConfig:{testEnabled:true}}),u=s.open();
 const p=s.find(u.token);p.wallet.coins=100000;p.wallet.crystals=10000;
 history.capture(p,at,{kind:"fixture",label:"Fixture"});
 p.roulette.offer=roulette.makeOffer(at,()=>0);p.roulette.tickets=10;p.roulette.earned=10;
 return {s,u};
}
test("audited copies isolate all mutable and unknown fields, retaining only immutable archives",()=>{
 const p=freeze({wallet:{coins:1},inventory:{a:2},future:{nested:[{x:1}]},transactions:{entries:[{id:"a"}]},receipts:{a:"b"},arenaReceipts:{0:{a:"b"}},roulette:{offer:{slots:[{amount:3}]},results:{a:{index:1}}}});
 for(const copy of [copyProfile,lobbyDraft]){
  const q=copy(p);assert.deepEqual(q,p);
  for(const k of ["transactions","receipts","arenaReceipts"])assert.strictEqual(q[k],p[k]);
  assert.strictEqual(q.roulette.results,p.roulette.results);
  q.wallet.coins++;q.inventory.a++;q.future.nested[0].x++;q.roulette.offer.slots[0].amount++;
  assert.equal(p.wallet.coins,1);assert.equal(p.inventory.a,2);assert.equal(p.future.nested[0].x,1);assert.equal(p.roulette.offer.slots[0].amount,3);
 }
 assert.deepEqual(copyProfile({id:"legacy"}),{id:"legacy"});
});
test("generic transaction callbacks retain full isolation even for historical archives",()=>{
 const {s,u}=fixture(),id=randomUUID();operations.recordArena(s.find(u.token),id,"old-cast");
 const old=freeze(s.data),p=s.find(u.token),before=JSON.stringify(old);
 assert.throws(()=>s.transact(u.token,randomUUID(),"arbitrary",draft=>{
  draft.arenaReceipts[operations.bucketFor(id)][id]="changed";
  draft.transactions.entries[0].label="changed";draft.receipts.extra="test";draft.roulette.results.extra={};throw Error("rollback");
 }),/rollback/);
 assert.strictEqual(s.data,old);assert.equal(JSON.stringify(old),before);assert.strictEqual(s.find(u.token),p);
});

test("arena receipt append detaches the changed bucket and keeps earlier snapshots and duplicate lookup intact",()=>{
 const ids=Array.from({length:200},()=>randomUUID()),p={wallet:{coins:20},receipts:{}};
 for(const id of ids)operations.recordArena(p,id,"prior");freeze(p);
 for(const copy of [copyProfile,lobbyDraft]){
  const q=copy(p),id=randomUUID(),key=operations.bucketFor(id),old=p.arenaReceipts;
  operations.recordArena(q,id,"new");q.wallet.coins--;
  assert.notStrictEqual(q.arenaReceipts,old);assert.notStrictEqual(q.arenaReceipts[key],old[key]);
  for(const bucket of Object.keys(old))if(bucket!==key)assert.strictEqual(q.arenaReceipts[bucket],old[bucket]);
  for(const oldId of ids)assert.equal(operations.read(q,oldId),"prior");
  assert.equal(operations.read(p,id),operations.MISSING);assert.equal(operations.read(q,id),"new");
  assert.equal(p.wallet.coins,20);operations.validate(q,14);
 }
});

test("failed audited commit cannot publish an appended arena receipt or wallet change",()=>{
 const {s,u}=fixture(),first=randomUUID();operations.recordArena(s.find(u.token),first,"old");
 const old=freeze(s.data),before=JSON.stringify(old),id=randomUUID();
 s.save=()=>{throw Error("simulated durable save failure")};
 assert.throws(()=>s.transactProfile(u.token,randomUUID(),"owned",p=>{
  p.wallet.coins--;operations.recordArena(p,id,"new");
 }),/simulated durable save failure/);
 assert.strictEqual(s.data,old);assert.equal(JSON.stringify(old),before);
 assert.equal(operations.read(s.find(u.token),id),operations.MISSING);
});

test("unchanged profile open never traverses its validated arena operation archive",()=>{
 const {s,u}=fixture(),id=randomUUID();operations.recordArena(s.find(u.token),id,"old");s.open(u.token);
 const p=s.find(u.token),old=s.data,key=operations.bucketFor(id),bucket=p.arenaReceipts[key];
 Object.defineProperty(p.arenaReceipts,key,{get(){throw Error("arena archive read")},enumerable:true,configurable:true});
 try{assert.equal(s.open(u.token).created,false);assert.strictEqual(s.data,old);}
 finally{Object.defineProperty(p.arenaReceipts,key,{value:bucket,enumerable:true,configurable:true,writable:true});}
});
test("repeated roulette spins detach the result table and keep old snapshots immutable",()=>{
 const {s,u}=fixture();
 for(let i=0;i<3;i++){
  if(!s.find(u.token).roulette.offer)roulette.mutate(s,u.token,{action:"prepare",rulesVersion:rules.version,requestId:randomUUID()},()=>0);
  const old=freeze(s.data),p=s.find(u.token),snapshot=JSON.stringify(old),id=randomUUID();
  const input={action:"spin",offerId:p.roulette.offer.id,rulesVersion:rules.version,requestId:id};
  roulette.mutate(s,u.token,input,()=>0);
  assert.equal(JSON.stringify(old),snapshot);assert.notStrictEqual(s.find(u.token).roulette.results,p.roulette.results);
  assert.equal(Object.keys(s.find(u.token).roulette.results).length,i+1);
  const saved=s.data;roulette.mutate(s,u.token,input,()=>0);assert.strictEqual(s.data,saved);
 }
});
test("audited lobby failure cannot mutate published inventory, histories or future fields",()=>{
 const {s,u}=fixture(),old=freeze(s.data),snapshot=JSON.stringify(old);
 assert.throws(()=>s.transactProfile(u.token,randomUUID(),"owned",p=>{p.wallet.coins--;history.capture(p,at,{kind:"fixture",label:"Changed"});p.inventory.future=10;throw Error("abort");}),/abort/);
 assert.strictEqual(s.data,old);assert.equal(JSON.stringify(old),snapshot);
});
test("opening an unchanged large profile neither saves nor traverses immutable history",()=>{
 const {s,u}=fixture();s.open(u.token);const p=s.find(u.token),old=s.data;
 // The already validated archive is not needed to prepare the lobby or check
 // whether its calendar changed. A hidden read here would throw.
 const entries=p.transactions.entries;
 Object.defineProperty(p.transactions,"entries",{get(){throw Error("archive read");},configurable:true,enumerable:true});
 try{assert.equal(s.open(u.token).created,false);assert.strictEqual(s.data,old);}
 finally{Object.defineProperty(p.transactions,"entries",{value:entries,configurable:true,enumerable:true,writable:true});}
});
