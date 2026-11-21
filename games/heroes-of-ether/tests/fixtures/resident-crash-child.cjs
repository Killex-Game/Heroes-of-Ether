"use strict";
// Private child for process-death tests; no listening ports or storage writer.
const {RoomFixture}=require('../../scripts/benchmarks/resident-room-processes/room-fixture.cjs');
let room;
process.on('disconnect',()=>process.exit());
process.on('message',m=>{
  if(m.type==='init'){
    room=new RoomFixture(m.roomId,m.profiles,performance.now(),()=>{},m.epoch,message=>process.send(message));
    process.send({type:'ready',lives:room.players.map(p=>({id:p.id,profileId:p.profileId,lifeId:p.lifeId,spawnSerial:p.spawnSerial}))});
  }else if(m.type==='request'){
    const p=room.players[m.index||0];
    room.casts.request(p,{boosterId:'meat',requestId:m.requestId,spawnSerial:p.spawnSerial,aimX:p.x+100,aimY:p.y});
  }else if(m.type.startsWith('cast')){
    room.casts.receive(m);
    if(m.type==='castCommit'||m.type==='castRejected')process.send({type:'observed',requestId:m.requestId,
      applied:room.casts.metrics.applied,rejected:room.casts.metrics.rejected});
  }
});
