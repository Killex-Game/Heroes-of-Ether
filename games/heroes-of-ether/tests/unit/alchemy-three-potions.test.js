'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const alchemy=require('../../src/server/events/ether-alchemy');
test('queue order, three effects, durable consumption, retries and new life',t=>{
 const filePath=require('node:path').join(require('../temp').temporary(t,'three-potions'),'profiles.json');
 const at=Date.UTC(2026,10,21,12);let store=new ProfileStore({filePath,now:()=>at});const user=store.open();
 const get=()=>store.find(user.token),ids=['strength','swiftness','knowledge','satiety'];
 for(const id of ids)get().inventory['alchemy_'+id]=2;
 const equip=list=>alchemy.mutate(store,user.token,{action:'equip',potionIds:list,requestId:randomUUID()});
 assert.throws(()=>equip(ids));assert.throws(()=>equip(['strength','strength']));
 equip(ids.slice(0,3));assert.deepEqual(store.identity(get()).potionQueue,ids.slice(0,3));
 store.applyArenaProgress(randomUUID(),[{type:'lifeStarted',profileId:get().id,lifeId:'life'}],at);
 const consume=(id,key=randomUUID())=>store.consume(user.token,'alchemy_'+id,key,'potion:'+id,()=>({lifeId:'life'}),true);
 assert.throws(()=>consume('knowledge'),/следующее/);
 for(const id of ids.slice(0,3)){
  const key=randomUUID();consume(id,key);assert.equal(get().inventory['alchemy_'+id],1);
  assert.equal(consume(id,key).replay,true);assert.equal(get().inventory['alchemy_'+id],1);
 }
 assert.deepEqual(get().alchemy.active.ids,ids.slice(0,3));
 assert.throws(()=>consume('satiety'));assert.throws(()=>consume('strength'));
 alchemy.validate(get());
 const previous=structuredClone(get().alchemy);get().alchemy.active.ids=['strength','strength'];
 assert.throws(()=>alchemy.validate(get()));get().alchemy=previous;
 store.applyArenaProgress(randomUUID(),[{type:'lifeEnded',profileId:get().id,lifeId:'life',reason:'exit',durationSeconds:1}],at);
 assert(!get().alchemy.active);
 store=new ProfileStore({filePath,now:()=>at});assert(!get().alchemy.active);
});
test('combined modifiers add different effects and keep one fastest power pulse',()=>{
 assert.deepEqual(alchemy.rules.combine(['strength','archmage','swiftness']),{pulseMs:8000,positiveDuration:.2,speed:.08});
 assert.equal(alchemy.rules.combine(['strength','strength']).pulseMs,10000);
 assert.deepEqual(alchemy.rules.equipped({equipped:'strength'}),['strength']);
 assert.deepEqual(alchemy.rules.activeIds({id:'strength'}),['strength']);
});
