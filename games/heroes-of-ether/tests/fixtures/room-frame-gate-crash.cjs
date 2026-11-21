'use strict';
const fs=require('node:fs');
const {RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const {RoomFrameGate}=require('../../src/server/arena/resident/room-frame-gate');
const [file,point]=process.argv.slice(2);
(async()=>{
 const box=await RoomOutbox.open({file,roomId:'room-one',epoch:'epoch-one'}),gate=new RoomFrameGate(box);
 await gate.advance({at:1},()=>{
  fs.writeFileSync(file+'.private','25');
  if(point==='private')process.kill(process.pid,'SIGKILL');
  return {progress:[{type:'massPeak',profileId:'profile-one',mass:25}],
   applied:[{txId:'cast-one',profileId:'profile-one',lifeId:'life-one',boosterId:'meat'}]};
 },()=>{
  if(point==='durable')process.kill(process.pid,'SIGKILL');
  fs.writeFileSync(file+'.published','published');
 });
 await box.close();
})().catch(error=>{console.error(error);process.exitCode=1});
