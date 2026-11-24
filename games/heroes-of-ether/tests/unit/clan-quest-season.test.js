"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const calendar=require('../../public/shared/clan-season-calendar');
const season=require('../../src/server/clans/daily-quests/season-ranking');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const start=Date.parse('2026-10-31T21:00:00Z'),end=Date.parse('2026-12-31T21:00:00Z');
function fixture(count=1){
  const store=new ProfileStore({filePath:null,now:()=>start+3600000});
  const seed=store.open().profile,profiles={},clans={},boards=[];
  for(let i=0;i<count;i++){
    const id='c'+String(i).padStart(2,'0'),pid='p'+i,p=structuredClone(store.find(seed.token)||Object.values(store.data.profiles)[0]);
    p.id=pid;p.clanId=id;p.account={...p.account,vipUntil:end+86400000,premiumUntil:end+86400000};
    profiles[pid]=p;clans[id]={id,name:id,prefix:id,xp:0,members:[pid]};
    boards.push([id,{day:'2026-11-01',contributors:{[pid]:{firstAt:start+1000+i}},quests:[{id:'cq_1',completedAt:start+1000+i}]}]);
  }
  return {profiles,clans,boards,clanQuests:{calendarVersion:1,calendarActivatedAt:start,nextAt:end,seasons:[]}};
}
test('two-month calendar alternates through year and leap February; daily window is 07–22',()=>{
  for(let month=0;month<12;month++){
    const s=calendar.season(Date.UTC(2028,month,15)),block=Math.floor(month/2);
    assert.equal(s.mode,block%2?'quests':'battle');
    assert.equal(s.start,Date.UTC(2028,block*2,1)-10800000);
    assert.equal(s.end,Date.UTC(2028,block*2+2,1)-10800000);
  }
  const d=calendar.daily(Date.parse('2026-11-22T12:00:00Z'));
  assert.equal(d.start,Date.parse('2026-11-22T04:00:00Z'));
  assert.equal(d.end,Date.parse('2026-11-22T19:00:00Z'));
});
test('all five prize tiers, 30th boundary, fixed rewards despite Premium, no rewards for zero',()=>{
  const f=fixture(32),before=structuredClone(f.profiles);
  f.boards[31][1].quests=[];
  const counted=season.capture(f,start+86400000,f.boards);
  const paid=season.capture(counted,end,[]);
  season.validate(paid);
  for(let i=0;i<32;i++){
    const p=paid.profiles['p'+i],prize=calendar.questPrize(i+1);
    if(i<30){
      assert.equal(p.clanQuestMedals[0].tier,prize.id);
      for(const key of ['coins','crystals','bucks']) assert.equal(p.wallet[key]-before[p.id].wallet[key],prize.reward[key]);
    }else assert.deepEqual(p,before[p.id]);
  }
  assert.equal(paid.clanQuests.questSeasonHistory[counted.clanQuests.questSeason.id].recipients.length,30);
  assert.deepEqual(season.capture(paid,end+1,[]).profiles,paid.profiles);
});
test('counts every completed task once across boards, receipts, days, and restarts',()=>{
  const f=fixture();
  f.clanQuestRewards={r:{clanId:'c00',day:'2026-11-01',quests:f.boards[0][1].quests}};
  let d=season.capture(f,start+86400000,f.boards);
  assert.equal(d.clanQuests.questSeason.scores.c00.completed,1);
  d=season.capture(structuredClone(d),start+2*86400000,[['c00',{day:'2026-11-02',quests:[{id:'cq_1',completedAt:start+86400000}]}]]);
  assert.equal(d.clanQuests.questSeason.scores.c00.completed,2);
  const paid=season.capture(d,end,[]),restored=structuredClone(paid);
  assert.deepEqual(season.capture(restored,end+86400000,[]),restored);
});
test('passive members and departed contributors receive no season prize',()=>{
  const f=fixture(),extra=structuredClone(f.profiles.p0);extra.id='new-member';
  f.profiles[extra.id]=extra;
  let d=season.capture(f,start+86400000,f.boards);
  d.clans.c00.members=[extra.id];d.profiles.p0.clanId=null;
  const paid=season.capture(d,end,[]);
  assert(!paid.profiles.p0.clanQuestMedals);
  assert(!paid.profiles[extra.id].clanQuestMedals);
  assert.deepEqual(paid.profiles[extra.id].wallet,extra.wallet);
});
test('pending arena progress defers settlement; delayed final task gets counted before exactly one payout',()=>{
  const f=fixture(),d=season.capture(f,start+86400000,[]);
  const pending=season.capture(d,end,[],{canSettle:false});
  assert(!pending.clanQuests.questSeason.settledAt);
  assert.equal(pending.clanQuests.nextAt,end);
  const paid=season.capture(pending,end+1,f.boards);
  assert.equal(paid.profiles.p0.clanQuestMedals[0].completed,1);
  assert.deepEqual(season.capture(paid,end+2,f.boards).profiles,paid.profiles);
});
test('backfill respects current season; missed seasons are never invented',()=>{
  const f=fixture();f.clanQuestRewards={old:{clanId:'c00',day:'2026-07-01',quests:[{id:'cq_1',completedAt:Date.parse('2026-07-01T05:00:00Z')}]}};
  const d=season.capture(f,start+86400000,[]);
  assert.equal(season.rows(d,d.clanQuests.questSeason)[0].completed,0);
  const jump=season.capture(d,Date.parse('2027-07-15T05:00:00Z'),[]);
  assert.equal(jump.clanQuests.questSeason.id,'clan-quests-2027-07');
  assert.equal(Object.keys(jump.clanQuests.questSeasonHistory).length,1);
  assert.deepEqual(jump.profiles,f.profiles);
});

