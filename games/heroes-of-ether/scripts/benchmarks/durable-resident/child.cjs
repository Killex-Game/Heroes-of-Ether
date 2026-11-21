'use strict';
const {DurableRoom}=require('./room.cjs'),transport=require('../resident-room-processes/transport.cjs');
const {startTickClock}=require('../../../src/server/arena/tick-clock');
let rooms,server,started,cpu,ending=false,stateWorkers;const clocks=new Map();
const send=m=>{if(process.connected)process.send(m);};
process.on('disconnect',()=>process.exit(ending?0:1));
process.on('message',async m=>{
 try {
  if(m.type==='init') {
   if(rooms)throw Error('Already initialized');rooms=new Map();
   for(const config of m.rooms)rooms.set(config.id,await DurableRoom.open(config,m.root,send));
   const count=Number(process.env.ROOM_BENCH_STATE_WORKERS || 0);
   if(![0,1,2].includes(count))throw Error('Invalid state worker count');
   if(count){stateWorkers=new(require('../../../src/server/arena/state-workers').ArenaStateWorkers)({maxWorkers:count,maxRooms:0});
    for(const room of rooms.values())room.fixture.stateWorkers=stateWorkers;}
   server=await transport.listen((ws,req)=>{
    const url=new URL(req.url,'http://localhost'),room=rooms.get(url.searchParams.get('room')),index=url.searchParams.get('player');
    if(url.searchParams.get('key')!==m.key || !room || !/^(0|[1-9]\d*)$/.test(index || '')){ws.close(1008);return;}
    room.connect(ws,Number(index));
   });send({type:'ready',port:server.address().port,pid:process.pid});
  }else if(m.type==='reservation') {
   const room=rooms.get(m.roomId);room?.receiveReservation(m);clocks.get(m.roomId)?.resume();
  }else if(m.type==='ack') {
   const room=rooms.get(m.roomId);room?.receiveAck(m);clocks.get(m.roomId)?.resume();
  }else if(m.type==='start') {
   if(started)return;started=performance.now();cpu=process.cpuUsage();
   for(const room of rooms.values())clocks.set(room.id,startTickClock(()=>room.tick(),50));
  }else if(m.type==='sample' && started && !ending) {
   send({type:'sample',elapsed:performance.now()-started,memory:process.memoryUsage(),
    rooms:[...rooms.values()].map(r=>({id:r.id,ticks:r.stats.ticks,pauses:r.stats.pauses,
     pendingFrames:r.outbox.frames.size,pendingCasts:r.requests.size,fault:r.fault?.message}))});
  }else if(m.type==='stop' && !ending) {
   ending=true;for(const clock of clocks.values())clock();
   const elapsed=performance.now()-started,used=process.cpuUsage(cpu),measuredRooms=[...rooms.values()].map(r=>r.report());
   const deadline=Date.now()+30000;
   while([...rooms.values()].some(r=>r.pending && r.gate.pending || r.requests.size || r.outbox.frames.size || r.fixture.socketInputs?.actions.length)) {
    if(Date.now()>deadline)throw Error('Durable resident drain deadline exceeded');
    for(const room of rooms.values()) {
     if(room.fault)throw room.fault;
     if(room.waiting.size || room.commands.length || room.fixture.socketInputs?.actions.length)room.tick();
     else room.resend(performance.now());
    }
    await new Promise(r=>setTimeout(r,10));
   }
   for(const room of rooms.values()){room.stopping=true;await room.close();}
   const report={elapsed,cpuMs:(used.user+used.system)/1000,measuredRooms,
    rooms:[...rooms.values()].map(r=>r.report()),rss:process.memoryUsage().rss,drainMs:performance.now()-started-elapsed};
   await stateWorkers?.close();for(const ws of server.clients)ws.close();await new Promise(r=>server.close(r));
   send({type:'report',report});process.disconnect();
  }
 }catch(error){send({type:'fault',message:error.stack});process.exitCode=1;for(const clock of clocks.values())clock();}
});
