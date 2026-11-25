'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {temporary}=require('../temp');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
test('addressed progress rejects competing or undurable backends before opening data',t=>{
 const root=temporary(t,'progress-runtime-config'),filePath=path.join(root,'profiles.json');
 for(const options of [{arenaProgressShards:-1},{arenaProgressShards:9},{arenaProgressShards:1.5},{arenaProgressShards:3,journal:false},{arenaProgressShards:3,journal:true,arenaProgressWorker:true}]){
  assert.throws(()=>new ProfileStore({filePath,...options}),/Addressed progress/);assert.deepEqual(fs.readdirSync(root),[]);
 }
 assert.throws(()=>new ProfileStore({arenaProgressShards:3,journal:true}),/Addressed progress/);
});
test('configured addressed progress starts no complete-world replica and closes cleanly',async t=>{
 const root=temporary(t,'progress-runtime-config'),filePath=path.join(root,'profiles.json');
 const store=new ProfileStore({filePath,journal:true,arenaProgressShards:3,clanDailyQuests:true});
 try{assert.equal(store.arenaPreparer.count,3);assert.equal(store.arenaPreparer.lanes.length,0);assert.equal(store.arenaPreparer.worker,undefined);assert.equal(store.arenaPreparer.stats.jobs,0);}
 finally{await store.close();}
 assert.equal(store.arenaPreparer.closed,true);
});
