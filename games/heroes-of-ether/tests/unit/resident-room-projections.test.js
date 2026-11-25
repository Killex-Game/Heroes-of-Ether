'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RoomProjections,applyProjection}=require('../../scripts/benchmarks/resident-room-processes/room-projections.cjs');
const {roomProfile}=require('../../scripts/benchmarks/resident-room-processes/room-profile.cjs');
function fixture(){
  let at=1000;const profiles=new Map(['a','b','outside'].map(id=>[id,{id,revision:1,name:id,level:20,
    skinId:'moon-dragon',quickSlots:['candy'],clanId:'c',account:{vipUntil:2000},
    wallet:{bucks:100},arenaReceipts:{secret:1},social:{giftEffects:[],marriage:null},outfit:{}}]));
  const identity=p=>({name:p.name,clanName:store.data.clans.c.name,account:{vip:at<2000},skinId:p.skinId});
  const cache=new Map(),store={byId:id=>profiles.get(id),data:{clans:{c:{name:'First'}}},identity,
    arenaAppearance:p=>{const key=p.id+':'+(at<2000);if(!cache.has(key))cache.set(key,{});return cache.get(key);}};
  const sent=[],child={connected:true,send:(m,callback)=>{sent.push(structuredClone(m));callback?.();}};
  const projection=new RoomProjections(store);projection.bind({id:'r',epoch:'e',profiles:[profiles.get('a'),profiles.get('b')]},child);
  const room={id:'r',epoch:'e',lookup:new Map([...profiles].filter(([id])=>id!=='outside').map(([id,p])=>[id,roomProfile(p)])),
    players:[{profileId:'a'},{profileId:'b'}],profiles:{},wallNow:()=>at};
  return {profiles,store,sent,child,projection,room,setAt:value=>{at=value;}};
}
test('room projection transmits owned participants only and retains unchanged context',()=>{
  const f=fixture();f.projection.flush();assert.equal(f.sent.length,1);
  assert.deepEqual(f.sent[0].updates.map(r=>r.profile.id),['a','b']);
  for(const row of f.sent[0].updates){assert(!('wallet'in row.profile));assert(!('arenaReceipts'in row.profile));}
  applyProjection(f.room,f.sent[0]);f.projection.flush();assert.equal(f.sent.length,1);
  f.profiles.set('outside',{...f.profiles.get('outside'),revision:2});f.projection.flush();assert.equal(f.sent.length,1);
  const changed={...f.profiles.get('a'),revision:2,social:{giftEffects:[{id:'test'}],marriage:null}};
  f.profiles.set('a',changed);f.projection.flush();assert.equal(f.sent.length,2);
  assert.equal(f.sent[1].updates.length,1);assert(!Object.hasOwn(f.sent[1],'events'));
  applyProjection(f.room,f.sent[1]);assert.deepEqual(f.room.lookup.get('a').social,changed.social);
  assert.equal(f.room.lookup.get('b').revision,1);
});
test('clan changes and timed status expiry refresh identities without changing profile rows',()=>{
  const f=fixture();f.projection.flush();applyProjection(f.room,f.sent.at(-1));
  f.store.data.clans.c={name:'Renamed'};f.projection.flush();applyProjection(f.room,f.sent.at(-1));
  assert.equal(f.room.players[0].clanName,'Renamed');assert.equal(f.sent.at(-1).updates.length,2);
  f.setAt(2000);f.projection.flush();applyProjection(f.room,f.sent.at(-1));
  assert.equal(f.room.players[0].account.vip,false);assert.equal(f.room.lookup.get('a').revision,1);
});
test('newer cast response cannot be overwritten by an older asynchronous projection',()=>{
  const f=fixture();f.projection.flush();
  f.room.lookup.set('a',{...f.room.lookup.get('a'),revision:3,name:'Newer'});
  applyProjection(f.room,f.sent[0]);assert.equal(f.room.lookup.get('a').name,'Newer');
  assert.equal(applyProjection(f.room,f.sent[0]),false);
  assert.throws(()=>applyProjection(f.room,{...f.sent[0],epoch:'another'}),/envelope/);
  const bad={...f.sent[0],sequence:2,updates:[{profile:{id:'outside',revision:1},identity:{}}]};
  assert.throws(()=>applyProjection(f.room,bad),/Unowned/);assert.equal(f.room.projectionSequence,1);
});
test('context-only event changes and removals reach the room; failed IPC is terminal',()=>{
  const f=fixture();f.projection.flush();applyProjection(f.room,f.sent.at(-1));
  const {EventManager}=require('../../src/server/events/event-manager');
  f.store.events=new EventManager({now:()=>1000});f.projection.flush();
  assert.equal(f.sent.at(-1).updates.length,0);applyProjection(f.room,f.sent.at(-1));
  assert.deepEqual(f.room.profiles.events.data,f.store.events.data);
  delete f.store.events;f.projection.flush();applyProjection(f.room,f.sent.at(-1));assert.equal(f.room.profiles.events,undefined);
  f.child.send=(m,callback)=>callback(Error('IPC closed'));f.profiles.set('a',{...f.profiles.get('a'),revision:2,name:'Changed'});
  f.projection.flush();assert.throws(()=>f.projection.flush(),/IPC closed/);
});

test('wallet and progress revisions retain the room image while later real input changes arrive',()=>{
  const f=fixture();f.projection.flush();applyProjection(f.room,f.sent.at(-1));
  for(let revision=2;revision<=101;revision++){
    const p=f.profiles.get('a');f.profiles.set('a',{...p,revision,wallet:{bucks:revision},progress:{total:revision}});
    f.store.data.clans.c={...f.store.data.clans.c,treasury:revision};f.projection.flush();
  }
  assert.equal(f.sent.length,1);assert.equal(f.projection.metrics.equivalentProfiles,200);
  assert.equal(f.room.lookup.get('a').revision,1);
  const p=f.profiles.get('a');f.profiles.set('a',{...p,revision:102,level:21,quickSlots:['meat'],pets:{equipped:'dragon',owned:{dragon:{level:2}}}});
  f.projection.flush();assert.equal(f.sent.length,2);assert.equal(f.sent[1].updates.length,1);
  applyProjection(f.room,f.sent[1]);assert.equal(f.room.lookup.get('a').revision,102);
  assert.equal(f.room.lookup.get('a').level,21);assert.deepEqual(f.room.lookup.get('a').quickSlots,['meat']);
  assert.deepEqual(f.room.lookup.get('a').pets,{equipped:'dragon',owned:{dragon:{level:2}}});
});
test('only authoritative equipped accessory entitlements enter the projected outfit',()=>{
  const item=require('../../public/shared/accessory-catalog').items.find(item=>item.slot==='hat'&&item.price);
  assert(item);
  const p={id:'a',level:20,outfit:{hat:item.id},purchasedAccessories:[],grantedAccessories:[]};
  const access=require('../../src/server/profiles/accessory-access');
  assert.equal(roomProfile(p).outfit.hat,null);
  p.purchasedAccessories.push(item.id);
  const q=roomProfile(p);assert.equal(q.outfit.hat,item.id);assert.deepEqual(q.outfit,access.outfit(p));
  assert.deepEqual(access.outfit(q),access.outfit(p));
  assert.deepEqual(q.grantedAccessories,Object.values(q.outfit).filter(Boolean));
});
