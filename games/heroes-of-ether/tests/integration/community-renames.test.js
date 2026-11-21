'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{prepareBronzePopulation}=require('../../src/server/testing/bronze-population');
const {renamePopulation,assertOnlyRenames}=require('../../src/server/testing/population-names');
const {ProfileJournal,atomicSnapshot,recover}=require('../../src/server/profiles/profile-journal'),{temporary}=require('../temp');
test('rename skips human names/prefixes, preserves all progress/history and is durable/idempotent',async t=>{
 const store=new ProfileStore(),human=store.open();store.find(human.token).name='Ёжик';
 const seed=prepareBronzePopulation(store.data),clan=Object.values(seed.data.clans)[0];delete clan.testOnly;clan.prefix='X';clan.name='Икс-Фактор';
 const before=structuredClone(seed.data),named=renamePopulation(seed.data);
 assert.deepEqual(seed.data,before);assert.equal(named.renamedBots,1280);assert.equal(named.renamedClans,127);
 assertOnlyRenames(before,named.data);assert.deepEqual(named.data.clans[clan.id],clan);
 assert(!named.botChanges.some(p=>p.after==='Ёжик'));assert(!named.clanChanges.some(c=>c.prefix==='X'));
 const damaged=structuredClone(named.data);Object.values(damaged.profiles)[0].wallet.coins++;assert.throws(()=>assertOnlyRenames(before,damaged));
 const file=path.join(temporary(t,'community-rename'),'profiles.json');atomicSnapshot(file,before);
 const journal=new ProfileJournal(file);journal.commit(named.data);await journal.close();
 const restored=recover(file).data;assertOnlyRenames(before,restored);assert.deepEqual(renamePopulation(restored).data,restored);
});
test('failed rename fsync leaves old names and progress recoverable',async t=>{
 const store=new ProfileStore();store.open();const before=prepareBronzePopulation(store.data).data,named=renamePopulation(before);
 const file=path.join(temporary(t,'community-rename-failure'),'profiles.json');atomicSnapshot(file,before);const journal=new ProfileJournal(file);
 const sync=fs.fsyncSync;let fail=true;fs.fsyncSync=function(fd){if(fd===journal.fd&&fail){fail=false;throw Error('Injected fsync failure');}return sync(fd);};
 try{assert.throws(()=>journal.commit(named.data),/Injected/);}finally{fs.fsyncSync=sync;await journal.close();}
 assert.deepEqual(recover(file).data,before);
});
