'use strict';
// Isolated calculation comparison. No sockets, disks, PG or gameplay admission.
const path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {ProfileStore,arenaCastDraft}=require('../../src/server/profiles/profile-store');
const {RoomProfileLedger}=require('../../src/server/arena/resident/room-profile-ledger');
const records=require('../../src/server/arena/resident/room-cast-records'),receipts=require('../../src/server/profiles/operation-receipts');
function fixture(count=30,perOwner=8){
 const at=Date.parse('2026-11-24T09:00:00Z'),store=new ProfileStore({residentRoomExperiment:true,now:()=>at}),profiles=[];
 for(let i=0;i<count;i++){
  const auth=store.open(),lifeId=randomUUID();store.transact(auth.token,randomUUID(),'fixture',p=>{p.inventory.meat=100;p.quickSlots=['meat'];});
  store.startLife(auth.profile.id,lifeId);profiles.push(store.byId(auth.profile.id));
 }
 const room={roomId:'copy-room',epoch:'copy-epoch',sequence:0,digest:null,at:0,status:'ACTIVE',frameReceipts:{},profiles:profiles.map(p=>p.id),deadlineProtocol:1,boundaryThrough:0};
 const table={...store.data.profiles},applied=[],cancelled=[];
 for(const p of profiles){const key=[...Object.keys(table)].find(k=>table[k].id===p.id),draft=arenaCastDraft(p);
  for(let i=0;i<perOwner;i++){
   const tx=records.identity({...room,lifeId:p.progress.session.id,boosterId:'meat',txId:p.id+'_'+randomUUID(),intent:'fixture'},p,at);
   records.reserve(draft,tx,at);receipts.recordArena(draft,tx.txId,records.encode(tx));
   (i%3===2?cancelled:applied).push({txId:tx.txId,profileId:p.id,lifeId:tx.lifeId,boosterId:tx.boosterId,mass:100});
  }
  table[key]=draft;
 }
 for(let i=count;i<1280;i++)table['idle-'+i]={...profiles[0],id:randomUUID()};
 const world={...store.data,version:15,profiles:table,residentRooms:{[room.roomId]:room}};
 store.data=world;const frame={roomId:room.roomId,epoch:room.epoch,sequence:1,at,kind:'tick',progress:[],applied,cancelled};
 return {store,world,room,entry:{frame,digest:createHash('sha256').update(JSON.stringify(frame)).digest('hex')}};
}
function compare(baselineRoot,{iterations=30,pairs=3}={}){
 const Old=require(path.join(path.resolve(baselineRoot),'src/server/arena/resident/room-profile-ledger.js')).RoomProfileLedger;
 const f=fixture(),before=JSON.stringify(f.world),old=Object.assign(Object.create(Old.prototype),{store:f.store}),next=Object.assign(Object.create(RoomProfileLedger.prototype),{store:f.store});
 const expected=old.applyEntry(f.world,f.room,f.entry),actual=next.applyEntry(f.world,f.room,f.entry);
 assert.deepEqual(actual,expected);assert.equal(JSON.stringify(f.world),before);
 const results=[];
 for(let pair=0;pair<pairs;pair++)for(const kind of pair%2?['candidate','baseline']:['baseline','candidate']){
  const ledger=kind==='baseline'?old:next;global.gc?.();const start=performance.now();
  for(let i=0;i<iterations;i++)ledger.applyEntry(f.world,f.room,f.entry);
  results.push({pair,kind,iterations,elapsedMs:performance.now()-start});
 }
 assert.equal(JSON.stringify(f.world),before);
 return {scope:'Repeated isolated applyEntry against one immutable reserved frame; not whole-game CPU, IPC or CCU',profiles:1280,participants:30,outcomes:240,iterations,pairs,exact:true,
  resultSha256:createHash('sha256').update(JSON.stringify(actual)).digest('hex'),results};
}
if(require.main===module)console.log(JSON.stringify(compare(process.argv[2]),null,2));
module.exports={fixture,compare};
