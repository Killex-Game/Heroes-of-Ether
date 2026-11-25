'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditResidentAcks}=require('../../scripts/benchmarks/resident-room-processes/audit-resident-acks.cjs');
const receipts=require('../../src/server/profiles/operation-receipts'),records=require('../../src/server/arena/resident/room-cast-records');
function fixture(){
 const p={id:'profile-a',receipts:{},progress:{session:null}},requestId='operation-00000001',txId=p.id+'_'+requestId;
 receipts.recordArena(p,txId,records.encode({txId,profileId:p.id,status:'APPLIED',boosterId:'meat'}));
 return {saved:{profiles:{p},residentRooms:{r:{status:'CLOSED'}}},configs:[{id:'r',profiles:[p]}],
  peers:[{inputs:{pending:0,successful:1,confirmed:[{playerId:'room-r-player-0',requestId,boosterId:'meat'}]}}],rooms:[{durableCasts:{applied:1}}]};
}
const audit=f=>auditResidentAcks(f.saved,f.configs,f.peers,f.rooms);
test('resident audit verifies actual client success against recovered permanent outcome',()=>{
 assert.deepEqual(audit(fixture()),{acknowledged:1,recovered:1,duplicates:0,roomsClosed:1,pendingReservations:0});
});
test('resident audit rejects missing, mismatched and duplicated confirmations',()=>{
 let f=fixture();f.saved.profiles.p.arenaReceipts={};assert.throws(()=>audit(f),/Missing acknowledged/);
 f=fixture();f.peers[0].inputs.confirmed[0].boosterId='rocket';assert.throws(()=>audit(f));
 f=fixture();f.peers[0].inputs.confirmed.push({...f.peers[0].inputs.confirmed[0]});f.peers[0].inputs.successful=2;assert.throws(()=>audit(f),/Duplicate/);
 f=fixture();f.rooms[0].durableCasts.applied=2;assert.throws(()=>audit(f),/Applied effects/);
});
test('resident audit rejects unsettled life and unresolved reservation evidence',()=>{
 let f=fixture();f.saved.profiles.p.progress.session={id:'life'};assert.throws(()=>audit(f),/Active life/);
 f=fixture();const p=f.saved.profiles.p,key='profile-a_operation-00000002';p.residentCasts={[key]:true};
 receipts.recordArena(p,key,records.encode({txId:key,profileId:p.id,status:'RESERVED',boosterId:'meat'}));
 assert.throws(()=>audit(f),/Unresolved inventory/);
});
