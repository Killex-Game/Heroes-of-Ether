"use strict";
const transport = require('./transport.cjs');
const { RoomFixture } = require('./room-fixture.cjs');
const { startTickClock } = require('../../../src/server/arena/tick-clock');
let rooms,server,timer,started,cpuStart,ending=false,peakRss=0,stateWorkers;
const stateWorkerCount=Number(process.env.ROOM_BENCH_STATE_WORKERS||0);
if(!Number.isInteger(stateWorkerCount)||stateWorkerCount<0||stateWorkerCount>2)
  throw Error('Invalid diagnostic state worker count');
const roomClocks = new Map();
const send=m=>{if(process.connected)process.send(m);};
process.on('disconnect',()=>process.exit(1)); // Never advance an orphaned room.
process.on('message',async m=>{
  if(m.type==='init'){
    if(rooms)throw Error('Already initialized');
    const at=performance.now();
    rooms=new Map(m.rooms.map(c=>[c.id,new RoomFixture(c.id,c.profiles,at,b=>send({type:'progress',batch:b}),c.epoch,
      m.durableCasts?send:null)]));
    if(stateWorkerCount){
      stateWorkers=new (require('../../../src/server/arena/state-workers').ArenaStateWorkers)({
        maxWorkers:stateWorkerCount,maxRooms:0,packedFood:false,packedParts:false});
      for(const room of rooms.values())room.stateWorkers=stateWorkers;
    }
    server=await transport.listen((ws,req)=>{
      const url=new URL(req.url,'http://localhost'),r=rooms.get(url.searchParams.get('room'));
      if(url.searchParams.get('key')!==m.key||!r){ws.close();return;}
      const player=url.searchParams.get('player');
      if(!/^(0|[1-9]\d*)$/.test(player||'')){ws.close(1008,'Invalid player');return;}
      r.connect(ws,Number(player));
    });
    send({type:'ready',port:server.address().port,pid:process.pid});
  }else if(m.type==='ack'){
    rooms?.get(m.roomId)?.ack(m);roomClocks.get(m.roomId)?.resume();
  }
  else if(m.type.startsWith('cast')){
    const room = rooms?.get(m.roomId);
    room?.casts?.receive(m);room?.updateBarrier(performance.now());roomClocks.get(m.roomId)?.resume();
  }
  else if(m.type==='start'){
    if(timer)return;started=performance.now();cpuStart=process.cpuUsage();
    if(process.env.ROOM_BENCH_RESUME_CLOCK==='1'){
      for(const room of rooms.values())roomClocks.set(room.id,startTickClock(()=>{
        const result=room.tick(performance.now());
        peakRss=Math.max(peakRss,process.memoryUsage().rss);return result;
      },50));
      timer=()=>{for(const stop of roomClocks.values())stop();};
    }else{
      timer=startTickClock(()=>{const at=performance.now();for(const room of rooms.values())room.tick(at);
        peakRss=Math.max(peakRss,process.memoryUsage().rss);},50);
    }
  }else if(m.type==='probe'){
    send({type:'probe',rooms:[...rooms.values()].map(r=>({id:r.id,ticks:r.tickNo}))});
  }else if(m.type==='stop'&&!ending){
    ending=true;timer?.();
    const elapsed=performance.now()-started,cpu=process.cpuUsage(cpuStart),deadline=Date.now()+30000;
    // Draining accepted inputs can advance additional ticks after measurement
    // ends. Keep an independent pre-drain sample for cadence/physics metrics;
    // the final room reports still prove all accepted work was settled.
    const measuredRooms = [...rooms.values()].map(r => structuredClone(r.report()));
    const measuredStateWorkers=stateWorkers&&{...stateWorkers.stats,workers:stateWorkers.lanes.length};
    while([...rooms.values()].some(r=>r.outbox.length||r.casts?.requests.size||r.socketInputs?.actions.length)&&Date.now()<deadline){
      for(const r of rooms.values()){
        if(r.socketInputs?.actions.length&&!r.casts?.locked)r.tick(performance.now());
        else r.resend(performance.now());
      }await new Promise(r=>setTimeout(r,20));
    }
    const report={elapsed,cpuMs:(cpu.user+cpu.system)/1000,peakRss,measuredRooms,measuredStateWorkers,
      drainMs:performance.now()-started-elapsed,rooms:[...rooms.values()].map(r=>r.report())};
    await stateWorkers?.close();
    for(const ws of server.clients)ws.close();await new Promise(resolve=>server.close(resolve));
    send({type:'report',report});process.disconnect();
  }
});
