"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const Q=require("../../src/server/progression/personal-quests"),{ProfileStore}=require("../../src/server/profiles/profile-store"),{temporary}=require("../temp");
const AT=Date.UTC(2026,10,17,8);
function legacy() {
  const store=new ProfileStore({now:()=>AT}),user=store.open(),p=store.find(user.token);
  const specs=[["sky_hunter",20,null],["arena_predator",10,null],["feast",20000,null],["rocket_hit_small",1,AT-1000]];
  p.quests={day:Q.day(AT),rerolls:1,session:null,pending:[],items:specs.map(([questId,progress,completedAt],i)=>({id:"legacy-"+i,questId,assignedAt:AT-2000,progress,completedAt,claimedAt:null}))};
  p.quests.items[0].opponents=Array.from({length:20},(_,i)=>"victim-"+i);
  p.quests.pending.push({...Q.makeReward("small",AT-1000,false,()=>0),id:"legacy-3",questId:"rocket_hit_small",title:"Ракетная атака",stored:true,receivedAt:AT-500,storedAt:AT-1000,storageOrder:1,expiresAt:null});
  Q.validate(p);return {store,user,p};
}
test("document goals and concise life wording retain all 44 active objectives and chest rewards",()=>{
  const targets={sky_hunter:15,arena_predator:50,unstoppable:20,acrobat:10,feast:50000,thorns_large:30,rocket_hit_small:3,glove_hit_small:3};
  assert.equal(Q.activeCatalog.length,44);
  for(const [id,target] of Object.entries(targets))assert.equal(Q.CATALOG.find(q=>q.id===id).target,target,id);
  for(const q of Q.activeCatalog){assert(!/за одну жизнь|за одну игру|Учитываются все заходы/.test(q.description));if(q.metric.startsWith("life"))assert.match(q.description,/за вход на арену/);}
  assert.deepEqual(Object.values(Q.CHESTS).map(c=>c.greatness),[5,3,2]);
});
test("today's lowered goal completes once; higher unfinished goals retain progress and earned chests stay exact",()=>{
  const {p}=legacy(),reward=structuredClone(p.quests.pending[0]),wallet=structuredClone(p.wallet);
  assert.equal(Q.migrate(p,AT,false),true);Q.validate(p);
  assert.deepEqual(p.quests.items.map(r=>r.progress),[15,10,20000,3]);
  assert.equal(p.quests.items[0].completedAt,AT);assert.equal(p.quests.items[0].opponents.length,15);
  assert.equal(p.quests.items[3].completedAt,AT-1000);assert.deepEqual(p.quests.pending[0],reward);
  assert.equal(p.quests.pending.length,2);assert.equal(p.quests.pending[1].tickets,0);assert.deepEqual(p.wallet,wallet);
  const after=structuredClone(p);assert.equal(Q.migrate(p,AT+1,true),false);assert.deepEqual(p,after);
});
test("old days do not receive retrospective chests and invalid old progress cannot be laundered",()=>{
  const {p}=legacy();Q.migrate(p,AT+86400000,false);assert.equal(p.quests.pending.length,1);assert.equal(p.quests.items[0].completedAt,null);Q.validate(p);
  const invalid=legacy().p;invalid.quests.items[0].progress=51;const before=structuredClone(invalid);assert.throws(()=>Q.migrate(invalid,AT,false));assert.deepEqual(invalid,before);
  p.quests.rulesVersion=2;assert.throws(()=>Q.validate(p));
});
test("migration publishes only after durable save, retries safely and survives restart without duplicate rewards",async t=>{
  const {store,user}=legacy(),filePath=path.join(temporary(t),"profiles.json");
  fs.writeFileSync(filePath,JSON.stringify(store.data));
  const loaded=new ProfileStore({filePath,now:()=>AT,journal:true});
  const before=structuredClone(loaded.data),write=loaded.writeSnapshot;
  loaded.writeSnapshot=()=>{throw Error("disk failure");};
  assert.throws(()=>loaded.refreshCompetition(),/disk failure/);assert.deepEqual(loaded.data,before);assert.equal(loaded.questRulesMigrationPending,true);
  loaded.writeSnapshot=write;loaded.refreshCompetition();
  const saved=structuredClone(loaded.find(user.token).quests);assert.equal(saved.pending.filter(r=>r.id==="legacy-0").length,1);assert.equal(saved.rulesVersion,1);
  assert.deepEqual(before.profiles[Object.keys(before.profiles)[0]].quests.items[0].opponents,Array.from({length:20},(_,i)=>"victim-"+i));
  await loaded.close();const restarted=new ProfileStore({filePath,now:()=>AT,journal:true});
  restarted.refreshCompetition();assert.deepEqual(restarted.find(user.token).quests,saved);await restarted.close();
});
test("renamed life goals still reset at death, including a respawn without returning to lobby",()=>{
  const {p}=legacy();Q.migrate(p,AT,false);
  p.quests.items[3]={id:"fresh-rocket",questId:"rocket_hit_small",assignedAt:AT,progress:0,completedAt:null,claimedAt:null};
  Q.progress(p,{type:"lifeStarted",lifeId:"one"},AT,false);
  Q.progress(p,{type:"arenaAction",lifeId:"one",metric:"rocketHits",targetProfileId:"other",sequence:1},AT+1,false);
  assert.equal(p.quests.items[3].progress,1);
  Q.progress(p,{type:"lifeEnded",lifeId:"one"},AT+2,false);assert.equal(p.quests.items[3].progress,0);
  Q.progress(p,{type:"lifeStarted",lifeId:"two"},AT+3,false);assert.equal(p.quests.items[3].progress,0);
  assert.equal(p.quests.items[0].completedAt,AT);Q.validate(p);
});
