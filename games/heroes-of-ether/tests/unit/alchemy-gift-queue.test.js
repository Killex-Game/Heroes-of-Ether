'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{GameGrants}=require('../../src/server/admin/game-grants'),alchemy=require('../../src/server/events/ether-alchemy');
test('all sixteen gifted potions equip and consume once after an exhausted queue; delivery and inventory survive reload',t=>{
 const at=Date.UTC(2026,10,26),file=require('node:path').join(require('../temp').temporary(t,'potion-gifts'),'profiles.json');
 let store=new ProfileStore({filePath:file,now:()=>at});const user=store.open(),owner=store.find(user.token);
 store.transactProfile(user.token,randomUUID(),'old-empty-queue',p=>{p.alchemy={version:1,natural:0,ingredients:{},learned:[],equipped:'precision',queue:['precision']};});
 const gifts=new GameGrants({profiles:store,access:{isOwner:p=>p.id===owner.id},now:()=>at});
 const rewards=alchemy.rules.potions.map(p=>({kind:'booster',id:p.boosterId,amount:1}));
 const preview=gifts.preview(owner,{title:'Зелья',message:'Подарок для проверки всех зелий',rewards});
 const command={previewId:preview.previewId,requestId:randomUUID(),confirmed:true};gifts.create(owner,command);gifts.deliver();assert.equal(gifts.deliver(),false);assert(gifts.create(owner,command).duplicate);
 for(const recipe of alchemy.rules.potions){
  const equip={action:'equip',potionIds:[recipe.id],requestId:randomUUID()};alchemy.mutate(store,user.token,equip);assert(alchemy.mutate(store,user.token,equip).replay);
  const lifeId=randomUUID();store.applyArenaProgress(randomUUID(),[{type:'lifeStarted',profileId:owner.id,lifeId}],at);
  const request=randomUUID();store.consume(user.token,recipe.boosterId,request,'gift-potion:'+recipe.id,()=>({lifeId}),true);
  assert.equal(store.consume(user.token,recipe.boosterId,request,'gift-potion:'+recipe.id,()=>({lifeId}),true).replay,true);
  assert.equal(store.find(user.token).inventory[recipe.boosterId],0);
  assert.deepEqual(alchemy.view(store.find(user.token),store.events,at).queue,[]);
  store.applyArenaProgress(randomUUID(),[{type:'lifeEnded',profileId:owner.id,lifeId,reason:'exit',durationSeconds:1}],at);
 }
 const before=structuredClone(store.find(user.token));store=new ProfileStore({filePath:file,now:()=>at});assert.deepEqual(store.find(user.token),before);
 assert.equal(Object.values(store.data.gameGrants.campaigns[0].outcomes)[0].status,'delivered');
});
test('a stale exhausted previous entry is removed but a newly requested unowned potion is rejected',()=>{
 const store=new ProfileStore(),u=store.open();store.transactProfile(u.token,randomUUID(),'gift',p=>{
  p.inventory.alchemy_fortitude=1;p.alchemy={version:1,natural:0,ingredients:{},learned:[],equipped:'precision',queue:['precision']};});
 const equip=queue=>alchemy.mutate(store,u.token,{action:'equip',potionIds:queue,requestId:randomUUID()});
 assert.throws(()=>equip(['prosperity']),/нет в запасе/);equip(['precision','fortitude']);
 assert.deepEqual(store.find(u.token).alchemy.queue,['fortitude']);assert.equal(store.find(u.token).inventory.alchemy_fortitude,1);
});
