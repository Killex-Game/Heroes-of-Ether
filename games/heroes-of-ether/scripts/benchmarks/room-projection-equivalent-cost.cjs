'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {RoomProjections,applyProjection}=require('./resident-room-processes/room-projections.cjs');
const {roomProfile}=require('./resident-room-processes/room-profile.cjs');
const rounds=1000,count=30;
function run(coalesceEquivalent){
 let at=1000;const profiles=new Map(Array.from({length:count},(_,i)=>{const id='p'+i;return[id,{id,revision:1,name:id,level:50,skinId:'moon-dragon',clanId:'c',quickSlots:['candy'],appearance:{},account:{vipUntil:20000},outfit:{},social:{giftEffects:[],marriage:null},pets:{equipped:null,owned:{}},wallet:{bucks:0}}];}));
 const cache=new Map(),store={data:{clans:{c:{name:'Clan',treasury:0}}},byId:id=>profiles.get(id),
  arenaAppearance:p=>{const key=p.id+':'+(at<20000);if(!cache.has(key))cache.set(key,{});return cache.get(key);},
  identity:p=>({name:p.name,level:p.level,clanName:store.data.clans.c.name,account:{vip:at<20000}})};
 const room={id:'r',epoch:'e',lookup:new Map([...profiles].map(([id,p])=>[id,roomProfile(p)])),players:[...profiles.keys()].map(profileId=>({profileId})),profiles:{},wallNow:()=>at};
 let bytes=0;const child={connected:true,send:(message,callback)=>{bytes+=Buffer.byteLength(JSON.stringify(message));applyProjection(room,structuredClone(message));callback?.();}};
 const transport=new RoomProjections(store,{coalesceEquivalent});transport.bind({id:'r',epoch:'e',profiles:[...profiles.values()]},child);
 const hash=createHash('sha256');let elapsed=0;
 for(let n=0;n<rounds;n++){
  at=1000+n*50;for(const[id,p]of profiles)profiles.set(id,{...p,revision:p.revision+1,wallet:{bucks:n},progress:{total:n},...(n%100===0?{level:p.level+1}:{}),...(n===750?{social:{...p.social,giftEffects:[{id:'gift',until:100000}]}}:{})});
  store.data.clans.c={...store.data.clans.c,treasury:n,...(n%250===0?{name:'Clan '+n}:{})};
  const started=performance.now();transport.flush();elapsed+=performance.now()-started;
  // A deliberately unsent revision is a transport fence, not an arena value.
  // Compare every gameplay projection and identity after every source change.
  for(const[id,p]of profiles){const expected=roomProfile(p),actual=room.lookup.get(id);assert.deepEqual({...actual,revision:0},{...expected,revision:0});assert.deepEqual(room.identities.get(id),store.identity(p));hash.update(JSON.stringify([{...actual,revision:0},room.identities.get(id)]));}
 }
 return {variant:coalesceEquivalent?'changed-gameplay-only':'every-profile-revision',ms:elapsed,messages:transport.metrics.messages,profiles:transport.metrics.profiles,equivalentProfiles:transport.metrics.equivalentProfiles,payloadBytes:bytes,sha256:hash.digest('hex')};
}
const results=[false,true,true,false].map(run);for(const r of results)assert.equal(r.sha256,results[0].sha256);
console.log(JSON.stringify({scope:'Component only: 30 profiles / 1000 rounds; simulated IPC structuredClone and receiver, no actual network/OS IPC or game simulation. CPU timings include signature and payload encoding, exclude fixture changes and equality assertions.',exact:true,results}));
