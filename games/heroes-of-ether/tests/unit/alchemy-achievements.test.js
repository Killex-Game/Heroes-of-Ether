"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const {ProfileStore}=require("../../src/server/profiles/profile-store");
const {EventManager}=require("../../src/server/events/event-manager");
const A=require("../../src/server/events/ether-alchemy"),ach=require("../../src/server/events/alchemy-achievements");
const xp=require("../../src/server/progression/experience-progression");
function fixture(options={}) {
 let at=Date.UTC(2026,10,25,12);
 const store=new ProfileStore({incrementalSettlement:true,...options,now:()=>at}),manager=store.events=new EventManager({now:()=>at});
 const user=store.open(),mate=store.open(),p=()=>store.find(user.token);
 const command=(action,extra={})=>manager.apply("test",action,{requestId:randomUUID(),revision:manager.data.revision,...extra});
 command("start",{eventId:A.manifest.id});const run=manager.active();
 const lifeId=randomUUID();
 const progress=(...events)=>store.applyArenaProgress(randomUUID(),events.map(e=>({profileId:p().id,lifeId,...e})),at);
 const change=fn=>store.transactProfile(user.token,randomUUID(),"fixture",fn);
 return {store,manager,user,mate,p,command,run,lifeId,progress,change,advance:n=>at+=n,now:()=>at,
   state:()=>p().alchemy?.achievements?.[run.id],view:()=>ach.view(p(),manager,at),
   brew:id=>A.mutate(store,user.token,{action:"brew",potionId:id,runId:run.id,requestId:randomUUID()})};
}
test("twenty alchemy achievements, real ingredient deltas, duplicate totals and immutable failure",()=>{
 const f=fixture();assert.equal(f.view().length,20);
 f.progress({type:"lifeStarted"});
 const old=f.p(),snapshot=structuredClone(old),greatness=old.greatness;
 const event={type:"alchemyGather",natural:50,runId:f.run.id,ingredients:{leaf:50}};
 f.progress(event);assert.deepEqual(old,snapshot);assert.equal(f.state().values.alchemy_ingredients,50);
 assert.equal(f.state().claimed.alchemy_ingredients,1);assert.equal(f.p().greatness,greatness+10);
 f.progress(event,{...event,ingredients:{leaf:49}});assert.equal(f.p().greatness,greatness+10);
 const world=f.store.data,before=structuredClone(world),write=f.store.writeSnapshot;
 f.store.writeSnapshot=()=>{throw Error("disk failure")};
 assert.throws(()=>f.progress({...event,ingredients:{leaf:200}}),/disk failure/);
 assert.deepEqual(world,before);assert.strictEqual(f.store.data,world);f.store.writeSnapshot=write;
 f.progress({...event,ingredients:{leaf:200}});assert.equal(f.state().claimed.alchemy_ingredients,2);
 assert.equal(f.p().greatness,greatness+30);
});
test("all potion types count actual acquisitions and brew batches, not recipe views/equip/replays",()=>{
 const f=fixture();f.progress({type:"lifeStarted"});
 f.change(p=>{p.alchemy={version:1,natural:0,ingredients:Object.fromEntries(A.rules.ingredients.map(i=>[i.id,9999])),learned:[],equipped:null};});
 const start=f.p().greatness;
 for(const potion of A.rules.potions) {
   const input={action:"brew",potionId:potion.id,runId:f.run.id,requestId:randomUUID()};
   A.mutate(f.store,f.user.token,input);const saved=JSON.stringify(f.state());
   assert.equal(A.mutate(f.store,f.user.token,input).replay,true);assert.equal(JSON.stringify(f.state()),saved);
   assert.equal(f.state().values["alchemy_potion_"+potion.id],5);
   assert.equal(f.state().claimed["alchemy_potion_"+potion.id],1);
 }
 assert.equal(f.state().values.alchemy_brews,16);assert.equal(f.state().claimed.alchemy_brews,2);
 assert.equal(f.p().greatness,start+160+30);
 f.change(p=>{p.inventory.alchemy_strength+=15});assert.equal(f.state().claimed.alchemy_potion_strength,2);
 f.change(p=>{p.inventory.alchemy_strength-=1});assert.equal(f.state().values.alchemy_potion_strength,20);
 const previous=structuredClone(f.state());f.view();assert.deepEqual(f.state(),previous);
});
test("alchemy run boundaries preserve awards and restart progress without inventing history",()=>{
 const f=fixture();f.progress({type:"lifeStarted"},{type:"alchemyGather",natural:0,runId:f.run.id,ingredients:{leaf:50}});
 const total=f.p().greatness,old=structuredClone(f.state());
 f.command("stop",{runId:f.run.id});assert.equal(f.view().length,0);
 f.change(p=>{p.inventory.alchemy_strength=100});assert.deepEqual(f.state(),old);
 f.advance(1000);f.command("start",{eventId:A.manifest.id});
 assert(f.view().every(d=>d.claimed===0&&d.value===0));assert.equal(f.p().greatness,total);
 assert.deepEqual(f.state(),old);
});
test("married arena levels and 60 observed seconds are credited on a single completed entry",()=>{
 const f=fixture();f.change(p=>{p.social={marriage:{partnerId:f.mate.profile.id,at:Date.UTC(2026,10,24)},invitations:[],gifts:[],inviteReadyAt:0};});
 const partner=f.mate.profile.id;
 f.progress({type:"lifeStarted",spouseOnArena:partner});
 for(let i=1;i<=60;i++){f.advance(1000);f.progress({type:"lifeTime",durationSeconds:i,spouseOnArena:partner});}
 f.change(p=>{p.progress.session.xp=p.progress.arenaXpTarget-p.progress.xp-3});
 f.progress({type:"absorbed",victimProfileId:"victim",gain:20,spouseOnArena:partner});
 const before=f.p().greatness;
 f.progress({type:"lifeEnded",durationSeconds:60,reason:"exit"});
 assert.equal(f.state().values.alchemy_marriage_levels,1);
 assert.equal(f.state().values.alchemy_marriage_games,1);assert.equal(f.p().greatness,before+20);
 const saved=JSON.stringify(f.state());f.progress({type:"lifeEnded",durationSeconds:60,reason:"exit"});assert.equal(JSON.stringify(f.state()),saved);
});
test("elapsed time without spouse and late event exit cannot earn joint sessions",()=>{
 const f=fixture();const mate=f.mate.profile.id;
 // A long missing interval is not observed joint play.
 f.change(p=>{p.social={marriage:{partnerId:mate,at:Date.UTC(2026,10,24)},invitations:[],gifts:[],inviteReadyAt:0};});
 f.progress({type:"lifeStarted",spouseOnArena:mate});f.advance(60000);
 f.progress({type:"lifeTime",durationSeconds:60,spouseOnArena:mate},{type:"lifeEnded",durationSeconds:60,reason:"exit"});
 assert.equal(f.state()?.values.alchemy_marriage_games,undefined);
});
test('saved joint progress recovers once after restart, only while the run is active',t=>{
 for(const late of [false,true]){
  const filePath=require('path').join(require('../temp').temporary(t,'alchemy-recovery-'+late),'profiles.json');
  const f=fixture({filePath,journal:true});
  f.change(p=>{p.social={marriage:{partnerId:f.mate.profile.id,at:f.now()-1000},invitations:[],gifts:[],inviteReadyAt:0};});
  f.progress({type:'lifeStarted',spouseOnArena:f.mate.profile.id});
  for(let i=1;i<=60;i++){f.advance(1000);f.progress({type:'lifeTime',durationSeconds:i,spouseOnArena:f.mate.profile.id});}
  const before=f.p().greatness;
  if(late)f.command('stop',{runId:f.run.id});
  const restored=new ProfileStore({filePath,journal:true,now:f.now});restored.events=f.manager;
  restored.open(f.user.token);const p=restored.find(f.user.token);
  assert.equal(p.greatness,before+(late?0:10));assert.equal(p.progress.lastLife.pendingAlchemy,undefined);
  restored.open(f.user.token);assert.equal(restored.find(f.user.token).greatness,p.greatness);
  assert.deepEqual(require('../../src/server/profiles/profile-journal').recover(filePath).data.profiles,restored.data.profiles);
 }
});
