"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {ProfileStore}=require("../../src/server/profiles/profile-store");
const calendar=require("../../src/server/progression/social-calendar");
const tables=require("../../src/server/profiles/immutable-table-delta");
const {profileKeys}=require("../../src/server/profiles/profile-index");
const AT=Date.parse("2026-11-11T12:00:00Z"),DAY=86400000;

test("marriage calendar reads current spouse after reusing an identity index",()=>{
 const store=new ProfileStore({now:()=>AT});store.open();store.open();
 const [a,b]=Object.keys(store.data.profiles);
 let world=structuredClone(store.data);
 for(const [key,partner]of [[a,b],[b,a]]){
  const p=world.profiles[key];
  p.social={marriage:{partnerId:world.profiles[partner].id,at:AT-DAY}};
  p.clanId="pair";p.activity.clanId="pair";p.activity.clanSince=AT-DAY;
 }
 world=calendar.settle(world,AT);
 assert.equal(world.profiles[a].activity.values.strong_love,1);
 assert.equal(world.profiles[a].activity.values.always_together,1);
 const saved=structuredClone(world),index=profileKeys(world.profiles);
 const profiles={...world.profiles,[b]:{...world.profiles[b],clanId:null,
  activity:{...world.profiles[b].activity,clanId:null,clanSince:null}}};
 tables.remember(profiles,world.profiles,[b]);
 assert.strictEqual(profileKeys(profiles),index);
 const left=calendar.settle({...world,profiles},AT,[a]);
 assert.equal(left.profiles[a].activity.socialCalendar.togetherKey,null);
 const tomorrow=calendar.settle(left,AT+DAY,[a]);
 assert.equal(tomorrow.profiles[a].activity.values.strong_love,2);
 assert.equal(tomorrow.profiles[a].activity.values.always_together,1);
 const divorced={...tomorrow.profiles,[b]:{...tomorrow.profiles[b],social:{marriage:null}}};
 tables.remember(divorced,tomorrow.profiles,[b]);
 const divorceWorld={...tomorrow,profiles:divorced};
 assert.strictEqual(calendar.settle(divorceWorld,AT+2*DAY,[a]),divorceWorld);
 const removed={...tomorrow.profiles};delete removed[b];
 tables.remember(removed,tomorrow.profiles,[b]);
 const removedWorld={...tomorrow,profiles:removed};
 assert.strictEqual(calendar.settle(removedWorld,AT+2*DAY,[a]),removedWorld);
 const loaded=structuredClone(tomorrow);
 loaded.profiles[b].social.marriage=null;
 assert.strictEqual(calendar.settle(loaded,AT+2*DAY,[a]),loaded);
 assert.deepEqual(world,saved);
});
