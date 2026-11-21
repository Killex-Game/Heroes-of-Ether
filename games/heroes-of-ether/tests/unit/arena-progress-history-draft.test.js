"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function fixture(){
  const at=Date.parse('2026-11-12T12:00:00Z'),store=new ProfileStore({now:()=>at});
  const user=store.open();store.startLife(user.profile.id,'history-life');
  const p=store.find(user.token);
  p.progress.recentVictims={expired:at-1,active:at+60000};
  p.progress.absorptionVictims={expired:at-1,active:at+60000};
  const base=freeze(store.data),original=structuredClone(base);
  const event=e=>({profileId:p.id,lifeId:'history-life',...e});
  return {at,store,user,p,base,original,event};
}
test('mass and time samples retain immutable victim histories without changing expiry semantics',()=>{
  const f=fixture();
  const result=f.store.arenaProgressDraft(f.base,'sample-history',[
    f.event({type:'massPeak',mass:30000}),f.event({type:'lifeTime',durationSeconds:20})],f.at).next;
  const p=f.store.find(f.user.token,result);
  assert.equal(p.progress.maxMass,30000);
  for(const field of ['recentVictims','absorptionVictims'])assert.strictEqual(p.progress[field],f.p.progress[field]);
  assert.notStrictEqual(p.progress.session,f.p.progress.session);
  assert.deepEqual(f.base,f.original);
});
test('first absorption detaches histories; repeats, pruning and failed batches leave the base intact',()=>{
  const f=fixture(),hit=id=>f.event({type:'absorbed',victimProfileId:id,victimDefeated:true,gain:100});
  const events=[f.event({type:'lifeTime',durationSeconds:20}),hit('one'),hit('one'),hit('active'),hit('two')];
  const result=f.store.arenaProgressDraft(f.base,'absorb-history',events,f.at).next;
  const p=f.store.find(f.user.token,result);
  assert.equal(p.progress.absorptionKills,2);assert.equal(p.progress.absorbedMass,200);
  for(const field of ['recentVictims','absorptionVictims']){
    assert.notStrictEqual(p.progress[field],f.p.progress[field]);
    assert.deepEqual(p.progress[field],{active:f.at+60000,one:f.at+180000,two:f.at+180000});
  }
  assert.deepEqual(f.base,f.original);
  assert.throws(()=>f.store.arenaProgressDraft(f.base,'bad-history',[...events,f.event({type:'massPeak',mass:-1})],f.at));
  assert.strictEqual(f.store.data,f.base);assert.deepEqual(f.base,f.original);
});
