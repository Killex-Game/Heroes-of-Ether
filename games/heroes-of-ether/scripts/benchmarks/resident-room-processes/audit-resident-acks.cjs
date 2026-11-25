'use strict';
const assert=require('node:assert/strict'),records=require('../../../src/server/arena/resident/room-cast-records');
function auditResidentAcks(saved,configs,peers,rooms){
 const players=new Map(configs.flatMap(c=>c.profiles.map((p,i)=>['room-'+c.id+'-player-'+i,p.id])));
 const profiles=new Map(Object.values(saved.profiles).map(p=>[p.id,p])),seen=new Set();let acknowledged=0,recovered=0;
 for(const peer of peers){
  assert.equal(peer.inputs.pending,0,'Unresolved peer requests');
  assert.equal(peer.inputs.confirmed.length,peer.inputs.successful,'Incomplete success evidence');
  for(const ack of peer.inputs.confirmed){
   acknowledged++;const id=players.get(ack.playerId);assert(id,'Unknown acknowledged player');
   const txId=id+'_'+ack.requestId;assert(!seen.has(txId),'Duplicate client confirmation');seen.add(txId);
   const tx=records.read(profiles.get(id),txId);assert(tx,'Missing acknowledged transaction');
   assert.equal(tx.status,'APPLIED');assert.equal(tx.boosterId,ack.boosterId);recovered++;
  }
 }
 assert.equal(acknowledged,rooms.reduce((sum,r)=>sum+r.durableCasts.applied,0),'Applied effects differ from client confirmations');
 for(const config of configs){assert.equal(saved.residentRooms[config.id].status,'CLOSED');
  for(const p of config.profiles){const profile=profiles.get(p.id);assert(!profile.progress.session,'Active life survived closed room');
   for(const key of Object.keys(profile.residentCasts||{}))assert.notEqual(records.read(profile,key).status,'RESERVED','Unresolved inventory hold');}}
 return {acknowledged,recovered,duplicates:0,roomsClosed:configs.length,pendingReservations:0};
}
module.exports={auditResidentAcks};
