'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const correction=require('../../src/server/clans/trophy-correction-20261122');
const {ProfileJournal,recover,atomicSnapshot}=require('../../src/server/profiles/profile-journal');
function fixture(){
 const trophy={seasonId:correction.ID,awardedAt:correction.END,number:3,league:0,year:2026},old={...trophy,seasonId:'old',awardedAt:correction.START-1000};
 return{version:14,clanQuests:{seasons:[{id:correction.ID,startsAt:correction.START,endsAt:correction.END}]},competition:{lastBattle:{}},
 clans:{one:{id:'one',competition:{trophies:[old,trophy]},battleHistory:[]}},
 profiles:{key:{id:'p',revision:2,wallet:{coins:2000,crystals:100,bucks:50},inventory:{candy:5},receipts:{old:'receipt'},seasonTrophies:[old,trophy],
 clanChests:{notices:[{kind:'reward',at:correction.END,text:'Кубок за 3 сезон Бронзовая 2026. Награда: 1000 монет. Скидка клана: 2%.'}]},activity:{values:{cup_keeper:2}}}}};
}
test('correction removes only verified cups/discount and misleading notice; all currency and rewards remain',()=>{
 const before=fixture(),frozen=structuredClone(before),after=correction.apply(before,correction.END+1);
 assert.deepEqual(before,frozen);assert.equal(after.clans.one.competition.trophies.length,1);assert.equal(after.profiles.key.seasonTrophies.length,1);
 const p=after.profiles.key,b=before.profiles.key;
 for(const field of ['wallet','inventory','receipts','activity'])assert.strictEqual(p[field],b[field]);
 assert.match(p.clanChests.notices[0].text,/награда сохранена/);assert.equal(p.revision,3);
 assert.equal(after.administration.audit.length,1);assert.strictEqual(correction.apply(after,correction.END+2),after);
 require('../../src/server/admin/moderation').validate(after);
});
test('different dates or dated battle evidence prevent broad correction',()=>{
 for(const kind of ['date','battle','lastBattle']){
  const data=fixture();
  if(kind==='date')data.clanQuests.seasons[0].startsAt++;
  if(kind==='battle')data.clans.one.battleHistory.push({endedAt:correction.START+1});
  if(kind==='lastBattle')data.competition.lastBattle.one={endedAt:correction.END,opponent:{id:'other'}};
  assert.strictEqual(correction.apply(data,correction.END+1),data,kind);
 }
});
test('correction is one durable WAL transaction, failed append publishes nothing and replay stays idempotent',async t=>{
 const file=path.join(require('../temp').temporary(t,'trophy-repair'),'profiles.json'),before=fixture();atomicSnapshot(file,before);
 const journal=new ProfileJournal(file),after=correction.apply(journal.previous,correction.END+1),append=journal.append;
 journal.append=()=>{throw Error('simulated fsync failure')};
 assert.throws(()=>journal.commit(after),/fsync/);assert.deepEqual(recover(file).data,before);assert.equal(correction.plan(journal.previous).clans.length,1);
 journal.append=append;journal.commit(after);await journal.close();
 const restored=recover(file).data;assert.equal(restored.administration.audit.length,1);assert.strictEqual(correction.apply(restored,correction.END+2),restored);
 assert.deepEqual(restored.profiles.key.wallet,before.profiles.key.wallet);
});
