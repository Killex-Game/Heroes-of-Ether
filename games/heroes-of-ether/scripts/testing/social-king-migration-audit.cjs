'use strict';
const assert=require('node:assert/strict');
const old='/srv/heroether-test/play/releases/20261110-lobby-polish';
const next='/srv/heroether-test/play/releases/20261111-social-king';
const filePath='/srv/heroether-test/play/data/profiles.json';
const {recover}=require(next+'/src/server/profiles/profile-journal');
const {hash}=require(next+'/src/server/persistence/mongodb-state');
const {migrateKingProgress,validateProgress}=require(next+'/src/server/progression/experience-progression');
const before=recover(filePath).data,at=Date.now();
const OldStore=require(old+'/src/server/profiles/profile-store').ProfileStore;
const NewStore=require(next+'/src/server/profiles/profile-store').ProfileStore;
// journal=false: both constructors read and validate, without writing live data.
const previous=new OldStore({filePath,now:()=>at}).data;
const updated=new NewStore({filePath,now:()=>at}).data;
const expected=structuredClone(previous);let migrated=0,stars=0;
for(const [key,p] of Object.entries(expected.profiles)){
 if(migrateKingProgress(p)){p.revision++;migrated++;}
 validateProgress(p);
 assert.equal(updated.profiles[key].greatness,before.profiles[key].greatness);
 assert.equal(updated.profiles[key].progress.claimed.king,before.profiles[key].progress.claimed.king);
 stars+=p.progress.claimed.king;
}
assert.equal(hash(updated),hash(expected),'Unexpected data change during migration');
assert.equal(hash(recover(filePath).data),hash(before),'Audit changed saved data');
console.log(JSON.stringify({ok:true,profiles:Object.keys(updated.profiles).length,clans:Object.keys(updated.clans).length,migrated,earnedKingStarsPreserved:stars,otherFieldsUnchanged:true}));
