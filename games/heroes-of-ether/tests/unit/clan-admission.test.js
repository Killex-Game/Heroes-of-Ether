"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {prepareBronzePopulation}=require('../../src/server/testing/bronze-population');
const comp=require('../../src/server/clans/clan-competition-service');
const {prepareBattlePopulation}=require('../../src/server/testing/battle-population');
const at=Date.parse('2026-11-16T04:59:00Z'),start=at+60000;
function fixture(){return prepareBronzePopulation(new ProfileStore().data,at,12).data;}
function leave(d,c){const id=c.members.pop();delete c.roles[id];const p=Object.values(d.profiles).find(p=>p.id===id);p.clanId=null;return id;}

test('offline population fills an explicitly included human clan only and preserves existing profiles',()=>{
 const d=fixture(),[included,untouched]=Object.values(d.clans);
 delete included.testOnly;delete untouched.testOnly;
 while(included.members.length>1)leave(d,included);
 while(untouched.members.length>1)leave(d,untouched);
 const before=structuredClone(d),result=prepareBattlePopulation(d,at,{includeClanIds:[included.id]});
 assert.deepEqual(d,before);
 assert.equal(result.added,9);assert.equal(result.data.clans[included.id].members.length,10);
 assert.deepEqual(result.data.clans[untouched.id],untouched);
 for(const [key,p] of Object.entries(d.profiles))assert.deepEqual(result.data.profiles[key],p);
 const repeat=prepareBattlePopulation(result.data,at,{includeClanIds:[included.id]});
 assert.equal(repeat.added,0);assert.deepEqual(repeat.data,result.data);
});
test('9 participants cannot enter; 10 participants can, including after a weekly group is formed',()=>{
 const d=fixture(),c=Object.values(d.clans)[0];leave(d,c);assert.equal(comp.canEnterBattle(c),false);
 comp.advance(d,start,n=>n-1);assert.ok(!d.competition.day.pairs.some(p=>p.a===c.id||p.b===c.id));
 assert.ok(d.competition.day.pairs.length>=5);
});
test('departure during battle does not cancel it, but prevents the next battle',()=>{
 const d=fixture();comp.advance(d,start,n=>n-1);const pair=d.competition.day.pairs[0],c=d.clans[pair.a];
 leave(d,c);comp.advance(d,start+1000,n=>n-1);assert.ok(d.competition.day.pairs.some(p=>p.a===c.id||p.b===c.id));
 comp.advance(d,Date.parse('2026-11-16T21:00:00Z'),n=>n-1);assert.ok(d.competition.lastBattle[c.id]);
 comp.advance(d,start+86400000,n=>n-1);assert.ok(!d.competition.day.pairs.some(p=>p.a===c.id||p.b===c.id));
});
