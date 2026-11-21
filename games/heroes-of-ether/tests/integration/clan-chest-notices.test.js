"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),chests=require("../../src/server/clans/clan-chest-rewards"),promo=require("../../src/server/profiles/promo-codes"),{temporary}=require("../temp");
const at=Date.parse("2026-11-15T00:00:00Z");
function setup(filePath){const store=new ProfileStore({filePath,now:()=>at}),auth=store.open();return {store,token:auth.token,player:()=>store.find(auth.token)}}
function redeem(f,amount){
 const row=promo.normalize({code:"CHEST-TEST",title:"Тест",enabled:true,startsAt:0,endsAt:0,maxRedemptions:0,rewards:[{kind:"chest",id:"high",amount}]});
 f.store.data.promoCodes={version:1,revision:0,items:[{...row,id:randomUUID(),redeemed:0,createdAt:at,updatedAt:at}]};
 return promo.redeem(f.store,f.token,{code:row.code,requestId:randomUUID()});
}
test("Сундук по промокоду без клана: открытие убирает уведомление, повтор и перезапуск не повторяют награду",t=>{
 const file=path.join(temporary(t,"clan-chest-notices"),"profiles.json"),f=setup(file);
 redeem(f,1);
 assert.equal(f.player().clanId,null);
 const id=f.player().clanChests.items[0].id,act=(action,requestId=randomUUID())=>f.store.clanChestAction(f.token,{action,chestId:id,requestId});
 assert.equal(f.store.view(f.player()).clanChests.notices.length,1);
 act("claim");act("prepare");
 const before=structuredClone(f.player()),rename=fs.renameSync;
 const failure=t.mock.method(fs,"renameSync",(from,to)=>{if(to===file)throw Error("test disk full");return rename(from,to)});
 const requestId=randomUUID();assert.throws(()=>act("open",requestId));assert.deepEqual(f.player(),before,"reward and notice roll back together");failure.mock.restore();
 act("open",requestId);const earned=structuredClone(f.player());
 assert.equal(earned.clanChests.items.length,0);assert.equal(earned.clanChests.notices.length,0);assert.ok(earned.wallet.coins>before.wallet.coins);
 act("open",requestId);assert.deepEqual(f.player(),earned);
 const restored=new ProfileStore({filePath:file,now:()=>at});assert.deepEqual(restored.find(f.token),earned);
});
test("Старые уведомления без сундука скрыты во всех проекциях; другие награды и доступные сундуки остаются",()=>{
 const f=setup();redeem(f,2);const p=f.player();
 const [first,second]=p.clanChests.items;const missing=p.clanChests.notices.find(n=>n.chestId===first.id);
 p.clanChests.items=p.clanChests.items.filter(i=>i.id!==first.id);
 chests.notice(p,"Награда за неделю: Бронзовая",at);chests.notice(p,"Кубок за 2 сезон Бронзовая 2026",at);chests.notice(p,"Клановый сундук высшей степени: срок истёк",at,"expired");
 const original=structuredClone(p),view=chests.view(p,at);
 assert.equal(view.notices.some(n=>n.id===missing.id),false);assert.equal(view.notices.length,4);assert.equal(view.items.length,1);assert.equal(view.items[0].id,second.id);assert.deepEqual(p,original,"reading does not rewrite rewards/history");
 assert.equal(f.store.view(p).clanChests.notices.some(n=>n.id===missing.id),false);
});
test("Уведомления старого формата без chestId и истёкшие сундуки не дают ложной доступности",()=>{
 const f=setup(),p=f.player();chests.grant(p,"low",at);const item=p.clanChests.items[0],notice=p.clanChests.notices[0];delete notice.chestId;
 assert.equal(chests.view(p,at).notices.length,1);
 item.expiresAt=at;assert.equal(chests.view(p,at).notices.length,0);
 item.stored=true;assert.equal(chests.view(p,at).notices.length,1,"stored chest has no expiration");
 p.clanChests.items=[];assert.equal(chests.view(p,at).notices.length,0);
});
