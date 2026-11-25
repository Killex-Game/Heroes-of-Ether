"use strict";
// Load fixture, not a replacement for authenticated production joins/purchases.
const { Arena, radiusForMass, massLimitForLevel } = require('../../../src/server/arena/arena-simulation');
const { stepRoom } = require('../../../src/server/arena/room-step');
const { BOOSTERS, BoosterError } = require('../../../src/server/boosters/booster-catalog');
const { ArenaStateStream, RoomFoodEncoder } = require('../../../src/server/arena/state-stream');
const accounts = require('../../../src/server/accounts/account-benefits');
const { RoomCasts } = require('./room-casts.cjs');
const readyBoosters = [...BOOSTERS.values()].filter(b=>b.ready).map(b=>b.id);
const masses = [20,50,150,1000,4000,15000,25000,40000,75000,120000];
function summary(values) {
  const a=[...values].sort((x,y)=>x-y),n=a.length;
  return { n, p50:a[Math.floor(n*.5)]||0,p95:a[Math.floor(n*.95)]||0,p99:a[Math.floor(n*.99)]||0,max:a[n-1]||0 };
}
class RoomFixture {
  constructor(id, profiles, now, sendProgress, epoch, sendCast) {
    let seed=907+Number(id.split('-').at(-1));
    const random=()=> (seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
    this.id=id;this.epoch=epoch;this.sendProgress=sendProgress;
    this.wallNow=require('../game-clock.cjs').clock(process.env.ROOM_BENCH_GAME_OFFSET_MS||'0');
    this.identities=new Map();
    this.arena=new Arena({random,backgroundRandom:random});
    this.lookup=new Map(profiles.map(p=>[p.id,p]));
    this.profiles={byId:id=>this.lookup.get(id),arenaAppearance:p=>({
      ...(this.identities.get(p.id)||{skinId:p.skinId,appearance:p.appearance}),
      account:accounts.publicAccount(p,this.wallNow())})};
    this.pendingLives=[];
    this.respawnDelay=Math.max(0,Number(process.env.ROOM_BENCH_RESPAWN_DELAY_MS)||0);
    this.deadSince=new Map();
    this.readyLives=new Set();
    this.bots={events:[],update:()=>this.pendingLives.splice(0),clearIfIdle:()=>[]};
    this.players=profiles.map((profile,i)=>{
      const p=this.arena.addPlayer(now,'room-'+id+'-player-'+i);
      Object.assign(p,{profileId:profile.id,name:profile.name,skinId:profile.skinId,level:profile.level,
        quickSlots:profile.quickSlots,account:accounts.publicAccount(profile,this.wallNow())});
      this.populate(p,i,now,true);return p;
    });
    this.clients=new Set();this.connectionsByPlayer=new Map();this.encoder=new RoomFoodEncoder();this.outbox=[];this.seq=0;this.tickNo=0;
    this.metrics={ticks:0,pauses:0,boosters:{},progressTypes:{},rejected:0,bytes:0,states:0,maxOutbox:0,respawns:0,reconnections:0,aliveSamples:0,minAlive:profiles.length,maxAlive:0};
    this.times=[];this.intervals=[];this.lastTick=null;this.inFlight=new Map();
    this.phases={physics:[],snapshot:[],broadcast:[]};
    this.networkEvery=Math.max(1,Math.min(4,Number(process.env.ROOM_BENCH_NETWORK_EVERY)||1));
    this.networkEvents={events:[],audioEvents:[],visualEvents:[]};
    this.casts=sendCast ? new RoomCasts(this,sendCast) : null;
    this.socketInputs=process.env.ROOM_BENCH_INPUTS==='socket' ? new (require('./socket-inputs.cjs').SocketInputs)(this) : null;
    this.partSamples=0;this.fullSplitSamples=0;
    this.barrier = { reason: null, since: now, casts: 0, progress: 0 };
  }
  populate(p,i,at,initial=false) {
    if(initial){
    const balanced=process.env.ROOM_BENCH_SCENARIO==='balanced-split';
    const total=Math.min(balanced?4000:masses[i%masses.length],massLimitForLevel(p.level)*this.arena.maxParts);
    const x=250+i%7*480,y=200+Math.floor(i/7)*440;
    Object.assign(p,{protectedUntil:0,x,y,targetX:x,targetY:y});
    if(balanced){const n=16;p.parts=Array.from({length:n},(_,j)=>{const mass=Math.floor(total/n)+(j<total%n?1:0);
      return {id:p.id+'-s'+p.spawnSerial+'-'+j,mass,
      radius:radiusForMass(mass),x:x+(j%4)*40,y:y+Math.floor(j/4)*40,vx:0,vy:0,mergeAt:at+30000};});
    p.mainPartId=p.parts[0].id;this.arena.syncParts(p);
    }else require('../seed-arena-parts.cjs').seedParts(this.arena,p,total,p.level);
    }
    const profile=this.lookup.get(p.profileId);
    if(profile){Object.assign(p,this.identities.get(p.profileId));
      require('../../../src/server/pets/arena-pets').start(p,profile,at,this.wallNow());}
    this.pendingLives.push({type:'lifeStarted',profileId:p.profileId,lifeId:p.lifeId});
  }
  connect(ws,index) {
    if(!Number.isSafeInteger(index)||index<0||index>=this.players.length){ws.close(1008,'Invalid player');return false;}
    ws.playerId=this.players[index].id;
    const previous=this.connectionsByPlayer.get(ws.playerId);
    const send=(socket,data)=>{
      if(socket.readyState!==1)return;
      const payload=typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data);
      this.metrics.bytes+=Buffer.byteLength(payload);this.metrics.states++;
      socket.send(payload,{binary:false},error=>{if(error)socket.terminate();});
    };
    const stream=this.stateWorkers ? this.stateWorkers.createStream(this.id,ws,send)
      : new ArenaStateStream(ws,send,()=>performance.now(),this.encoder);
    // Independent viewport and acknowledged baseline for every real socket.
    stream.viewport=null; // Explicit whole-room stress mode until the first camera update.
    this.connectionsByPlayer.set(ws.playerId,stream);
    if(previous){
      this.clients.delete(previous);
      this.metrics.reconnections++;
      previous.ws.close(1000,'Reconnected');
    }
    this.clients.add(stream);
    this.socketInputs?.connect(ws,index);
    ws.on('message',bytes=>{
      if(this.connectionsByPlayer.get(ws.playerId)!==stream)return;
      try{const m=JSON.parse(bytes);if(m.type==='stateAck')stream.acknowledge(m.sequence);else this.socketInputs?.receive(ws,m);}catch{ws.terminate();}
    });
    ws.on('close',()=>{
      stream.dispose?.();
      this.clients.delete(stream);
      if(this.connectionsByPlayer.get(ws.playerId)===stream)this.connectionsByPlayer.delete(ws.playerId);
    });
    return true;
  }
  tick(at) {
    this.resend(at);
    this.updateBarrier(at);
    if(this.casts?.locked){this.casts.metrics.lockPauses++;return false;}
    if(this.outbox.length>=64){this.metrics.pauses++;return false;}
    if(this.lastTick!=null)this.intervals.push(at-this.lastTick);this.lastTick=at;
    const started=performance.now(), tick=this.tickNo++;
    this.casts?.beforeFrame?.(at);
    this.socketInputs?.drain(at);
    for(let i=0;i<this.players.length;i++){
      const p=this.players[i],target=this.players[(i+1)%this.players.length];
      if(p.dead){
        if(!this.deadSince.has(p.id))this.deadSince.set(p.id,at);
        if(at-this.deadSince.get(p.id)<this.respawnDelay)continue;
        this.deadSince.delete(p.id);this.arena.resetPlayer(p,at);this.populate(p,i,at);this.metrics.respawns++;
      }
      if(this.socketInputs)continue;
      const input={spawnSerial:p.spawnSerial,sequence:tick+1,x:target.x,y:target.y};
      this.arena.handleInput(p.id,{...input,type:'move'},at);
      if(tick%8===1)this.arena.handleInput(p.id,{...input,type:'feed'},at);
      if(tick%20===2)this.arena.handleInput(p.id,{...input,type:'split'},at);
      if(tick%20!==0)continue;
      if(this.casts&&!this.readyLives.has(p.lifeId))continue;
      const kind=this.casts ? p.quickSlots[Math.floor(tick/20)%p.quickSlots.length] :
        readyBoosters[(i+Math.floor(tick/20))%readyBoosters.length];
      try{
        const command={...input,boosterId:kind,aimX:target.x,aimY:target.y,
          targetId:target.id,targetSpawnSerial:target.spawnSerial,requestId:p.id+'-'+tick};
        if(this.casts)this.casts.request(p,command);
        else {
          this.arena.prepareBooster(p.id,command,at)();
          this.metrics.boosters[kind]=(this.metrics.boosters[kind]||0)+1;
        }
      }catch(error){if(!(error instanceof BoosterError))throw error;this.metrics.rejected++;}
    }
    const physicsAt=performance.now();
    const wallAt=this.wallNow(), result=stepRoom(this,at,wallAt,this.profiles,30);
    this.phases.physics.push(performance.now()-physicsAt);
    const progress=result.progress.filter(e=>this.lookup.has(e.profileId));
    for (const event of progress) this.metrics.progressTypes[event.type]=(this.metrics.progressTypes[event.type]||0)+1;
    if(this.frameOwner)this.frameOwner.recordProgress(progress);
    else if(progress.length){this.outbox.push({roomId:this.id,epoch:this.epoch,sequence:++this.seq,at:wallAt,progress});
      this.metrics.maxOutbox=Math.max(this.metrics.maxOutbox,this.outbox.length);}
    this.networkEvents.events.push(...result.events);
    this.networkEvents.audioEvents.push(...this.arena.audioEvents);
    this.networkEvents.visualEvents.push(...this.arena.combat.contacts);
    if(tick%this.networkEvery===0){
    const snapshotAt=performance.now();
    const snapshot=this.arena.snapshot(at,this.networkEvents.events,tick%20===0);
    snapshot.audioEvents=this.networkEvents.audioEvents;
    snapshot.visualEvents=this.networkEvents.visualEvents;
    this.networkEvents={events:[],audioEvents:[],visualEvents:[]};
    this.phases.snapshot.push(performance.now()-snapshotAt);
    const broadcastAt=performance.now();
    const publish=()=>{for(const stream of this.clients){
      if(process.env.ROOM_BENCH_VIEWS==='camera'){
        const p=this.arena.players.get(stream.ws.playerId);
        const width=Math.min(this.arena.world.width,Math.max(1280,1280*Math.sqrt(p.mass/15000)));
        stream.viewport={x:p.x,y:p.y,width,height:width*9/16};
      }
      stream.publish(snapshot);
    }};
    if(this.frameOwner)this.frameOwner.defer(publish);else publish();
    this.phases.broadcast.push(performance.now()-broadcastAt);
    }
    this.resend(at);
    const alive=this.players.filter(p=>!p.dead).length;
    this.metrics.aliveSamples+=alive;this.metrics.minAlive=Math.min(this.metrics.minAlive,alive);this.metrics.maxAlive=Math.max(this.metrics.maxAlive,alive);
    this.partSamples+=this.players.reduce((n,p)=>n+(p.dead?0:this.arena.bodies(p).length),0);
    this.fullSplitSamples+=this.players.filter(p=>!p.dead&&this.arena.bodies(p).length===16).length;
    this.metrics.ticks++;this.times.push(performance.now()-started);
    this.updateBarrier(performance.now());
  }
  updateBarrier(at) {
    const reason = this.casts?.locked ? 'casts' : this.outbox.length >= 64 ? 'progress' : null;
    const b = this.barrier;
    if (reason === b.reason) return;
    if (b.reason) b[b.reason] += Math.max(0, at - b.since);
    b.reason = reason; b.since = at;
  }
  barrierReport(at = performance.now()) {
    const b = this.barrier, times = { casts: b.casts, progress: b.progress };
    if (b.reason) times[b.reason] += Math.max(0, at - b.since);
    return { ...times, total: times.casts + times.progress };
  }
  resend(at) {
    this.casts?.retryPending(at);
    if(this.frameOwner){this.frameOwner.resend(at);return;}
    const requested=Number(process.env.ROOM_BENCH_PROGRESS_WINDOW);
    const window=[1,2,4].includes(requested)?requested:4;
    for(const batch of this.outbox.slice(0,window)){
      const sent=this.inFlight.get(batch.sequence);
      if(sent==null||at-sent>5000){
        this.inFlight.set(batch.sequence,at);this.sendProgress(batch);
      }
    }
  }
  ack(m) {
    const first=this.outbox[0];
    if(first&&m.epoch===this.epoch&&m.sequence===first.sequence){
      for(const event of first.progress)if(event.type==='lifeStarted')this.readyLives.add(event.lifeId);
      // Only current lives need a fence; don't retain every respawn forever.
      const current=new Set(this.players.map(p=>p.lifeId));
      for(const id of this.readyLives)if(!current.has(id))this.readyLives.delete(id);
      this.outbox.shift();this.inFlight.delete(m.sequence);this.resend(performance.now());
    }
    this.updateBarrier(performance.now());
  }
  report(){return {id:this.id,...this.metrics,outbox:this.outbox.length,clients:this.clients.size,networkEvery:this.networkEvery,
    barrierMs:this.barrierReport(),
    inputs:this.socketInputs&&{...this.socketInputs.metrics,pending:this.socketInputs.actions.length},
    meanParts:this.partSamples/Math.max(1,this.metrics.ticks),meanFullySplit:this.fullSplitSamples/Math.max(1,this.metrics.ticks),
    respawnDelayMs:this.respawnDelay,meanAlive:this.metrics.aliveSamples/Math.max(1,this.metrics.ticks),
    durableCasts:this.casts&&{...this.casts.metrics,pending:this.casts.requests.size,locked:this.casts.locks.size,
      reservationMs:summary(this.casts.lockDurations),ackLatencyMs:summary(this.casts.ackLatencies),applyLatencyMs:summary(this.casts.applyLatencies)},
    alive:this.players.filter(p=>!p.dead).length,stepMs:summary(this.times),intervalMs:summary(this.intervals),
    phaseMs:Object.fromEntries(Object.entries(this.phases).map(([key,values])=>[key,summary(values)]))};}
}
module.exports={RoomFixture,summary};
