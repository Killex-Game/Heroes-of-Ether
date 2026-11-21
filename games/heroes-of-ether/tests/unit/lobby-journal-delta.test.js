"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),history=require("../../src/server/profiles/transaction-history");
const {difference,recover}=require("../../src/server/profiles/profile-journal"),{applyTransfer}=require("../../src/server/profiles/profile-transfer");
const {xpForLevel}=require("../../src/server/progression/experience-progression"),{BOOSTERS}=require("../../src/server/boosters/booster-catalog");
const pets=require("../../src/server/pets/pet-service"),alchemy=require("../../src/server/events/ether-alchemy");
const roulette=require("../../src/server/roulette/roulette-service"),wheelRules=require("../../public/shared/roulette-rules");
const at=Date.parse("2026-11-16T12:00:00Z");
const freeze=x=>{if(x&&typeof x==="object"&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x;};
function fixture(options={}){
 const store=new ProfileStore({now:()=>at,incrementalSettlement:true,rouletteConfig:{testEnabled:true},...options}),user=store.open();
 store.transact(user.token,randomUUID(),"fixture",p=>{p.level=20;p.progress.xp=xpForLevel(20);p.wallet.coins=100000;p.wallet.crystals=10000;p.alchemy={version:1,natural:200000,ingredients:{},learned:[],equipped:null};});
 const profile=structuredClone(store.find(user.token));
 for(let i=0;i<1500;i++){const balance=history.snapshot(profile);profile.wallet.coins++;history.record(profile,balance,at,{kind:"fixture",label:"History entry"});profile.receipts["historic-operation-"+i]="unchanged";}
 const key=Object.keys(store.data.profiles)[0];store.save({...store.data,profiles:{...store.data.profiles,[key]:profile}});
 store.open();
 return {store,user,key};
}
const booster=[...BOOSTERS.values()].find(b=>b.ready&&b.tier==="common"&&b.price?.currency==="coins");
const commands={
 loadout:(s,t,id)=>s.setLoadout(t,{skinId:"moon-dragon",quickSlots:[],requestId:id}),
 purchase:(s,t,id)=>s.buy(t,booster.id,id),
 petFood:(s,t,id)=>pets.mutate(s,t,{action:"food",requestId:id}),
 exchange:(s,t,id)=>alchemy.mutate(s,t,{action:"exchange",requestId:id}),
 gift:(s,t,id)=>s.socialAction(t,{action:"gift",targetId:Object.values(s.data.profiles).find(p=>p.id!==s.find(t).id).id,giftId:"chocolates",confirmed:true,requestId:id}),
};
for(const [name,act]of Object.entries(commands))test("lobby "+name+" persists a bounded change while retaining all history and replay",()=>{
 const {store,user,key}=fixture(),before=freeze(store.data),snapshot=JSON.stringify(before),id=randomUUID();
 assert(Buffer.byteLength(snapshot)>300000);
 const result=act(store,user.token,id);assert.equal(result.replay,false);
 assert.equal(JSON.stringify(before),snapshot);
 const patch=difference(store.data,before),encoded=JSON.stringify(patch);
 assert(Buffer.byteLength(encoded)<10000,"one lobby action must not rewrite its historical profile");
 assert.deepEqual(applyTransfer(before,JSON.parse(encoded)),store.data);
 assert.equal(store.find(user.token).transactions.entries.length>=before.profiles[key].transactions.entries.length,true);
 const after=store.data;assert.equal(act(store,user.token,id).replay,true);assert.strictEqual(store.data,after);
});
test("roulette spin appends one result without rewriting the archive and preserves recovery semantics",()=>{
 const {store,user,key}=fixture(),profile=structuredClone(store.find(user.token));
 const offer=roulette.makeOffer(at,n=>0);profile.roulette.results={};
 for(let i=0;i<200;i++){const id=randomUUID();profile.roulette.results[id]={requestId:id,at,offer,index:0};profile.roulette.lastRequestId=id;}
 profile.roulette.spent=200;profile.roulette.earned=205;profile.roulette.tickets=5;profile.roulette.offer=offer;
 store.save({...store.data,profiles:{...store.data.profiles,[key]:profile}});
 const before=freeze(store.data),old=JSON.stringify(before),id=randomUUID();
 roulette.mutate(store,user.token,{action:"spin",offerId:offer.id,rulesVersion:wheelRules.version,requestId:id},n=>0);
 assert.equal(JSON.stringify(before),old);const patch=difference(store.data,before),encoded=JSON.stringify(patch);
 assert(Buffer.byteLength(encoded)<12000,"spin must write the new result, not all previous results");
 assert.deepEqual(applyTransfer(before,JSON.parse(encoded)),store.data);
 assert.equal(Object.keys(store.find(user.token).roulette.results).length,201);
});
test("default lobby draft matches unreconciled full-copy semantics for changed/removed/unknown branches",()=>{
 const f=fixture(),old=new ProfileStore({now:()=>at,incrementalSettlement:true});old.save(structuredClone(f.store.data));
 const id=randomUUID(),change=p=>{p.wallet.coins-=9;p.futureExtension={nested:{list:[1,2,3]}};delete p.personal.vkUrl;};
 f.store.transact(f.user.token,id,"oracle",change);
 old.transact(f.user.token,id,"oracle",change,undefined,p=>structuredClone(p));
 const normalize=data=>{const copy=structuredClone(data);for(const p of Object.values(copy.profiles))p.transactions.entries.forEach((e,i)=>e.id="history-"+i);return copy;};
 assert.deepEqual(normalize(f.store.data),normalize(old.data));
});
test("lobby delta retries after failed fsync and recovers the complete profile without duplicate purchase",async t=>{
 const fs=require("node:fs"),path=require("node:path"),{temporary}=require("../temp"),filePath=path.join(temporary(t,"lobby-delta"),"profiles.json");
 const {store,user}=fixture({filePath,journal:true});
 try{const before=store.data,old=JSON.stringify(before),id=randomUUID(),sync=fs.fsyncSync;let fail=true;
  const mock=t.mock.method(fs,"fsyncSync",fd=>{if(fail){fail=false;throw Error("injected fsync failure");}return sync(fd);});
  assert.throws(()=>commands.purchase(store,user.token,id),/injected fsync failure/);mock.mock.restore();assert.strictEqual(store.data,before);assert.equal(JSON.stringify(before),old);
  commands.purchase(store,user.token,id);const expected=structuredClone(store.data);await store.close();
  const restored=recover(filePath).data;delete expected._journalRevision;delete restored._journalRevision;assert.deepEqual(restored,expected);
 }finally{await store.close();}
});
