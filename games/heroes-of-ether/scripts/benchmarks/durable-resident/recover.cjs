'use strict';
// Recovery drill on a NEW COPY of a disposable benchmark, never live data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {ProfileStore}=require('../../../src/server/profiles/profile-store');
const {recover}=require('../../../src/server/profiles/profile-journal');
const {RoomProfileLedger}=require('../../../src/server/arena/resident/room-profile-ledger');
const {RoomOutbox}=require('../../../src/server/arena/resident/room-outbox');
const records=require('../../../src/server/arena/resident/room-cast-records');
async function run(){
 const [sourceArg,targetArg]=process.argv.slice(2);
 if(!sourceArg || !targetArg)throw Error('Supply disposable benchmark source and NEW recovery-copy directory');
 const source=fs.realpathSync(sourceArg),target=path.resolve(targetArg);
 if(fs.existsSync(target) || target.startsWith(source+path.sep))throw Error('Recovery target must be a new independent directory');
 const before=recover(path.join(source,'profiles.json')).data;
 if(before.version!==15 || !before.residentRooms || !Object.values(before.profiles).every(p=>/^Load \d+$/.test(p.name)))
  throw Error('Only synthetic durable-room benchmark worlds are accepted');
 fs.cpSync(source,target,{recursive:true,errorOnExist:true});
 const store=new ProfileStore({filePath:path.join(target,'profiles.json'),journal:true,residentRoomExperiment:true});
 const ledger=new RoomProfileLedger(store),summaries=[];
 try{
  for(const room of Object.values(store.data.residentRooms)){
   const outbox=await RoomOutbox.openExisting({file:path.join(target,'rooms',room.roomId+'-'+room.epoch+'.json'),roomId:room.roomId,epoch:room.epoch});
   try{
    const tail=outbox.list().length;
    await ledger.bindRecovery(outbox);await ledger.recoverStopped(outbox,outbox);
    const after=store.data;await ledger.recoverStopped(outbox,outbox);assert.strictEqual(store.data,after);
    summaries.push({room:room.roomId,tail,sequence:store.data.residentRooms[room.roomId].sequence,status:store.data.residentRooms[room.roomId].status});
   }finally{await outbox.close();}
  }
  let reserved=0,applied=0,refunded=0;
  for(const old of Object.values(before.profiles)){
   const p=store.byId(old.id),returns={};
   for(const txId of Object.keys(old.residentCasts || {})){
    reserved++;const tx=records.read(p,txId);
    if(tx.status==='APPLIED')applied++;
    else if(tx.status==='REFUNDED'){
     refunded++;
     if(tx.boosterId!=='easter_egg' || tx.expiresAt>Date.now())returns[tx.boosterId]=(returns[tx.boosterId] || 0)+1;
    }else throw Error('Reservation remains unresolved');
   }
   assert.deepEqual(p.residentCasts || {},{});
   for(const id of new Set([...Object.keys(old.inventory),...Object.keys(p.inventory)]))
    assert.equal(p.inventory[id] || 0,(old.inventory[id] || 0)+(returns[id] || 0),'Recovered inventory '+id);
   assert.equal(p.progress.session,null);
  }
  await store.close();
  const persisted=recover(path.join(target,'profiles.json')).data;
  assert(Object.values(persisted.residentRooms).every(r=>r.status==='CLOSED'));
  const report={reserved,applied,refunded,rooms:summaries,duplicateRecoveryChangedState:false};
  fs.writeFileSync(path.join(target,'recovery-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await ledger.chain;await store.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
