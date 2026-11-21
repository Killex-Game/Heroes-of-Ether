"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {EXTRA_ACHIEVEMENTS}=require('../../src/server/progression/activity-achievements');
const start=Date.parse('2026-11-11T12:00:00Z');

test('calendar greatness earned after arena awards still settles the title in the same draft',()=>{
 const store=new ProfileStore({now:()=>start}),a=store.open();store.startLife(a.profile.id,'life');
 const p=store.byId(a.profile.id),fan=EXTRA_ACHIEVEMENTS.find(a=>a.id==='fan');
 p.greatness=99;p.activity.registeredAt=start-fan.thresholds[0]*86400000+1000;
 const before=structuredClone(store.data);
 const next=store.arenaProgressDraft(store.data,'calendar-title',[
  {type:'massPeak',profileId:p.id,mass:100}],start+1000).next;
 const actual=Object.values(next.profiles)[0];
 assert.ok(actual.greatness>=100);assert.equal(actual.honors.claimed,1);
 assert.equal(actual.activity.claimed.fan,1);assert.deepEqual(store.data,before);
});

test('early-returned arena event still repairs legacy missing medals without duplicate rewards',()=>{
 const store=new ProfileStore({now:()=>start}),a=store.open();store.startLife(a.profile.id,'life');
 const p=store.byId(a.profile.id);p.greatness=100;
 const event={type:'massAccrual',profileId:p.id,lifeId:'different-life',sequence:1,xpUnits:0,killUnits:0};
 const first=store.arenaProgressDraft(store.data,'invalid-accrual',[event],start).next;
 const awarded=Object.values(first.profiles)[0];assert.equal(awarded.honors.claimed,1);
 assert.equal(awarded.greatness,100);assert.equal(Object.keys(awarded.honors.medals).length,1);
 const second=store.arenaProgressDraft(first,'invalid-again',[event],start);
 assert.equal(second,null);
});
