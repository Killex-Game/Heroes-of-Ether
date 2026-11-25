"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {temporary}=require("../temp"),{ProfileStore}=require("../../src/server/profiles/profile-store"),effects=require("../../src/server/profiles/gift-effects");
const visual=require("../../public/shared/gift-appearance"),{gifts}=require("../../src/server/profiles/gift-catalog");
test("strongest set, individual percentages and independent exact expiry agree with avatar selection",()=>{
 const p={social:{giftEffects:{hex:500,infection:300,curse:100,skull:200,shackles:400,venom:150,black_mark:250}}};
 const saved=structuredClone(p);
 for(const [at,id,xp,speed,outgoing,incoming] of [[0,"curse",.7,.7,.7,1.3],[100,"infection",.75,.75,.75,1.25],
   [150,"infection",.75,.75,.8,1.25],[200,"infection",.8,.75,.8,1.25],[250,"infection",.8,.75,.8,1.2],
   [300,"hex",.9,.85,.9,1.1],[400,"hex",.9,.9,.9,1.1],[500,"",1,1,1,1]]){
  const m=effects.modifiers(p,at);assert.deepEqual([m.visual,m.xp,m.speed,m.outgoing,m.incoming],[id,xp,speed,outgoing,incoming]);
  assert.equal(visual.selected(effects.appearance(p,at),at),id);
 }
 assert.deepEqual(p,saved,"expiration never rewrites saved history or equipped avatar");
});
test("set gifts debit once, credit spending, extend time without strength stacking and survive journal recovery",t=>{
 let at=100000;const filePath=path.join(temporary(t,"gift-sets"),"profiles.json");
 const store=new ProfileStore({filePath,journal:true,now:()=>at}),a=store.open(),b=store.open();
 store.transact(a.token,randomUUID(),"fund",p=>{p.wallet.bucks=1000;});
 const originalSkin=store.find(b.token).skinId;
 const send=(id,requestId=randomUUID())=>store.socialAction(a.token,{action:"gift",giftId:id,targetId:b.profile.id,confirmed:true,requestId});
 for(const [id,price,minutes] of [["hex",15,30],["infection",25,45],["curse",35,60]]){
  const before=store.find(a.token).wallet.bucks,receipt=randomUUID();send(id,receipt);assert.equal(send(id,receipt).replay,true);
  assert.equal(store.find(a.token).wallet.bucks,before-price);assert.equal(store.find(b.token).social.giftEffects[id],at+minutes*60000);
 }
 const until=at+3600000;at+=600000;send("curse");send("skull");send("shackles");
 assert.equal(store.find(b.token).social.giftEffects.curse,until+3600000);
 const m=effects.modifiers(store.find(b.token),at);assert.deepEqual([m.xp,m.speed,m.outgoing,m.incoming],[.7,.7,.75,1.25]);
 const state=store.publicPlayer(b.profile.id);assert.equal(state.giftAppearance.curse,until+3600000);
 assert.deepEqual(state.social.effects.filter(g=>g.bundlePercent&&g.active).map(g=>g.id),["curse"]);
 assert.equal(store.find(b.token).skinId,originalSkin);
 const before=structuredClone(store.data),save=store.save;store.save=()=>{throw Error("disk full");};
 assert.throws(()=>send("infection"),/disk full/);assert.deepEqual(store.data,before);store.save=save;
 const restored=new ProfileStore({filePath,journal:true,now:()=>at});assert.deepEqual(restored.find(b.token).social,store.find(b.token).social);
 assert.deepEqual(restored.find(a.token).wallet,store.find(a.token).wallet);
 assert.deepEqual(restored.find(a.token).activity,store.find(a.token).activity);
 at=until+3600000;assert.equal(effects.modifiers(restored.find(b.token),at).visual,"");assert.equal(restored.publicPlayer(b.profile.id).giftAppearance,undefined);
 for(const id of ["skull","shackles","venom","black_mark"])assert.equal(Math.abs(gifts.find(g=>g.id===id).percent),5);
});
