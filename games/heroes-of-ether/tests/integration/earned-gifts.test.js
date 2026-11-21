"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),{temporary}=require("../temp"),
  {EventManager}=require("../../src/server/events/event-manager"), E=require("../../src/server/events/easter-hunt"),
  album=require("../../src/server/events/event-album"), unlocks=require("../../src/server/profiles/event-gift-unlocks");
const at=Date.UTC(2026,10,8,12);
test("Earned Easter gifts authorize the sender, survive event closure/restart and debit once",t=>{
 const filePath=path.join(temporary(t,"earned-gifts"),"profiles.json"),store=new ProfileStore({filePath,now:()=>at}),events=new EventManager({now:()=>at});
 store.events=events;events.apply("test","start",{eventId:E.manifest.id,revision:events.data.revision,requestId:randomUUID()});
 const a=store.open(),b=store.open(),runId=events.active().id;
 const input={action:"gift",giftId:"easter_guardian",targetId:b.profile.id,confirmed:true,requestId:randomUUID()};
 store.transact(a.token,randomUUID(),"gift-test-wallet",p=>{p.wallet.crystals=500});
 const before=structuredClone(store.data);
 assert.throws(()=>store.socialAction(a.token,input),/Собери/);assert.deepEqual(store.data,before);
 assert.equal(store.socialState(a.token).catalog.find(g=>g.id===input.giftId).unlocked,false);
 store.startLife(a.profile.id,"life");
 store.applyArenaProgress(randomUUID(),[{type:"easterPickup",eggType:0,lifeId:"life",runId,profileId:a.profile.id}],at);
 store.applyArenaProgress(randomUUID(),[{type:"lifeEnded",lifeId:"life",durationSeconds:0,reason:"left",profileId:a.profile.id}],at);
 store.transact(a.token,randomUUID(),"gift-test-collection",p=>{
  p.wallet.crystals=500;
  const s=p.easter.runs[runId];s.fragmentCounts=Array(48).fill(0);s.fragmentCounts.fill(1,0,12);s.fragments=12;
 });
 const unlocked=store.socialState(a.token).catalog.find(g=>g.id===input.giftId);
 assert.equal(unlocked.unlocked,true);assert.equal(unlocked.price,100);assert.equal(unlocked.stat,undefined);
 assert.equal(album.view(store.find(a.token))[0].sendingGift.unlocked,true);
 events.apply("test","stop",{runId,revision:events.data.revision,requestId:randomUUID()});
 const state=structuredClone(store.data),save=store.save;
 store.save=()=>{throw Error("fsync failure")};
 assert.throws(()=>store.socialAction(a.token,input),/fsync failure/);assert.deepEqual(store.data,state);
 store.save=save;store.socialAction(a.token,input);assert.equal(store.socialAction(a.token,input).replay,true);
 assert.equal(store.find(a.token).wallet.crystals,400);
 assert.equal(store.find(b.token).social.gifts.find(g=>g.id===input.giftId).count,1);
 assert.equal(store.find(b.token).social.giftEffects,undefined);
 assert.equal(store.socialState(b.token).catalog.find(g=>g.id===input.giftId).unlocked,false);
 assert.throws(()=>store.socialAction(b.token,{...input,targetId:a.profile.id,requestId:randomUUID()}),/Собери/);
 // Keep the settlement date stable here: advancing a month also legitimately
 // pays the unrelated daily greatness ranking in this synthetic two-player world.
 const restored=new ProfileStore({filePath,now:()=>at});
 assert.equal(restored.socialState(a.token).catalog.find(g=>g.id===input.giftId).unlocked,true);
 assert.equal(restored.socialAction(a.token,input).replay,true);assert.equal(restored.find(a.token).wallet.crystals,400);
});
test("Black Friday final reward grants permanent sending rights; receiving or client flags do not",()=>{
 const f=require("../helpers/black-friday-fixture")(),B=require("../../src/server/events/black-friday"),b=f.store.open();
 const gift=require("../../src/server/profiles/gift-catalog").gifts.find(g=>g.id==="golden_lucky_cat");
 assert.equal(unlocks.unlocked(f.p(),gift),false);
 const days={},date=B.day(f.now());for(let i=0;i<5;i++)days[date-i]={food:150,mass:5000,life:1,claimed:["food","mass","life"],exchanges:{coins:2}};
 f.store.transact(f.user.token,randomUUID(),"legacy-earned-friday",p=>{
  p.wallet.crystals=500;p.blackFriday={runs:{[f.run.id]:{tokens:150,completedOrders:15,days,purchases:{},finalAt:f.now()-1}}};
 });
 B.validate(f.p());assert.equal(unlocks.unlocked(f.p(),gift),true);
 f.command("stop",{runId:f.run.id});
 const input={action:"gift-anonymous",anonymous:true,confirmed:true,targetId:b.profile.id,giftId:gift.id,requestId:randomUUID()};
 f.store.socialAction(f.user.token,input);assert.equal(f.p().wallet.crystals,400);
 assert.equal(f.store.socialAction(f.user.token,input).replay,true);
 assert.throws(()=>f.store.socialAction(b.token,{...input,targetId:f.p().id,unlocked:true,requestId:randomUUID()}),/Заверши/);
 assert.equal(unlocks.unlocked({blackFriday:{runs:{bad:{finalAt:null},missing:{}}}},gift),false);
});
