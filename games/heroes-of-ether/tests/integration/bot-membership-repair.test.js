"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),{prepareBronzePopulation}=require("../../src/server/testing/bronze-population");
const repair=require("../../src/server/testing/bot-membership-repair"),{MARKER,assignBotGender}=require("../../src/server/testing/bot-identity");
const {freshProgress}=require("../../src/server/progression/experience-progression"),{temporary}=require("../temp");
const {ProfileJournal,recover}=require("../../src/server/profiles/profile-journal");
const at=Date.parse("2026-11-15T03:00:00Z");
function fixture(){
 const store=new ProfileStore({now:()=>at}),human=store.open();
 const data=prepareBronzePopulation(store.data,at-86400000,2).data;
 const clans=Object.values(data.clans),bots=Object.values(data.profiles).filter(p=>p.testBot===MARKER);
 for(const p of bots){delete p.testIdentityVersion;p.personal.gender="unspecified";}
 const low=[bots.find(p=>p.id===clans[0].ownerId),bots.find(p=>p.clanId===clans[1].id&&p.id!==clans[1].ownerId)];
 for(const p of low){p.level=5;p.progress=freshProgress(5);}
 const engine=require("../../src/server/clans/daily-quests/engine"),catalog=require("../../src/server/clans/daily-quests/catalog.json");
 for(const clan of clans)clan.dailyQuests={board:engine.createBoard(clan.id,catalog,at,Object.fromEntries(clan.members.map(id=>[id,at-86400000])))};
 return{data,human,low,clans};
}
test("offline repair removes only underlevel test members, preserves earned data, transfers head, repeats without changes",()=>{
 const f=fixture(),old=structuredClone(f.data),r=repair.prepare(f.data,at);
 assert.deepEqual(f.data,old);assert.deepEqual(r.summary,{assignedGenders:20,removedUnderlevelMembers:2,affectedClans:2});
 for(const p of Object.values(r.data.profiles)){
  const before=Object.values(old.profiles).find(x=>x.id===p.id);
  assert.deepEqual(p.wallet,before.wallet);assert.deepEqual(p.progress,before.progress);assert.equal(p.greatness,before.greatness);
  if(p.testBot===MARKER)assert(["male","female"].includes(p.personal.gender));
  assert(!p.clanId||p.level>=12);
 }
 for(const p of f.low){const clan=r.data.clans[p.clanId];assert(!clan.members.includes(p.id));assert(!Object.hasOwn(clan.roles,p.id));assert(!Object.hasOwn(clan.dailyQuests.board.eligible,p.id));}
 assert.notEqual(r.data.clans[f.clans[0].id].ownerId,f.clans[0].ownerId);
 const replay=repair.prepare(r.data,at+1);assert.deepEqual(replay.data,r.data);assert.equal(replay.summary.assignedGenders,0);
 assert.throws(()=>assignBotGender(Object.values(f.data.profiles).find(p=>p.id===f.human.profile.id)),/test marker/);
 const damaged=structuredClone(r.data);Object.values(damaged.profiles).find(p=>p.id===f.human.profile.id).wallet.coins++;
 assert.throws(()=>repair.assertOnlyRepair(f.data,damaged),/Human profiles/);
});
test("repair survives journal recovery, failed fsync publishes nothing and refuses an orphaned head",async t=>{
 const f=fixture(),result=repair.prepare(f.data,at),file=path.join(temporary(t,"bot-repair"),"profiles.json");
 fs.writeFileSync(file,JSON.stringify(f.data));const journal=new ProfileJournal(file);
 try{
  const original=fs.fsyncSync;let failed=false;
  const sync=t.mock.method(fs,"fsyncSync",fd=>{if(fd===journal.fd&&!failed){failed=true;throw Error("repair fsync failure");}return original(fd);});
  assert.throws(()=>journal.commit(result.data),/fsync failure/);sync.mock.restore();
  assert.deepEqual(recover(file).data,f.data);
  journal.commit(result.data);repair.assertOnlyRepair(f.data,recover(file).data);
 }finally{await journal.close();}
 const clan=f.clans[0];for(const p of Object.values(f.data.profiles))if(p.clanId===clan.id){p.level=5;p.progress=freshProgress(5);}
 assert.throws(()=>repair.prepare(f.data,at),/eligible successor/);
});
test("new beginner sandbox profiles are clanless; gender stays stable",()=>{
 const f=fixture(),seed=require("../../src/server/testing/sandbox-population").prepareSandboxPopulation(f.data,at);
 assert.equal(seed.added,2);
 for(const session of seed.sessions){const p=Object.values(seed.data.profiles).find(p=>p.id===session.id);assert(p.level<12);assert.equal(p.clanId,null);const before=p.personal.gender;assert.equal(assignBotGender(p),false);assert.equal(p.personal.gender,before);}
 assert.deepEqual(seed.data.clans,f.data.clans);
});
