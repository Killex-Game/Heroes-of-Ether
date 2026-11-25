"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {setupWithBattle}=require('../fixtures/season-trophies'),{temporary}=require('../temp');
const rules=require('../../public/shared/clan-competition-rules'),skins=require('../../public/shared/skin-collection-preview'),accessories=require('../../public/shared/accessory-catalog');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const counter={coins:'spendthrift',crystals:'spendthrift_i',bucks:'spendthrift_ii'};
test('Cup prices match actual debit and ordinary achievements for every sold skin and accessory; retries and restore are exact',t=>{
  const filePath=path.join(temporary(t,'cup-cosmetics'),'world.json'),f=setupWithBattle({filePath}),u=f.heads[0];
  f.c(u).competition.league=5;f.profiles.save(f.profiles.data);f.time('2026-12-31T21:00:00Z');f.profiles.refreshCompetition();
  for(const currency of Object.keys(counter))f.p(u).wallet[currency]=1000000;
  f.profiles.save(f.profiles.data);
  const benefits=f.profiles.view(f.p(u)).seasonBenefits;assert.equal(benefits.discount,15);assert.equal(benefits.until,f.now()+30*rules.DAY);
  for(const [kind,items] of [['skin',skins.collections],['accessory',accessories.items.filter(i=>i.price)]])for(const item of items){
    const amount=rules.discountedPrice(item.price,15),before=structuredClone(f.p(u)),requestId=randomUUID();
    const buy=()=>kind==='skin'?f.profiles.buySkinCollection(u.token,{collectionId:item.id,requestId,price:0,discount:100}):f.profiles.setAccessory(u.token,{action:'buy',accessoryId:item.id,requestId,price:0,discount:100});
    buy();const after=structuredClone(f.p(u));buy();assert.deepEqual(f.p(u),after);
    assert.equal(before.wallet[item.currency]-after.wallet[item.currency],amount,item.id);
    assert.equal(after.activity.values[counter[item.currency]]-before.activity.values[counter[item.currency]],amount,item.id);
  }
  const recovered=new ProfileStore({filePath,now:f.now});assert.deepEqual(recovered.find(u.token).wallet,f.p(u).wallet);assert.deepEqual(recovered.find(u.token).activity,f.p(u).activity);
});
test('A discounted purchase failure rolls back, an expired cup or departed membership uses full price',t=>{
  const f=setupWithBattle({filePath:path.join(temporary(t,'cup-failure'),'world.json')}),u=f.heads[0];
  f.c(u).competition.league=0;f.profiles.save(f.profiles.data);f.time('2026-12-31T21:00:00Z');f.profiles.refreshCompetition();
  const item=skins.collections[0],input={collectionId:item.id,requestId:randomUUID()},before=structuredClone(f.profiles.data),save=f.profiles.save;
  f.profiles.save=()=>{throw Error('TEST disk');};assert.throws(()=>f.profiles.buySkinCollection(u.token,input),/TEST disk/);assert.deepEqual(f.profiles.data,before);f.profiles.save=save;
  const until=f.profiles.view(f.p(u)).seasonBenefits.until,benefits=f.profiles.view(f.p(u)).seasonBenefits;
  assert.equal(rules.currentDiscount(benefits,until-1),2);assert.equal(rules.currentDiscount(benefits,until),0);
  f.time(until);f.profiles.transactProfile(u.token,randomUUID(),'calendar-refresh',()=>{});
  let wallet=f.p(u).wallet.coins;f.profiles.buySkinCollection(u.token,input);assert.equal(wallet-f.p(u).wallet.coins,item.price);
  f.time(until-1);const member=f.user();f.act(member,'apply',{clanId:f.c(u).id});assert.equal(f.profiles.view(f.p(member)).seasonBenefits.discount,2);
  f.act(member,'leave',{clanId:f.c(u).id});wallet=f.p(member).wallet.coins;f.profiles.buySkinCollection(member.token,{...input,requestId:randomUUID()});assert.equal(wallet-f.p(member).wallet.coins,item.price);
});
test('The strongest active cup expires into a weaker current cup without extending either',()=>{
  const at=Date.parse('2027-01-10T00:00:00Z'),b=rules.trophyBenefits({competition:{trophies:[{league:5,awardedAt:at-29*rules.DAY},{league:0,awardedAt:at-5*rules.DAY}]}},at);
  assert.equal(rules.currentDiscount(b,at),15);assert.equal(rules.currentDiscount(b,at+rules.DAY),2);assert.equal(rules.currentDiscount(b,at+25*rules.DAY),0);
});

test('A batched skin purchase reads the current clan cup from its own pending world',()=>{
  const f=setupWithBattle(),u=f.heads[0];
  f.c(u).competition.league=0;f.profiles.save(f.profiles.data);f.time('2026-12-31T21:00:00Z');f.profiles.refreshCompetition();
  const {createProfileBatch,sealProfileBatch}=require('../../src/server/profiles/profile-batch');
  const batch=createProfileBatch(structuredClone(f.profiles.data)),id=f.c(u).id,item=skins.collections[0];
  batch.next.clans[id].competition.trophies=[];
  const key=Object.keys(batch.next.profiles).find(k=>batch.next.profiles[k].id===u.profile.id),before=batch.next.profiles[key].wallet.coins;
  f.profiles.buySkinCollection(u.token,{collectionId:item.id,requestId:randomUUID()},batch);sealProfileBatch(batch);
  assert.equal(before-batch.next.profiles[key].wallet.coins,item.price);
  assert.equal(f.profiles.view(f.p(u)).seasonBenefits.discount,2);
});
