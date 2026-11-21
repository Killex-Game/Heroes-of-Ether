'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {validateActivity,EXTRA_ACHIEVEMENTS}=require('../../src/server/progression/activity-achievements');
function base(){
 const store=new ProfileStore({now:()=>1794700000000}),auth=store.open();
 store.startLife(auth.profile.id,'validation-life');return store.byId(auth.profile.id);
}
function draft(p){return {...p,activity:{...p.activity},progress:{...p.progress,session:{...p.progress.session}}};}
function result(p,previous){try{validateActivity(p,previous);return 'valid';}catch(e){return e.message;}}
test('reconciled activity validation agrees with full checks for changed and shared fields',()=>{
 const p=base();validateActivity(p);const saved=structuredClone(p);
 const edits=[
  q=>q.activity.arenaSeconds++,q=>q.progress.session.activitySeconds=2,
  q=>q.activity.achievementStagesVersion=99,q=>q.activity.marriageProgressVersion=99,
  q=>q.activity.chatAccepted=-1,q=>q.activity.registeredAt=NaN,
  q=>q.activity.arenaSeconds=-1,q=>q.activity.lastVisitDay='bad',
  q=>q.activity.clanId=5,q=>{q.activity.clanId=null;q.activity.clanSince=1;},
  q=>q.activity.clanLives={bad:-1},q=>q.activity.clanLives=[],
  q=>q.activity.leagueVisits=['bronze','bronze'],q=>q.activity.leagueVisits=['unknown'],
  q=>q.activity.socialCalendar={day:1,loveThrough:-1,togetherThrough:null,loveKey:null,togetherKey:null},
  q=>q.eventAchievements={bad:{pack:'unknown'}},q=>q.progress.session.activitySeconds=-1,
  q=>q.progress.session.activityClan=123,
 ];
 for(const d of EXTRA_ACHIEVEMENTS){
  edits.push(q=>q.activity.values={...q.activity.values,[d.id]:-1});
  edits.push(q=>q.activity.claimed={...q.activity.claimed,[d.id]:d.thresholds.length+1});
  edits.push(q=>q.activity.stageSpent={...q.activity.stageSpent,[d.id]:-1});
 }
 for(const edit of edits){const q=draft(p);edit(q);assert.equal(result(q,p),result(q),String(edit));}
 assert.deepEqual(p,saved,'validation never changes the published profile');
});
test('changed session still fails when the entire activity object is shared',()=>{
 const p=base(),q={...p,progress:{...p.progress,session:{...p.progress.session,activitySeconds:Infinity}}};
 assert.throws(()=>validateActivity(q,p),/времени жизни/);
});
test('ordinary callers and accidental self-comparison retain full validation',()=>{
 const p=base();p.activity.values.fan=-1;
 assert.throws(()=>validateActivity(p),/достижения/);
 assert.throws(()=>validateActivity(p,p),/достижения/);
});
