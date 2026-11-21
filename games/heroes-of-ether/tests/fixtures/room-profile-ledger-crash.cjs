'use strict';
// Disposable integration fixture only. No live paths/configuration are read.
const path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {RoomProfileLedger}=require('../../src/server/arena/resident/room-profile-ledger');
const {RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const root=process.argv[2],mode=process.argv[3];
if(!root || !['reserved','applied','received'].includes(mode) || fs.existsSync(path.join(root,'profiles.json')))
 throw Error('A new isolated fixture directory is required');
(async()=>{
 const at=Date.parse('2026-11-15T06:00:00Z'),filePath=path.join(root,'profiles.json');
 const store=new ProfileStore({filePath,journal:true,residentRoomExperiment:true,now:()=>at});
 const auth=store.open(),profileId=auth.profile.id,lifeId=randomUUID();
 store.transact(auth.token,randomUUID(),'fixture',p=>{p.inventory.meat=5;p.quickSlots=['meat'];});
 store.startLife(profileId,lifeId);
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
 await once(child,'spawn');
 const ledger=new RoomProfileLedger(store),identity={roomId:'crash-room',epoch:'crash-epoch'};
 await ledger.claim({...identity,profileIds:[profileId]},child);
 const outbox=await RoomOutbox.open({...identity,file:path.join(root,'room.json')});
 const tx=await ledger.reserve(child,auth.token,{...identity,txId:profileId+'_'+randomUUID(),lifeId,boosterId:'meat',intent:'fixture'});
 if(mode!=='reserved') {
  const entry=await outbox.append({at,applied:[{txId:tx.txId,profileId,lifeId,boosterId:'meat',mass:100}],
   progress:[{type:'massPeak',profileId,mass:450}]});
  if(mode==='received')await ledger.accept(child,entry);
 }
 // The simulated room owner is confirmed gone before killing the coordinator.
 // Leave both WALs unclosed/uncheckpointed, including the stale process lock.
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify({profileId,txId:tx.txId,identity,at}));
 process.kill(process.pid,'SIGKILL');
})().catch(error=>{console.error(error);process.exitCode=1;});
