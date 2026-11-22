'use strict';
const assert=require('node:assert/strict');
const old='/srv/heroether-test/play/releases/20261111-social-king';
const next='/srv/heroether-test/play/releases/20261111-room-brackets';
const filePath='/srv/heroether-test/play/data/profiles.json';
const {recover}=require(next+'/src/server/profiles/profile-journal');
const {hash}=require(next+'/src/server/persistence/state-snapshot');
const {BOOSTERS}=require(next+'/src/server/boosters/booster-catalog');
const loadout=require(next+'/public/shared/quick-slot-rules');
const before=recover(filePath).data,at=Date.now();
const OldStore=require(old+'/src/server/profiles/profile-store').ProfileStore;
const NewStore=require(next+'/src/server/profiles/profile-store').ProfileStore;
// Constructors read/validate in memory; journal is disabled for this audit.
const previous=new OldStore({filePath,now:()=>at}).data;
const updated=new NewStore({filePath,now:()=>at}).data;
const expected=structuredClone(previous);let migrated=0,clearedSlots=0;
for(const p of Object.values(expected.profiles)){
 if(p.quickSlots?.some(id=>id&&!loadout.itemAllowed(BOOSTERS.get(id),p.level))){
  p.quickSlots=p.quickSlots.map(id=>{if(id&&!loadout.itemAllowed(BOOSTERS.get(id),p.level)){clearedSlots++;return null}return id});
  p.revision++;migrated++;
 }
}
assert.equal(hash(updated),hash(expected),'Unexpected data change during migration');
assert.equal(hash(recover(filePath).data),hash(before),'Audit changed saved data');
console.log(JSON.stringify({ok:true,profiles:Object.keys(updated.profiles).length,clans:Object.keys(updated.clans).length,migrated,clearedSlots,inventoryWalletAndOtherFieldsUnchanged:true}));
