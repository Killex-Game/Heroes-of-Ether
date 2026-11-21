"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path"), {randomUUID} = require("node:crypto");
const {temporary} = require("../temp"), {ProfileStore} = require("../../src/server/profiles/profile-store"),
  {OwnerAccess} = require("../../src/server/admin/owner-access"), actions = require("../../src/server/admin/content-actions"),
  trash = require("../../src/server/admin/content-trash"), promo = require("../../src/server/profiles/promo-codes"), news = require("../../src/server/profiles/game-news");
test("trash restores exact promo identity and news; preserves claims, audit and durability without expiration", t => {
  let at = Date.UTC(2026,10,14);
  const filePath = path.join(temporary(t,"content-trash"),"profiles.json");
  let store = new ProfileStore({filePath,journal:true,now:()=>at});
  const owner=store.open(), player=store.open(), access=new OwnerAccess({ownerId:owner.profile.id});
  const apply=(domain,body)=>actions.apply(store,access,store.find(owner.token),domain,{requestId:randomUUID(),reason:"Проверка корзины",revision:store.data[domain]?.revision||0,...body},domain==="promoCodes"?promo.normalize:news.normalize);
  apply("promoCodes",{code:"RESTORE",title:"Подарок",enabled:true,startsAt:0,endsAt:0,maxRedemptions:2,rewards:[{kind:"currency",id:"coins",amount:10}]});
  const redemption={code:"RESTORE",requestId:randomUUID()};promo.redeem(store,player.token,redemption);
  const original=structuredClone(store.data.promoCodes.items[0]), profile=structuredClone(store.find(player.token));
  apply("gameNews",{title:"Статья",body:"Исходный текст",date:"2026-11-14",category:"event",visible:true});
  const article=structuredClone(store.data.gameNews.items[0]);
  for(const [domain,item] of [["promoCodes",original],["gameNews",article]])apply(domain,{action:"delete",id:item.id,confirmed:true});
  assert.equal(news.view(store).items.length,0);assert.equal(trash.view(store).total,2);
  assert.equal(trash.view(store,{domain:"promoCodes",q:"restore"}).items.length,1);
  at+=400*86400000;store=new ProfileStore({filePath,journal:true,now:()=>at});
  assert.equal(trash.view(store).total,2,"trash never expires on load or with time");
  const beforeRestore=structuredClone(store.find(player.token));
  for(const key of ["wallet","inventory","transactions","promoClaims","receipts"])assert.deepEqual(beforeRestore[key],profile[key]);
  for(const domain of ["promoCodes","gameNews"]) {
    const item=trash.view(store,{domain}).items[0];
    const input={trashId:item.id,revision:item.revision,confirmed:true,requestId:randomUUID(),reason:"Вернуть запись"};
    assert.throws(()=>trash.restore(store,access,store.find(player.token),input),/Только владелец/);
    assert.throws(()=>trash.restore(store,access,store.find(owner.token),{...input,confirmed:false}),/Подтверди/);
    assert.throws(()=>trash.restore(store,access,store.find(owner.token),{...input,revision:0}),/изменился/);
    const before=structuredClone(store.data),save=store.save;store.save=()=>{throw Error("disk full");};
    assert.throws(()=>trash.restore(store,access,store.find(owner.token),input),/disk full/);assert.deepEqual(store.data,before);store.save=save;
    assert.equal(trash.restore(store,access,store.find(owner.token),input).replay,false);
    store=new ProfileStore({filePath,journal:true,now:()=>at});
    assert.equal(trash.restore(store,access,store.find(owner.token),input).replay,true,"lost restore ACK replays after restart");
    assert.throws(()=>trash.restore(store,access,store.find(owner.token),{...input,requestId:randomUUID(),revision:store.data[domain].revision}),/уже восстановлена/);
  }
  assert.equal(trash.view(store).total,0);
  assert.deepEqual({...store.data.promoCodes.items[0],updatedAt:original.updatedAt},original);
  assert.deepEqual({...store.data.gameNews.items[0],updatedAt:article.updatedAt},article);
  const afterRestore=store.find(player.token);
  assert.equal(afterRestore.daily.day,beforeRestore.daily.day+400,"normal daily calendar settlement follows the simulated clock");
  assert.deepEqual({...afterRestore,daily:beforeRestore.daily},beforeRestore);
  assert.equal(promo.redeem(store,player.token,redemption).replay,true);
  assert.throws(()=>promo.redeem(store,player.token,{code:"RESTORE",requestId:randomUUID()}),/уже активировал/);
  assert.equal(store.data.promoCodes.retired.length,0);
  const firstRestore=store.data.administration.audit.find(e=>e.label==="Восстановление промокода");
  apply("promoCodes",{action:"delete",id:original.id,confirmed:true});
  assert.equal(trash.view(store).total,1);assert.equal(trash.view(store).items[0].objectId,original.id);
  assert.ok(store.data.administration.audit.some(e=>e.id===firstRestore.id),"redelete keeps all earlier audit records");
  assert.throws(()=>actions.apply(store,access,store.find(owner.token),"profiles",{},()=>({})),/не допускает/);
});
