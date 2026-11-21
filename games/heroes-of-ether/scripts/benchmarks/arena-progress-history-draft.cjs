"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const crypto=require('node:crypto');let sequence=0,randomSeed=907;
// Deterministic reward rolls belong only to this standalone replay process.
crypto.randomInt=(min,max)=>{if(max===undefined){max=min;min=0;}
  randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;
  return min+Math.floor(randomSeed/4294967296*(max-min));};
crypto.randomUUID=()=>`00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12,'0')}`;
const file=require.resolve('../../src/server/profiles/profile-store');
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(process.env.BASELINE_STORE,'utf8'),file);
const stores=[old.exports.ProfileStore,require(file).ProfileStore];
const at=Date.parse('2026-11-12T12:00:00Z'),seed=new stores[1]({now:()=>at});
const users=Array.from({length:35},()=>seed.open());
for(const [i,u]of users.entries())seed.startLife(u.profile.id,'history-life-'+i);
const results=[];
for(const history of [0,32,256])for(const mixed of [false,true]){
  const baseline=structuredClone(seed.data);
  for(const p of Object.values(baseline.profiles))for(let i=0;i<history;i++){
    p.progress.recentVictims['victim-'+i]=at+180000;
    p.progress.absorptionVictims['victim-'+i]=at+180000;
  }
  const batches=Array.from({length:120},(_,round)=>users.flatMap((u,i)=>[
    {profileId:u.profile.id,lifeId:'history-life-'+i,type:'lifeTime',durationSeconds:round+1},
    {profileId:u.profile.id,type:'massPeak',mass:30000+round},
    ...(mixed&&round%10===0?[{profileId:u.profile.id,type:'absorbed',victimProfileId:'rival-'+round,victimDefeated:true,gain:100}]:[])]));
  let expected;
  for(const variant of [0,1,1,0]){
    const store=new stores[variant]({now:()=>at});store.data=baseline;sequence=10000;randomSeed=907;
    let next=baseline,ms=0;
    for(let round=0;round<batches.length;round++){
      const start=performance.now();
      next=store.arenaProgressDraft(next,'history-batch-'+round,batches[round],at+round*1000)?.next||next;
      ms+=performance.now()-start;
    }
    if(expected)assert.deepEqual(next,expected);else expected=next;
    results.push({history,mixed,variant:variant?'selective':'previous',ms,events:batches.flat().length});
  }
  for(const p of Object.values(baseline.profiles))assert.equal(Object.keys(p.progress.recentVictims).length,history);
}
console.log(JSON.stringify({exact:true,scope:'same arena progress batches and final profiles; no disk/socket capacity claim',results}));
