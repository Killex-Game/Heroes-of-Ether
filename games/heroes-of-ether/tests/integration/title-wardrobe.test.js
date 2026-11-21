"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),{temporary}=require("../temp"),A=require("../../public/shared/accessory-catalog");
test("Title wardrobe: unlock only at earned title, new marker clears on durable first equip",t=>{
 const filePath=path.join(temporary(t,"title-wardrobe"),"profiles.json"),s=new ProfileStore({filePath}),a=s.open();
 assert(!A.isOwned(s.find(a.token),"novice_hat"));
 assert.throws(()=>s.setAccessory(a.token,{slot:"hat",accessoryId:"title_boss_hat",requestId:randomUUID()}),/недоступен/);
 s.transact(a.token,randomUUID(),"fixture-greatness",p=>{p.greatness=5000;});
 assert(A.isOwned(s.find(a.token),"novice_hat"));assert(A.isOwned(s.find(a.token),"title_experienced_hat"));assert(!A.isOwned(s.find(a.token),"title_expert_hat"));
 assert(!s.view(s.find(a.token)).wardrobe.seen.includes("accessory:title_experienced_hat"));
 const before=structuredClone(s.find(a.token)),save=s.save;
 s.save=()=>{throw Error("disk full");};
 const input={slot:"hat",accessoryId:"title_experienced_hat",requestId:randomUUID()};
 assert.throws(()=>s.setAccessory(a.token,input),/disk full/);assert.deepEqual(s.find(a.token),before);s.save=save;
 s.setAccessory(a.token,input);assert(s.view(s.find(a.token)).wardrobe.seen.includes("accessory:title_experienced_hat"));
 s.setAccessory(a.token,{slot:"hat",accessoryId:null,requestId:randomUUID()});
 const restored=new ProfileStore({filePath});assert(restored.view(restored.find(a.token)).wardrobe.seen.includes("accessory:title_experienced_hat"));
 assert(!restored.view(restored.find(a.token)).wardrobe.seen.includes("accessory:title_experienced_bow"));
});
test("Legacy wardrobe retains starter entitlement and does not mark old wardrobe as new",t=>{
 const filePath=path.join(temporary(t,"legacy-wardrobe"),"profiles.json"),s=new ProfileStore(),a=s.open(),p=s.find(a.token);
 delete p.wardrobeState;p.outfit={hat:"novice_hat",bow:"novice_bow"};fs.writeFileSync(filePath,JSON.stringify(s.data));
 const restored=new ProfileStore({filePath}),q=restored.find(a.token);
 assert(A.isOwned(q,"novice_hat"));assert(q.wardrobeState.seen.includes("accessory:novice_hat"));assert.deepEqual(q.outfit,p.outfit);assert.deepEqual(q.wallet,p.wallet);
});

