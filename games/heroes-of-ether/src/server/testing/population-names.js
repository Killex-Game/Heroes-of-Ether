"use strict";
// Explicit offline operation. Never invoke from startup, a tick, or a player request.
const assert=require('node:assert/strict');
const {MARKER}=require('./arena-test-bots'),catalog=require('./population-name-catalog');
const {key}=require('../profiles/nickname-rules'),{cleanName}=require('../arena/arena-simulation');
const {prefixKey,validateWorld}=require('../clans/clan-service');
const {countProfanity}=require('../chat/profanity');
const {REVISION}=require('../profiles/profile-journal');
const VERSION=2;
function eligibleProfile(p){return p.testBot===MARKER&&(p.testDisplayNameVersion||0)<VERSION;}
function eligibleClan(c){return c.testOnly===MARKER&&(c.testDisplayNameVersion||0)<VERSION;}
function assertOnlyRenames(before,after){
 const restored=structuredClone(after);
 assert.deepEqual(Object.keys(restored.profiles).sort(),Object.keys(before.profiles).sort());
 assert.deepEqual(Object.keys(restored.clans).sort(),Object.keys(before.clans).sort());
 for(const [id,p] of Object.entries(before.profiles))if(eligibleProfile(p)){
  const q=restored.profiles[id];assert.equal(q.revision,p.revision+1);assert.equal(q.testDisplayNameVersion,VERSION);
  q.name=p.name;q.revision=p.revision;
  if(p.testDisplayNameVersion===undefined)delete q.testDisplayNameVersion;else q.testDisplayNameVersion=p.testDisplayNameVersion;
 }
 for(const [id,c] of Object.entries(before.clans))if(eligibleClan(c)){
  const q=restored.clans[id];assert.equal(q.testDisplayNameVersion,VERSION);q.name=c.name;q.prefix=c.prefix;
  if(c.testDisplayNameVersion===undefined)delete q.testDisplayNameVersion;else q.testDisplayNameVersion=c.testDisplayNameVersion;
 }
 if(Object.hasOwn(before,REVISION))restored[REVISION]=before[REVISION];else delete restored[REVISION];
 assert.deepEqual(restored,before,'Only marked names, prefixes and bot display revisions may change');
}
function renamePopulation(data){
 const next=structuredClone(data),profiles=Object.values(next.profiles),clans=Object.values(next.clans);
 const names=new Set(profiles.filter(p=>!eligibleProfile(p)).map(p=>key(p.name)));
 const pool=catalog.nicknamePool().filter(n=>cleanName(n)===n&&Array.from(n).length<=16&&!countProfanity(n));
 const bots=profiles.filter(eligibleProfile).sort((a,b)=>a.id.localeCompare(b.id)),botChanges=[];let index=0;
 for(const p of bots){
  let name;do{if(index>=pool.length)throw Error('Nickname pool exhausted; extend authored catalog');name=pool[index++];}while(names.has(key(name)));
  names.add(key(name));botChanges.push({id:p.id,before:p.name,after:name});p.name=name;p.testDisplayNameVersion=VERSION;p.revision++;
 }
 const reserved=clans.filter(c=>!eligibleClan(c)),prefixes=new Set(reserved.map(c=>prefixKey(c.prefix))),clanNames=new Set(reserved.map(c=>key(c.name)));
 const clanChanges=[];let clanIndex=0;
 for(const c of clans.filter(eligibleClan).sort((a,b)=>a.id.localeCompare(b.id))){
  let entry;do{if(clanIndex>=catalog.clans.length)throw Error('Clan catalog exhausted');entry=catalog.clans[clanIndex++];}while(prefixes.has(prefixKey(entry.prefix))||clanNames.has(key(entry.name)));
  assert(Array.from(entry.name).length>=2&&Array.from(entry.name).length<=32&&!/[\p{C}\[\]]/u.test(entry.name));assert.equal(countProfanity(entry.name),0);prefixes.add(prefixKey(entry.prefix));clanNames.add(key(entry.name));
  clanChanges.push({id:c.id,before:c.name,oldPrefix:c.prefix,after:entry.name,prefix:entry.prefix});Object.assign(c,entry,{testDisplayNameVersion:VERSION});
 }
 validateWorld(next);assertOnlyRenames(data,next);
 return{data:next,renamedBots:botChanges.length,renamedClans:clanChanges.length,botChanges,clanChanges};
}
module.exports={renamePopulation,assertOnlyRenames,VERSION};
