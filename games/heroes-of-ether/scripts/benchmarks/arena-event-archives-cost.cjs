'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let sequence=0,randomSeed=907;
crypto.randomUUID=()=>`00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12,'0')}`;
crypto.randomInt=(min,max)=>{if(max===undefined){max=min;min=0;}randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return min+Math.floor(randomSeed/4294967296*(max-min));};
const file=require.resolve('../../src/server/profiles/profile-store'),old=new Module(file,module);
old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));old._compile(fs.readFileSync(process.env.BASELINE_STORE,'utf8'),file);
const stores=[old.exports.ProfileStore,require(file).ProfileStore],{EventManager}=require('../../src/server/events/event-manager');
const E=require('../../src/server/events/easter-hunt'),L=require('../../src/server/events/lucky-week');
const at=Date.parse('2026-11-24T09:00:00Z'),seed=new stores[1]({now:()=>at}),events=new EventManager({now:()=>at});seed.events=events;
events.apply('fixture','start',{eventId:E.manifest.id,revision:events.data.revision,requestId:crypto.randomUUID()});
const users=Array.from({length:30},()=>seed.open()),run=E.runAt(events,at);
for(const [i,u]of users.entries()){seed.startLife(u.profile.id,'archive-life-'+i);L.record(seed.find(u.token),L.runAt(events,at),'lucky_attempt',1);}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
const results=[];
for(const archives of [0,4,16])for(const mixed of [false,true]){
 const baseline=structuredClone(seed.data);
 for(const p of Object.values(baseline.profiles))for(let i=0;i<archives;i++){
  const copy=structuredClone(p.easter.runs[run.id]);delete copy.life;
  copy.lives=Object.fromEntries(Array.from({length:64},(_,j)=>['historical-life-'+j,at-j*60000]));
  p.easter.runs['historical-run-'+i]=copy;
  p.eventAchievements['historical-run-'+i]={values:{lucky_attempt:200,lucky_marriage_games:4},claimed:{},stageSpent:{}};
 }
 freeze(baseline);let expected;
 for(const variant of [0,1,1,0]){
  const store=new stores[variant]({now:()=>at});store.events=events;store.data=baseline;sequence=10000;randomSeed=907;
  let next=baseline,ms=0,eventCount=0;
  for(let round=0;round<120;round++){
   const batch=users.flatMap((u,i)=>[
    {profileId:u.profile.id,lifeId:'archive-life-'+i,type:'lifeTime',durationSeconds:round+1},
    {profileId:u.profile.id,type:'massPeak',mass:10000+round},
    ...(mixed&&round%15===0?[{profileId:u.profile.id,lifeId:'archive-life-'+i,type:'easterPickup',runId:run.id,eggType:round%4}]:[]),
    ...(mixed&&round===119?[{profileId:u.profile.id,lifeId:'archive-life-'+i,type:'lifeEnded',durationSeconds:120,reason:'exit'}]:[])]);
   const start=performance.now();next=store.arenaProgressDraft(next,'archive-batch-'+round,batch,at+round*1000)?.next||next;ms+=performance.now()-start;eventCount+=batch.length;
  }
  if(expected)assert.deepEqual(next,expected);else expected=next;
  results.push({archives,mixed,variant:variant?'shared-passive-archives':'previous',ms,events:eventCount});
 }
}
console.log(JSON.stringify({exact:true,scope:'Identical 30-profile draft batches including pickups/life completion; frozen prior worlds. No disk, PostgreSQL, network, FPS or capacity claim.',results}));
