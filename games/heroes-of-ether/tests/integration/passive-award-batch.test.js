"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {ProfileStore}=require("../../src/server/profiles/profile-store");
const activity=require("../../src/server/progression/activity-achievements");
const at=Date.parse("2026-11-15T09:00:00Z");
function freeze(value){if(!value || typeof value!=="object" || Object.isFrozen(value))return;Object.freeze(value);for(const child of Object.values(value))freeze(child);}
test("private passive batches agree with full award scans across hour/day/degree boundaries and mixed events",async()=>{
 const store=new ProfileStore({now:()=>at,incrementalSettlement:true});
 const begin=activity.beginPassiveArenaBatch;
 try {
  const auth=store.open(),id=auth.profile.id;store.startLife(id,"award-life");
  const p=store.byId(id);p.greatness=95;p.activity.registeredAt=at-14*activity.DAY;
  p.activity.arenaSeconds=24*3600-2;
  for(const d of activity.EXTRA_ACHIEVEMENTS)if(!d.unavailable && !d.id.startsWith("league_"))
   p.activity.values[d.id]=Math.max(p.activity.values[d.id],d.thresholds[0]-1);
  const base=structuredClone(store.data),saved=structuredClone(base);freeze(base);
  const batches=Array.from({length:160},(_,n)=>[
   {type:"massPeak",profileId:id,mass:100+n},
   {type:"questSample",profileId:id,lifeId:"award-life",food:n,clanFood:n,rank:1},
   {type:"lifeTime",profileId:id,lifeId:"award-life",durationSeconds:n+1},
   ...(n%7===0?[{type:"arenaAction",profileId:id,lifeId:"award-life",sequence:n+1,metric:"boosterUses",boosterId:"shield"}]:[]),
   {type:"clanArenaAction",profileId:id,lifeId:"award-life",sequence:n+1,metric:"splitParts",amount:2},
   {type:"boosterUsed",profileId:id,lifeId:"award-life",mass:100+n},
   ...(n%17===0?[{type:"absorbed",profileId:id,victimProfileId:"victim-"+n,lifeId:"victim-life-"+n,gain:5,victimDefeated:true,spaceSplit:true}]:[]),
  ]);
  let expected;
  for(const enabled of [false,true]){
   activity.beginPassiveArenaBatch=enabled?begin:()=>{};
   let world=base;
   for(let n=0;n<batches.length;n++)world=store.arenaProgressDraft(world,"batch-"+n,batches[n],at+n*activity.DAY)?.next || world;
   if(expected)assert.deepEqual(world,expected);else expected=world;
   assert.deepEqual(base,saved,"all prior fields remain unchanged");
  }
 }finally{activity.beginPassiveArenaBatch=begin;await store.close();}
});
test("a completed private batch leaves ordinary in-place achievement mutations fully evaluated",async()=>{
 const store=new ProfileStore({now:()=>at,incrementalSettlement:true});
 try{
  const auth=store.open(),id=auth.profile.id;store.startLife(id,"award-later");
  const world=store.arenaProgressDraft(store.data,"batch",[
   {type:"massPeak",profileId:id,mass:21},
   {type:"lifeTime",profileId:id,lifeId:"award-later",durationSeconds:1},
  ],at+1000).next;
  const p=store.byId(id,world),definition=activity.EXTRA_ACHIEVEMENTS.find(d=>d.id==="sociable");
  const claimed=p.activity.claimed.sociable;
  p.activity.values.sociable=definition.thresholds[claimed]+(p.activity.stageSpent.sociable || 0);
  activity.awardExtra(p,at+1001);
  assert.equal(p.activity.claimed.sociable,claimed+1);
 }finally{await store.close();}
});
