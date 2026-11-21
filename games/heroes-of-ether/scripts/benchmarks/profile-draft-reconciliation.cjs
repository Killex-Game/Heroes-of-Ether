"use strict";
// Compare complete progress drafts, not isolated helper-call timings.
const fs=require('node:fs'), path=require('node:path'), Module=require('node:module');
const assert=require('node:assert/strict'), crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
let serial=0,randomState=1;
const uuid=crypto.randomUUID,random=Math.random,randomInt=crypto.randomInt;
const seeded=()=>((randomState=(Math.imul(randomState,1664525)+1013904223)>>>0)/4294967296);
crypto.randomUUID=()=>`00000000-0000-4000-8000-${(++serial).toString(16).padStart(12,'0')}`;
crypto.randomInt=(min,max)=>max===undefined?Math.floor(seeded()*min):min+Math.floor(seeded()*(max-min));
Math.random=seeded;
const file=require.resolve('../../src/server/profiles/profile-store');
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
const originalRequire=old.require.bind(old);
old.require=id=>id==='./arena-profile-copy'?require(path.resolve(process.env.BASELINE_COPY)):originalRequire(id);
old._compile(fs.readFileSync(process.env.BASELINE_STORE,'utf8'),file);
const {ProfileStore}=require(file), {EventManager}=require('../../src/server/events/event-manager');
const start=Date.parse('2026-11-11T20:59:00Z');
const seed=new ProfileStore({now:()=>start}), ids=[];
seed.events=new EventManager({now:()=>start});
seed.events.apply('fixture','start',{eventId:'black-friday',requestId:'draft-micro-start-001',revision:seed.events.data.revision});
for(let i=0;i<35;i++){
 const a=seed.open();ids.push(a.profile.id);seed.startLife(a.profile.id,'life-'+i);
 const p=seed.byId(a.profile.id);p.greatness=99;
 p.activity.registeredAt=start-15*86400000+30000;
 // Keep the full production quest/calendar path; deterministic RNG below
 // makes chest IDs and reward choices comparable across both variants.
}
const baseline=structuredClone(seed.data), original=JSON.stringify(baseline), samples=[[],[]],totals=[0,0];
const methods=[old.exports.ProfileStore.prototype.arenaProgressDraft,ProfileStore.prototype.arenaProgressDraft];
const stores=[new ProfileStore({now:()=>start}),new ProfileStore({now:()=>start})];
for(const s of stores){s.events=seed.events;s.data=baseline;}
try{
 for(let round=0;round<240;round++){
  const at=start+round*500,events=ids.flatMap((profileId,i)=>{
   const common={profileId,lifeId:'life-'+i};
   return [{...common,type:'massPeak',mass:1000+round*110+i},
    {...common,type:'lifeTime',durationSeconds:Math.floor(round/2)},
    {...common,type:'questSample',food:round*8,rank:1+i},
    ...(round%4?[]:[{...common,type:'arenaAction',metric:'rocketHits',sequence:round+1,targetProfileId:'target-'+round}]),
    ...(round%7?[]:[{...common,type:'absorbed',lifeId:'victim-life-'+round,victimProfileId:'victim-'+round,
      victimPartId:'part-'+i,gain:150,victimDefeated:true,eaterLifeId:common.lifeId,absorptionSequence:round+1}])];
  });
  const results=[];
  for(let j=0;j<2;j++){
   const k=(round+j)%2;serial=round*10000;randomState=round+1;
   const t=performance.now();results[k]=methods[k].call(stores[k],stores[k].data,'round-'+round,events,at);
   const ms=performance.now()-t;if(round>=20){totals[k]+=ms;samples[k].push(ms);}
   if(results[k])stores[k].data=results[k].next;
  }
  assert.deepEqual(results[0],results[1]);
 }
 assert.equal(JSON.stringify(baseline),original);
 console.log(JSON.stringify({exact:true,rounds:240,events:'mass, time, quests, rocket hits, absorptions, midnight',
  variants:totals.map((ms,i)=>({name:i?'after':'before',ms,p95:samples[i].sort((a,b)=>a-b)[Math.floor(samples[i].length*.95)]}))}));
}finally{crypto.randomUUID=uuid;Math.random=random;crypto.randomInt=randomInt;}
