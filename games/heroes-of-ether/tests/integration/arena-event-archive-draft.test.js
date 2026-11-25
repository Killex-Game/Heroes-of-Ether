'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{temporary}=require('../temp');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {EventManager}=require('../../src/server/events/event-manager');
const E=require('../../src/server/events/easter-hunt'),L=require('../../src/server/events/lucky-week');
const {recover}=require('../../src/server/profiles/profile-journal');
const accrual=require('../../src/server/arena/mass-accrual');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
async function fixture(t){
 let at=Date.parse('2026-11-24T09:00:00Z'),cleanup;
 const dir=temporary({after:fn=>cleanup=fn},'event-archive-draft'),file=path.join(dir,'profiles.json');
 let store=new ProfileStore({filePath:file,now:()=>at,incrementalSettlement:true});
 t.after(async()=>{await store.close();cleanup();});
 const events=new EventManager({now:()=>at});store.events=events;
 events.apply('fixture','start',{eventId:E.manifest.id,revision:events.data.revision,requestId:randomUUID()});
 const user=store.open(),partner=store.open();
 const p=store.find(user.token),mate=store.find(partner.token);
 p.progress.xp=480;
 p.social={marriage:{partnerId:mate.id,at},invitations:[],gifts:[],inviteReadyAt:0};
 mate.social={marriage:{partnerId:p.id,at},invitations:[],gifts:[],inviteReadyAt:0};
 store.save(store.data);store.startLife(p.id,'fixture-setup-life');
 L.record(store.find(user.token),L.runAt(events,at),'lucky_attempt',1);
 store.find(user.token).easter.runs[E.runAt(events,at).id].multiplierExpiresAt=at+86400000;
 store.save(store.data);
 await store.close();
 store=new ProfileStore({filePath:file,journal:true,now:()=>at,incrementalSettlement:true});store.events=events;
 store.startLife(p.id,'archive-life');
 return {store,user,partner,file,events,start:at,get:()=>store.find(user.token),event:(type,fields={})=>({type,profileId:p.id,lifeId:'archive-life',...fields}),
  at(value){at=value;return at;}};
}
test('passive samples reuse frozen event archives; mixed pickups and life completion preserve exact egg and level rewards',async t=>{
 const f=await fixture(t),before=freeze(f.store.data),saved=structuredClone(before),p=f.get();
 await f.store.applyArenaGroup([{id:'archive-passive',at:f.at(f.start+30000),progress:[
   f.event('massPeak',{mass:20000}),f.event('lifeTime',{durationSeconds:30}),f.event('questSample',{food:8,rank:3}),
   f.event('massAccrual',{ruleVersion:3,sequence:1,xpMultiplier:1,xpUnits:30*accrual.XP_DENOMINATOR,baseXpUnits:30*accrual.XP_DENOMINATOR,killUnits:2*accrual.KILL_DENOMINATOR,spouseOnArena:f.partner.profile.id})]}]);
 assert.equal(f.get().easter,p.easter);assert.equal(f.get().eventAchievements,p.eventAchievements);
 assert.deepEqual(before,saved);assert.equal(f.get().progress.session.xp,20);
 const middle=freeze(f.store.data),middleSaved=structuredClone(middle),run=E.runAt(f.events,f.start);
 const progress=[f.event('easterPickup',{runId:run.id,eggType:0}),f.event('lifeEnded',{durationSeconds:61,reason:'exit'})];
 await f.store.applyArenaGroup([{id:'archive-finish',at:f.at(f.start+61000),progress}]);
 assert.deepEqual(middle,middleSaved);assert.equal(f.get().progress.lastLife.earnedXp,20);
 assert.deepEqual(f.get().easter.runs[run.id].eggs,[3,0,0,0]);
 assert.equal(f.get().easter.runs[run.id].games,1);
 assert.equal(f.get().eventAchievements[L.runAt(f.events,f.start).id].values.lucky_marriage_games,1);
 const ended=structuredClone(f.get());
 await f.store.applyArenaGroup([{id:'archive-finish-repeat',at:f.start+62000,progress:[progress[1]]}]);
 assert.deepEqual(f.get(),ended);assert.deepEqual(recover(f.file).data.profiles,f.store.data.profiles);
});
test('unknown future events retain private archives and a failed mixed batch cannot leak a pickup',async t=>{
 const f=await fixture(t),before=freeze(f.store.data),saved=structuredClone(before),run=E.runAt(f.events,f.start);
 assert.throws(()=>f.store.arenaProgressDraft(before,'archive-invalid',[
   f.event('easterPickup',{runId:run.id,eggType:1}),f.event('massPeak',{mass:-1})],f.start));
 assert.deepEqual(before,saved);assert.equal(f.store.data,before);
 const original=E.progress;
 t.mock.method(E,'progress',(p,manager,event,at)=>{
   original(p,manager,event,at);
   if(event.type==='future-archive-event')p.easter.runs[run.id].futureValue=1;
 });
 await f.store.applyArenaGroup([{id:'archive-future',at:f.start+1000,progress:[f.event('future-archive-event')]}]);
 assert.equal(f.get().easter.runs[run.id].futureValue,1);assert.deepEqual(before,saved);
 assert.deepEqual(recover(f.file).data.profiles,f.store.data.profiles);
});