test('rejects corrupt archived rewards and invalid or duplicate personal medals',()=>{
 const f=fixture(),paid=season.capture(season.capture(f,start+86400000,f.boards),end,[]);
 for(const mutate of [d=>{d.profiles.p0.clanQuestMedals[0].awardedAt++},d=>{d.profiles.p0.clanQuestMedals.push(d.profiles.p0.clanQuestMedals[0])},d=>{d.clanQuests.questSeasonHistory.bad=d.clanQuests.questSeasonHistory[d.clanQuests.questSeason.id]},d=>{d.clanQuests.questSeason.number++}]){
  const bad=structuredClone(paid);mutate(bad);assert.throws(()=>season.validate(bad),/Invalid/);
 }
 season.validate(paid);
});

test('both quest and battle opening is 07:00, dates include the final season day in every timezone',()=>{
 const at=Date.parse('2026-11-22T12:00:00Z'),q=calendar.daily(at,'quests'),b=calendar.daily(at,'battle');
 assert.equal(q.start,Date.parse('2026-11-22T04:00:00Z'));assert.equal(q.end,b.end);
 assert.equal(b.start-q.start,0);
 const cp=require('node:child_process'),file=require.resolve('../../public/shared/clan-season-calendar');
 for(const tz of ['UTC','Asia/Yekaterinburg','America/Los_Angeles','Pacific/Kiritimati']){
  const result=JSON.parse(cp.execFileSync(process.execPath,['-e','const c=require('+JSON.stringify(file)+');console.log(JSON.stringify({dates:c.seasonRange(c.season('+at+')),hours:c.localRange('+at+',"quests")}))'],{encoding:'utf8',env:{...process.env,TZ:tz}}));
  assert.equal(result.dates,'01.11.2026 - 31.12.2026');
  if(tz==='Asia/Yekaterinburg')assert.equal(result.hours,'09:00 - 00:00');
 }
 assert.equal(calendar.seasonRange(calendar.season(Date.parse('2028-02-10T12:00:00Z'))),'01.01.2028 - 29.02.2028');
});
test('contribution to an unfinished task qualifies, saved across days and restart, only in its own clan and season',()=>{
 const f=fixture(2),base=structuredClone(f.profiles.p0),b=f.boards[0][1];
 f.profiles.late={...structuredClone(base),id:'late'};f.clans.c00.members.push('late');
 f.profiles.wrong={...structuredClone(base),id:'wrong',clanId:'c01'};f.clans.c00.members.push('wrong');
 b.contributors.wrong={firstAt:start+2000};b.contributors.stale={firstAt:start-1};b.contributors.future={firstAt:end};
 let d=season.capture(f,start+86400000,f.boards);
 d=season.capture(structuredClone(d),start+2*86400000,[['c00',{day:'2026-11-02',quests:[{id:'unfinished',completedAt:null}],contributors:{late:{firstAt:start+86401000}}}]]);
 const p=season.capture(d,end,[]);season.validate(p);
 assert.equal(p.profiles.late.clanQuestMedals.length,1);assert(!p.profiles.wrong.clanQuestMedals);
 assert.deepEqual(p.clanQuests.questSeason.contributors.c00,['late','p0','wrong']);
 assert.deepEqual(season.capture(structuredClone(p),end+1000,[]),p);
});
test('old season state backfills only proven contributors from retained daily receipts and current boards',()=>{
 const f=fixture(),d=season.capture(f,start+86400000,f.boards),state=d.clanQuests.questSeason;
 delete state.contributorVersion;delete state.contributors;
 for(const id of ['receipt-member','passive','old-receipt']){d.profiles[id]={...structuredClone(f.profiles.p0),id};d.clans.c00.members.push(id);}
 d.clanQuestRewards={a:{clanId:'c00',earnedAt:start+20*3600000,members:['receipt-member'],quests:[],day:'2026-11-01'},old:{clanId:'c00',earnedAt:start-1,members:['old-receipt'],quests:[],day:'2026-10-31'}};
 const upgraded=season.capture(d,start+2*86400000,f.boards);season.validate(upgraded);
 const paid=season.capture(upgraded,end,[]);
 assert(paid.profiles['receipt-member'].clanQuestMedals);assert(paid.profiles.p0.clanQuestMedals);
 assert(!paid.profiles.passive.clanQuestMedals);assert(!paid.profiles['old-receipt'].clanQuestMedals);
 assert.equal(state.contributorVersion,undefined,'migration is immutable');
 for(const mutate of [x=>x.contributorVersion=2,x=>x.contributors={c00:['p0','p0']},x=>x.contributors={c00:['__proto__']},x=>x.contributors=[]]){const bad=structuredClone(upgraded);mutate(bad.clanQuests.questSeason);assert.throws(()=>season.validate(bad),/Invalid/);}
});
