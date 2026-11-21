"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const fixture=require('../helpers/black-friday-fixture'),B=require('../../src/server/events/black-friday'),book=require('../../src/server/events/black-friday-orders');
const Q=require('../../src/server/progression/personal-quests'),appearance=require('../../src/server/profiles/league-appearance');
function select(f,metric,tier='common',token=f.user.token){
 const p=f.store.find(token); p.blackFriday||={runs:{}};
 const s=p.blackFriday.runs[f.run.id]||={tokens:0,completedOrders:0,days:{},purchases:{},finalAt:null};
 const d=book.ensure(p,s,B.day(f.now()),f.now());
 let slot=d.slots.find(x=>x.tier===tier&&!x.complete);
 if(!slot){slot=d.slots.find(x=>!x.complete&&Number(x.current.id.split(':')[1])===d.lanes[x.tier].issued-1);d.lanes[slot.tier].issued--;slot.tier=tier;slot.current.id=tier+':'+d.lanes[tier].issued+++':0';slot.current.revision=0;}
 slot.current.template=book.templates.findIndex(t=>t.metric===metric);slot.current.progress=0;delete slot.current.opponents;
 const id=slot.current.id;
 return ()=>B.view(f.store.find(token),f.manager,f.now()).orders.find(x=>x.id===id).progress;
}
const tx=(f,fn,id=randomUUID())=>f.store.transact(f.user.token,id,'test-order-credit',fn);
test('Hero theme is permanent, server gated, and cannot be bought or opened by a general preview',()=>{
 const f=fixture(),p=f.p(),input={slot:'theme',themeId:'heroic'};
 assert.throws(()=>appearance.update(p,input,{},f.now(),true,true),/Герой/);
 assert.throws(()=>appearance.update(p,{...input,action:'buy'},{},f.now()),/покупки/);
 p.honors.claimed=10;
 const before=structuredClone(p.wallet);appearance.update(p,input,{},f.now());
 assert.equal(p.appearance.uiTheme,'heroic');assert.equal(p.appearance.lobbyBackground,'heroic');assert.deepEqual(p.wallet,before);
 assert.equal(appearance.selected(p,{},f.now()+365*86400000).uiTheme,'heroic');
 assert.ok(!appearance.skinSets(p).includes('heroic'));
});
test('daily hit targets reset per life, Hook is cumulative and unique; unfinished Marathon retires',()=>{
 for(const [id,metric,reset]of [['freeze_hit_large','freezeHits',true],['rocket_hit_large','rocketHits',true],['thorn_hit_large','hazardHits',true],['glove_hit_large','pushHits',true],['hook_hit_large','hookHits',false]]){
  const f=fixture();f.progress({type:'lifeStarted',lifeId:'one'});
  const row=f.p().quests.items.find(q=>q.questId===id) || f.p().quests.items[0];row.questId=id;row.progress=0;
  const find=()=>f.p().quests.items.find(x=>x.id===row.id);
  for(let sequence=1;sequence<4;sequence++)f.progress({type:'arenaAction',lifeId:'one',sequence,metric,targetProfileId:'a'});
  assert.equal(find().progress,1);
  f.progress({type:'lifeEnded',lifeId:'one',durationSeconds:2,reason:'exit'},{type:'lifeStarted',lifeId:'two'});
  assert.equal(find().progress,reset?0:1);
  for(const[sequence,targetProfileId]of[[1,'a'],[2,'b']])f.progress({type:'arenaAction',lifeId:'two',sequence,metric,targetProfileId});
  assert.equal(find().progress,2);Q.validate(f.p());
 }
 const f=fixture(),row=f.p().quests.items[0];row.questId='marathon';row.progress=12;
 Q.ensure(f.p(),f.now());assert.ok(f.p().quests.items.every(x=>x.questId!=='marathon'));Q.validate(f.p());
 const cumulative=f.p().quests.items.find(q=>q.questId==='rocket_large') || f.p().quests.items[0];cumulative.questId='rocket_large';cumulative.progress=3;
 Q.ensure(f.p(),f.now());assert.equal(f.p().quests.items.find(q=>q.id===cumulative.id).questId,'rocket_large');assert.equal(f.p().quests.items.find(q=>q.id===cumulative.id).progress,3);Q.validate(f.p());
});
test('uses count successful receipts only, categories separately, Poison permits repeated target hits',()=>{
 for(const [metric,boosterId,target]of[['boosterUses','pet_fire',100],['shieldUses','colorful_shield',50],['commonUses','candy',100],['advancedUses','mine',150],['rareUses','golden_shield',200],['clanUses','fire',300],['poisonHits',null,25]]){
  const f=fixture();f.progress({type:'lifeStarted',lifeId:'one'});
  const tier=metric==='advancedUses'||metric==='rareUses'?'important':metric==='clanUses'?'secret':'common';
  const value=select(f,metric,tier);
  const event={type:'arenaAction',lifeId:'one',metric:boosterId?'boosterUses':'poisonHits',boosterId,targetProfileId:'same-player',sequence:1};
  f.progress(event);f.progress(event);assert.equal(value(),1,metric);
  f.progress({...event,sequence:2});assert.equal(value(),2,metric);
  f.progress({...event,lifeId:'stale',sequence:3});assert.equal(value(),2,metric);
  B.validate(f.p());
 }
});
test('purchases and gifted buffs count atomically, including anonymous/self gifts, without replay credit',()=>{
 const f=fixture();f.p().wallet.coins=10000;f.p().wallet.bucks=1000;
 const bought=select(f,'purchasedBoosters'),request=randomUUID();
 f.store.buy(f.user.token,'candy',request);assert.equal(bought(),10);
 f.store.buy(f.user.token,'candy',request);assert.equal(bought(),10);
 const recipient=f.store.open(),sent=select(f,'giftsGiven'),received=select(f,'giftsReceived','common',recipient.token);
 const input={action:'gift',giftId:'clover',targetId:recipient.profile.id,confirmed:true,anonymous:true,requestId:randomUUID()};
 f.store.socialAction(f.user.token,input);assert.equal(sent(),1);assert.equal(received(),1);
 f.store.socialAction(f.user.token,input);assert.equal(sent(),1);assert.equal(received(),1);
 f.store.socialAction(f.user.token,{...input,targetId:f.p().id,requestId:randomUUID()});assert.equal(sent(),2);
 const before=structuredClone(f.store.data),save=f.store.save;f.store.save=()=>{throw Error('disk full')};
 assert.throws(()=>f.store.socialAction(f.user.token,{...input,requestId:randomUUID()}),/disk full/);assert.deepEqual(f.store.data,before);f.store.save=save;
});
test('promotional packs and clan purchases count purchased items only for their buyer',()=>{
 const config=require('../../config/promotions.json');
 const f=fixture({promotionConfig:config});
 f.store.setPersonal(f.user.token,{name:'Покупатель',expectedName:f.p().name,gender:'unspecified',requestId:randomUUID()});
 const promoValue=select(f,'purchasedBoosters','secret');
 const input={productId:config.productIds[0],confirmed:true,requestId:randomUUID()};
 f.store.confirmMockPurchase(f.user.token,input);assert.equal(promoValue(),300);
 f.store.confirmMockPurchase(f.user.token,input);assert.equal(promoValue(),300);
 const g=fixture(),{ClanService}=require('../../src/server/clans/clan-service');
 const clans=new ClanService(g.store),xp=require('../../src/server/progression/experience-progression');
 g.p().level=12;g.p().progress.xp=xp.xpForLevel(12);g.p().wallet.coins=10000;
 clans.mutate(g.user.token,{action:'create',name:'Заказы',prefix:'BUY',emblem:'astral',privacy:'open',requestId:randomUUID()});
 const clan=g.store.data.clans[g.p().clanId];clan.treasury=1000;
 const value=select(g,'purchasedBoosters'),buy={action:'buyBooster',clanId:clan.id,boosterId:'fire',requestId:randomUUID()};
 clans.mutate(g.user.token,buy);assert.equal(value(),10);
 clans.mutate(g.user.token,buy);assert.equal(value(),10);
 B.validate(g.p());
});
test('roulette counts actual spins; prepared offers do not advance orders',()=>{
 const f=fixture(),R=require('../../src/server/roulette/roulette-service'),rules=require('../../public/shared/roulette-rules');
 const value=select(f,'rouletteSpins');f.p().roulette.tickets=10;f.p().roulette.earned=10;
 const act=(action,extra={})=>R.mutate(f.store,f.user.token,{action,requestId:randomUUID(),rulesVersion:rules.version,...extra},()=>0);
 const offer=act('prepare').profile.roulette.offer;assert.equal(value(),0);
 const requestId=randomUUID();act('spin',{offerId:offer.id,requestId});assert.equal(value(),1);
 act('spin',{offerId:offer.id,requestId});assert.equal(value(),1);
});
test('earnings and credited kills advance after assignment, survive saves, never use spent/net wallet totals',()=>{
 const f=fixture(),coins=select(f,'coinsEarned','secret');
 const id=randomUUID();tx(f,p=>p.wallet.coins+=300,id);assert.equal(coins(),300);
 tx(f,p=>p.wallet.coins+=300,id);assert.equal(coins(),300);
 tx(f,p=>p.wallet.coins-=100);assert.equal(coins(),300);
 const previous=structuredClone(f.p()),draft=structuredClone(previous);
 const old=draft.transactions.entries.at(-1);draft.transactions.entries.push({...old,id:randomUUID(),at:f.now()-1,before:{...old.after,coins:100},after:{...old.after,coins:200}});
 const progressOf=p=>B.view(p,f.manager,f.now()).orders.find(x=>x.name==='Золотой запас').progress;
 assert.equal(progressOf(B.captureOrders(draft,previous,f.manager,f.now()+2)),300);
 draft.transactions.entries.at(-1).at=f.now()+1;
 const beforeCapture=structuredClone(draft),captured=B.captureOrders(draft,previous,f.manager,f.now()+2);
 assert.equal(progressOf(captured),400);
 assert.deepEqual(draft,beforeCapture,"published order state remains immutable");
 assert.equal(progressOf(draft),300);
 const kills=select(f,'creditedKills');tx(f,p=>p.progress.kills+=40);assert.equal(kills(),40);
});
