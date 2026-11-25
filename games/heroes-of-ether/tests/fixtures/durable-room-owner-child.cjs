'use strict';
const {RoomFixture}=require('../../scripts/benchmarks/resident-room-processes/room-fixture.cjs');
const {DurableRoomOwner}=require('../../scripts/benchmarks/resident-room-processes/durable-room-owner.cjs');
const {DurableRoomCasts}=require('../../scripts/benchmarks/resident-room-processes/durable-room-casts.cjs');
const {SocketInputs}=require('../../scripts/benchmarks/resident-room-processes/socket-inputs.cjs');
const transport=require('../../scripts/benchmarks/resident-room-processes/transport.cjs');
let room,owner,server;
const send=m=>{if(process.connected)process.send(m);};
process.on('disconnect',()=>process.exit(1));
process.on('message',async m=>{
 try{
  if(m.type==='init'){
   room=new RoomFixture(m.roomId,m.profiles,1000,()=>{throw Error('Legacy publication');},m.epoch);
   room.wallNow=()=>m.wall;room.socketInputs=new SocketInputs(room);
   owner=await DurableRoomOwner.open(room,m.file,send);room.casts=new DurableRoomCasts(room,send);
   server=await transport.listen((ws,request)=>{
    const url=new URL(request.url,'http://localhost');if(url.searchParams.get('key')!==m.key){ws.close();return;}
    room.connect(ws,Number(url.searchParams.get('index')));
   });
   send({type:'ready',port:server.address().port});
  }else if(m.type==='tick'){
   const entry=await owner.tick(m.at);send({type:'tickDone',id:m.id,sequence:entry?.frame.sequence,stats:room.casts.metrics});
  }else if(m.type==='residentAck')owner.acknowledge(m);
  else if(m.type==='residentReserved'||m.type==='residentRejected')room.casts.receive(m);
  else if(m.type==='barrier')send({type:'barrierDone',id:m.id,ready:room.readyLives.size,pending:owner.outbox.frames.size});
  else if(m.type==='stop'){
   for(const ws of server.clients)ws.close();await new Promise(resolve=>server.close(resolve));
   await owner.close();send({type:'stopped'});process.disconnect();
  }
 }catch(error){send({type:'fault',message:error.message});process.exitCode=1;process.disconnect();}
});
