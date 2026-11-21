"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {ProfileJournal,recover,segments}=require("../../src/server/profiles/profile-journal");
const receipts=require("../../src/server/progression/quest-receipts");
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"concurrent-seals-")),file=path.join(dir,"profiles.json"),journal=new ProfileJournal(file,{intervalMs:60000});
 t.after(async()=>{if(!journal.closed)await journal.close();fs.rmSync(dir,{recursive:true,force:true});});return{file,journal};}
test("Booster seals can publish during checkpoint; concurrent bytes and exact rewards survive recovery",async t=>{
 const {file,journal}=setup(t);let world={profiles:{p:{coins:100,receipts:{},payload:"x".repeat(1000000)}},clans:{}};
 journal.commit(world);const checkpoint=journal.requestCheckpoint();assert.ok(journal.running);
 for(let i=0;i<30;i++){
  world={...world,profiles:{p:{...world.profiles.p,coins:i,receipts:{...world.profiles.p.receipts,[i]:"reward"}}}};
  const staged=await journal.stage(world);assert.equal(journal.publishStaged(staged,world),true);
 }
 await checkpoint;
 assert.equal(journal.pendingBytes,journal.activeBytes+segments(file).reduce((n,p)=>n+fs.statSync(p).size,0));
 assert.deepEqual(recover(file).data.profiles,world.profiles);
 await journal.close();assert.deepEqual(JSON.parse(fs.readFileSync(file)).profiles,world.profiles);
});
test("Receipt bucket delta stores a new contact without rewriting its long-lived history",async t=>{
 const {file,journal}=setup(t),session={seen:{}};
 for(let i=0;i<6000;i++)receipts.record(session,"victim-"+i);
 let p={roulette:{results:[]},quests:{session}};journal.commit({profiles:{p},clans:{}});
 const next={...session};receipts.record(next,"new-contact");
 p={...p,quests:{session:next}};const before=journal.pendingBytes;
 journal.commit({profiles:{p},clans:{}});
 assert.ok(journal.pendingBytes-before<650);
 assert.deepEqual(recover(file).data.profiles.p,p);
 const removed={...next,seenBuckets:{...next.seenBuckets}};
 const bucket=Object.keys(removed.seenBuckets)[0],key=Object.keys(removed.seenBuckets[bucket])[0];
 removed.seenBuckets[bucket]={...removed.seenBuckets[bucket]};delete removed.seenBuckets[bucket][key];
 p={...p,quests:{session:removed}};journal.commit({profiles:{p},clans:{}});
 await journal.requestCheckpoint();assert.deepEqual(recover(file).data.profiles.p,p);
});
