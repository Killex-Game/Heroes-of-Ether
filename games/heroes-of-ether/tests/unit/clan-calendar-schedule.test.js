"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const calendar=require('../../public/shared/clan-season-calendar'),admin=require('../../src/server/clans/daily-quests/admin');
const ranking=require('../../src/server/clans/daily-quests/season-ranking'),service=require('../../src/server/clans/daily-quests/service');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{temporary}=require('../temp');
const at=Date.parse('2026-11-22T12:00:00Z'),jan=calendar.season(Date.parse('2027-01-01T12:00:00Z')).start,mar=calendar.season(Date.parse('2027-03-01T12:00:00Z')).start,may=calendar.season(Date.parse('2027-05-01T12:00:00Z')).start;

test('calendar segments preserve historical identities, exact deadlines and separate ordinals',()=>{
 const base=calendar.season(at),schedule=[{start:base.start,mode:'quests',switches:[{at,mode:'battle'},{at:at+1000,mode:'quests'}]}];
 calendar.validateSchedule(schedule);
 const old=calendar.season(at-1,schedule),battle=calendar.season(at,schedule),next=calendar.season(at+1000,schedule);
 assert.equal(old.id,base.id);assert.equal(old.end,at);assert.equal(old.number,3);
 assert.equal(battle.end,at+1000);assert.equal(battle.number,4);
 assert.equal(next.end,base.end);assert.equal(next.number,4);assert.notEqual(next.id,old.id);
 assert.equal(calendar.season(jan,schedule).number,5);assert.equal(calendar.season(mar,schedule).number,5);
 for(const switches of [[{at:base.start,mode:'battle'}],[{at,mode:'quests'}],[{at:base.end,mode:'battle'}]])
   assert.throws(()=>calendar.validateSchedule([{start:base.start,mode:'quests',switches}]),/Invalid/);
});
test('consecutive quest seasons retain distinct ids and ordered numbers without changing historical dates',()=>{
 const schedule=[{start:jan,mode:'quests'}];calendar.validateSchedule(schedule);
 assert.equal(calendar.season(at,schedule).number,3);
 assert.equal(calendar.season(jan,schedule).number,4);assert.equal(calendar.season(mar,schedule).number,5);
 assert.equal(calendar.season(may,schedule).mode,'battle');assert.equal(calendar.season(may,schedule).number,4);
 assert.notEqual(calendar.season(jan,schedule).id,calendar.season(mar,schedule).id);
 for(const bad of [[{start:jan+1,mode:'quests'}],[{start:jan,mode:'bad'}],[...schedule,...schedule],[{start:jan,mode:'quests',extra:true}]])assert.throws(()=>calendar.validateSchedule(bad),/Invalid/);
});
test('owner schedule is durable, versioned, idempotent and cannot change an active or past season',async t=>{
 let cleanup;const file=path.join(temporary({after:fn=>cleanup=fn},'clan-calendar'),'profiles.json');
 const store=new ProfileStore({filePath:file,journal:true,clanDailyQuests:true,now:()=>at});
 t.after(async()=>{await store.journal.close();cleanup();});store.open();
 const owner={id:'owner'},access={isOwner:a=>a.id==='owner'},initial=structuredClone(store.data.profiles),v=admin.view(store);
 const input={action:'schedule',revision:v.revision,requestId:randomUUID(),reason:'Первый период заданий',changes:[{start:jan,mode:'quests'}]};
 const original=store.data,commit=store.journal.commit;store.journal.commit=()=>{throw Error('fsync failure');};
 assert.throws(()=>admin.apply(store,access,owner,input),/fsync failure/);assert.equal(store.data,original);store.journal.commit=commit;
 const saved=admin.apply(store,access,owner,input);assert.equal(saved.upcoming[0].mode,'quests');assert.equal(saved.current.mode,'quests');
 assert.deepEqual(store.data.profiles,initial);assert.equal(admin.apply(store,access,owner,input).replay,true);
 assert.throws(()=>admin.apply(store,access,owner,{...input,requestId:randomUUID()}),/Расписание изменилось/);
 assert.throws(()=>admin.apply(store,access,{id:'moderator'},input),/владелец/);
 for(const start of [calendar.season(at).start,jan-1,calendar.season(at).start-86400000])assert.throws(()=>admin.apply(store,access,owner,{...input,revision:saved.revision,requestId:randomUUID(),changes:[{start,mode:'battle'}]}),/будущие/);
 const recovered=require('../../src/server/profiles/profile-journal').recover(file).data;
 assert.deepEqual(recovered.clanQuests.calendarSchedule,[{start:jan,mode:'quests'}]);service.validate(recovered);
 assert.equal(recovered.administration.audit.filter(e=>e.action==='clanSeason').length,1);assert.equal(saved.upcoming.length,12);
});
test('consecutive quest seasons pay contributors once each and switch to battles on the configured boundary',()=>{
 const seed=new ProfileStore({filePath:null,now:()=>at});seed.open();
 const p=structuredClone(Object.values(seed.data.profiles)[0]);p.id='p';p.clanId='c';
 let data={profiles:{p},clans:{c:{id:'c',name:'Клан',prefix:'К',xp:0,members:['p']}},clanQuests:{calendarVersion:1,calendarActivatedAt:at,nextAt:jan,seasons:[],calendarSchedule:[{start:jan,mode:'quests'}]}};
 const board=start=>[['c',{day:new Date(start+10800000).toISOString().slice(0,10),quests:[{id:'test',completedAt:start+1000}],contributors:{p:{firstAt:start+1000}}}]];
 const before=p.wallet.coins;
 data=ranking.capture(data,jan+2000,board(jan));assert.equal(service.active(data,jan+2000),null);
 data=ranking.capture(data,mar,[]);assert.equal(data.profiles.p.wallet.coins,before+3000);assert.equal(data.clanQuests.questSeason.start,mar);
 data=ranking.capture(JSON.parse(JSON.stringify(data)),mar+2000,board(mar));data=ranking.capture(data,may,[]);ranking.validate(data);
 assert.equal(data.profiles.p.wallet.coins,before+6000);assert.deepEqual(data.profiles.p.clanQuestMedals.map(m=>m.number),[4,5]);
 assert.equal(service.active(data,may).mode,'battle');assert.deepEqual(ranking.capture(data,may+1,[]).profiles,data.profiles);
});
