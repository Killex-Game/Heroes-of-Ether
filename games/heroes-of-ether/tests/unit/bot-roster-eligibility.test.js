"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {BotRosterEligibility}=require("../../src/server/testing/bot-roster-eligibility");
const tables=require("../../src/server/profiles/immutable-table-delta");
const {MARKER}=require("../../src/server/testing/bot-identity");
function fixture(){
  const p={id:"bot",level:20,testBot:MARKER,clanId:"clan",mass:10};let lookups=0;
  const store={journal:{},data:{profiles:{bot:p},clans:{clan:{id:"clan",members:["bot"]}}},byId(id){lookups++;return this.data.profiles[id];}};
  const cache=new BotRosterEligibility(),independent=[],eligible=p=>p.level>=12&&p.level<=120;
  const read=()=>cache.read(store,independent,eligible,true);
  const update=patch=>{const old=store.data.profiles,next={...old,bot:{...old.bot,...patch}};tables.remember(next,old,["bot"]);store.data={...store.data,profiles:next};};
  return {store,cache,read,update,independent,eligible,lookups:()=>lookups};
}
test("ordinary committed arena progress reuses eligibility without scanning clan members",()=>{
 const f=fixture();assert.deepEqual([...f.read()],["clan"]);const n=f.lookups();
 for(let i=0;i<100;i++){f.update({mass:i});assert.deepEqual([...f.read()],["clan"]);}
 assert.equal(f.lookups(),n);
});
test("level, bot identity, membership, new tables and predicate changes invalidate immediately",()=>{
 const f=fixture();f.read();f.update({level:121});assert.equal(f.read().size,0);
 f.update({level:20});assert.equal(f.read().size,1);f.update({testBot:null});assert.equal(f.read().size,0);
 f.update({testBot:MARKER});assert.equal(f.read().size,1);
 f.store.data.clans={clan:{id:"clan",members:[]}};assert.equal(f.read().size,0);
 f.store.data.clans={clan:{id:"clan",members:["bot"]}};assert.equal(f.read().size,1);
 f.store.data.profiles={bot:{...f.store.data.profiles.bot,level:121}};assert.equal(f.read().size,0);
 assert.equal(f.cache.read(f.store,f.independent,p=>p.level>=121,true).size,1);
 f.store.data.clans={};assert.equal(f.read().size,0);
});
test("mutable fixtures and arbitrary predicates are not cached; live bans are not eligibility",()=>{
 const f=fixture();delete f.store.journal;f.read();f.store.data.profiles.bot.level=121;assert.equal(f.read().size,0);
 f.store.journal={};f.update({level:20});f.read();f.update({moderation:{banUntil:999999}});assert.equal(f.read().size,1);
 assert.equal(f.cache.read(f.store,f.independent,()=>false,false).size,0);
});
