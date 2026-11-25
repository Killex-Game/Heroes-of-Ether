'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{ProfileStore}=require('../../src/server/profiles/profile-store');
const file=require.resolve('../../src/server/profiles/arena-appearance-cache');
assert(process.env.BASELINE_ARENA_APPEARANCE,'Baseline source is required');
const previous=new Module(file,module);previous.filename=file;previous.paths=Module._nodeModulePaths(path.dirname(file));
previous._compile(fs.readFileSync(process.env.BASELINE_ARENA_APPEARANCE,'utf8'),file);
const at=Date.parse('2026-11-24T09:00:00.000Z'),fixture=require('./database-room-fixture.cjs').createFixture(at);
const source=Object.values(fixture.data.profiles).slice(0,30),variants=[previous.exports,require(file)],results=[];
for(const clanChanges of [false,true]){
 let expected;
 for(const variant of [0,1,1,0]){
  const store=Object.create(ProfileStore.prototype);store.data={...fixture.data,clans:{...fixture.data.clans}};store.now=()=>at;
  store.arenaAppearanceCache=new variants[variant].ArenaAppearanceCache();
  const profiles=source.map(p=>({...p,account:{...p.account,vipUntil:at+86400000},appearance:{...p.appearance,arenaFrame:'vip'}}));
  const clans=[...new Set(profiles.map(p=>p.clanId))];
  let duration=0,reused=0;const hash=createHash('sha256'),last=[];
  for(let round=0;round<2100;round++){
   if(clanChanges)for(const id of clans)store.data.clans[id]={...store.data.clans[id],xp:round,treasury:round*100};
   const started=performance.now();
   for(let i=0;i<profiles.length;i++){
    const p=profiles[i];store.arenaAppearance(p);
    profiles[i]={...p,revision:p.revision+1,wallet:{...p.wallet,coins:round}};
    const value=store.arenaAppearance(profiles[i]);if(value===last[i])reused++;last[i]=value;
    if(round>=100)hash.update(JSON.stringify(value));
   }
   if(round>=100)duration+=performance.now()-started;
  }
  const digest=hash.digest('hex');if(expected)assert.equal(digest,expected);else expected=digest;
  results.push({variant:variant?'after':'before',clanChanges,profiles:30,measuredRounds:2000,ms:duration,reused,digest});
 }
}
console.log(JSON.stringify({exact:true,scope:'Personal appearance projection only, synthetic clan changes; no whole-game speed or network claim',results}));
