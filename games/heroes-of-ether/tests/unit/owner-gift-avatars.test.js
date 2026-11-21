"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {temporary}=require("../temp"),{ProfileStore}=require("../../src/server/profiles/profile-store");
const {OwnerService}=require("../../src/server/admin/owner-service"),identity=require("../../public/shared/player-identity");
const promo=require("../../src/server/profiles/promo-codes"),{GameGrants}=require("../../src/server/admin/game-grants");
function fixture(t){
 const filePath=path.join(temporary(t,"owner-gift-avatars"),"profiles.json"),profiles=new ProfileStore({filePath});
 const a=profiles.open(),b=profiles.open(),other=profiles.open(),owner=profiles.find(a.token);
 const access={ownerId:owner.id,isOwner:p=>p?.id===owner.id,canManagePlayers:p=>p?.id===owner.id||p?.role==="moderator"};
 const service=new OwnerService({profiles,access});
 const command=skinId=>({action:"avatarGift",skinId,targetId:b.profile.id,revision:profiles.byId(b.profile.id).revision,reason:"Личный подарок от владельца",requestId:randomUUID()});
 return {profiles,owner,access,service,command,b,other,filePath};
}
test("Private avatars require their own grant, not a status, shop collection, promo or mass campaign",t=>{
 const f=fixture(t),skins=identity.ownerGiftSkins;
 assert.equal(skins.length,2);
 for(const s of skins){
  assert(!identity.skins.includes(s));assert(!identity.collectionSkins.includes(s));
  assert(!identity.skinAllowed(s.id,{vip:true,premium:true},["visual","prism","glass"],[s.id]));
  assert(identity.skinAllowed(s.id,{},[],[],[s.id]));
  assert(!promo.catalog.some(r=>r.id===s.id));
  assert.throws(()=>promo.rewards([{kind:"skin",id:s.id,amount:1}]));
  assert.throws(()=>new GameGrants(f).preview(f.owner,{title:"Подарок",message:"Тест подарка",rewards:[{kind:"skin",id:s.id,amount:1}]}));
  assert.throws(()=>f.profiles.setLoadout(f.b.token,{skinId:s.id,requestId:randomUUID(),name:f.b.profile.name,quickSlots:f.b.profile.quickSlots}));
 }
});
test("Only the owner grants one recipient; replay, reopen, equipping and gift acknowledgement preserve ownership",t=>{
 const f=fixture(t),skin=identity.ownerGiftSkins[0],otherBefore=structuredClone(f.profiles.find(f.other.token)),before=structuredClone(f.profiles.find(f.b.token));
 const cmd=f.command(skin.id);
 assert.throws(()=>f.service.apply({id:"moderator-test",role:"moderator"},cmd),e=>e.status===403);
 assert.equal(f.service.apply(f.owner,cmd).duplicate,false);
 const gifted=f.profiles.find(f.b.token);
 assert.deepEqual(gifted.grantedSkins,[skin.id]);assert.equal(gifted.gameGiftNotices.length,1);
 assert.equal(gifted.gameGiftNotices[0].title,skin.name);assert.equal(f.profiles.view(gifted).gameGiftNotices[0].rewards[0].name,skin.name);
 for(const k of ["wallet","inventory","quests","greatness","skinId","progress","account"])assert.deepEqual(gifted[k],before[k],k);
 assert.deepEqual(f.profiles.find(f.other.token),otherBefore);
 assert.equal(f.service.apply(f.owner,cmd).duplicate,true);
 assert.throws(()=>f.service.apply(f.owner,f.command(skin.id)),e=>e.status===409);
 const restored=new ProfileStore({filePath:f.filePath});
 assert.equal(new OwnerService({profiles:restored,access:f.access}).apply(f.owner,cmd).duplicate,true);
 restored.setLoadout(f.b.token,{skinId:skin.id,requestId:randomUUID(),name:gifted.name,quickSlots:gifted.quickSlots});
 assert.equal(restored.view(restored.find(f.b.token)).skinId,skin.id);
 require("../../src/server/admin/game-grants").acknowledge(restored,f.b.token,{id:gifted.gameGiftNotices[0].id,requestId:randomUUID()});
 assert.deepEqual(restored.find(f.b.token).grantedSkins,[skin.id]);assert.equal(restored.find(f.b.token).gameGiftNotices.length,0);
 assert.equal(restored.data.administration.audit.filter(e=>e.action==="avatarGift").length,1);
});
test("Arena, stale revision, invalid avatar and failed save cannot publish a gift",t=>{
 const f=fixture(t),skin=identity.ownerGiftSkins[1],cmd=f.command(skin.id),before=structuredClone(f.profiles.data);
 f.service.inArena=()=>true;assert.throws(()=>f.service.apply(f.owner,cmd),e=>e.status===409);
 f.service.inArena=()=>false;assert.throws(()=>f.service.apply(f.owner,{...cmd,revision:cmd.revision+1}),e=>e.status===409);
 assert.throws(()=>f.service.apply(f.owner,{...cmd,skinId:"moon-dragon"}));
 const save=f.profiles.save;f.profiles.save=()=>{throw Error("disk failure");};
 assert.throws(()=>f.service.apply(f.owner,cmd),/disk failure/);assert.deepEqual(f.profiles.data,before);
 f.profiles.save=save;f.service.apply(f.owner,cmd);assert.deepEqual(f.profiles.find(f.b.token).grantedSkins,[skin.id]);
});
