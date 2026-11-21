"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const crypto=require('node:crypto');let sequence=0;
// This standalone synthetic process owns all randomness; no live profiles.
crypto.randomUUID=()=>`00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12,'0')}`;
const file=require.resolve('../../src/server/profiles/profile-store');
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(process.env.BASELINE_STORE,'utf8'),file);
const stores=[old.exports.ProfileStore,require(file).ProfileStore];
const {createProfileBatch,sealProfileBatch}=require('../../src/server/profiles/profile-batch');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
const at=Date.parse('2026-11-12T12:00:00Z'),seed=new stores[1]({now:()=>at});
const users=Array.from({length:35},()=>seed.open()),all=[...BOOSTERS.values()].filter(b=>b.ready);
for(const [i,user]of users.entries()){
  seed.startLife(user.profile.id,'life-'+i);const p=seed.find(user.token);
  p.greatness=99;p.progress.boosterUses=99;
  p.easter={runs:{},chests:[],trophies:[],batches:[{count:500,expiresAt:require('../../src/server/events/easter-hunt').expiresAt(at)}]};
  for(const b of all)p.inventory[b.id]=500;
}
const results=[];
for(const history of [0,32,64,256]) {
  const baseline=structuredClone(seed.data);
  for(const p of Object.values(baseline.profiles))for(let i=0;i<history;i++){
    p.progress.recentVictims['victim-'+i]=at-1000;
    p.progress.absorptionVictims['victim-'+i]=at-1000;
  }
  let expected;
  for(const variant of [0,1,1,0]) {
    const store=new stores[variant]({now:()=>at});store.data=baseline;sequence=10000;
    let next=baseline,ms=0;
    for(let round=0;round<60;round++) {
      const batch=createProfileBatch(next),start=performance.now();
      for(const [i,u]of users.entries()){
        const b=all[(round+i)%all.length],req='cast-draft-benchmark-'+round+'-'+i;
        store.consume(u.token,b.id,req,'cast:'+b.id,()=>({mass:25000+round*1000}),true,batch);
      }
      sealProfileBatch(batch);ms+=performance.now()-start;next=batch.next;
    }
    if(expected)assert.deepEqual(next,expected);else expected=next;
    results.push({history,variant:variant?'selective':'previous',ms,casts:60*35});
  }
  assert.deepEqual(baseline.profiles[Object.keys(baseline.profiles)[0]].inventory,
    seed.data.profiles[Object.keys(seed.data.profiles)[0]].inventory);
}
console.log(JSON.stringify({exact:true,scope:'all 30 booster transactions, 35 profiles, fixed awards; no socket or disk timings',results}));
