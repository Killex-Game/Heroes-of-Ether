'use strict';
// Isolated prototype: actual Arena/stepRoom/state transport, with publication
// gated by the room WAL and successful cast replies gated by the profile WAL.
// Production authentication, admission and complete clan lifecycle are absent.
const path=require('node:path'),{createHash}=require('node:crypto');
const {RoomFixture,summary}=require('../resident-room-processes/room-fixture.cjs');
const {stepRoom}=require('../../../src/server/arena/room-step');
const {BoosterError}=require('../../../src/server/boosters/booster-catalog');
const {RoomOutbox}=require('../../../src/server/arena/resident/room-outbox');
const {RoomFrameGate}=require('../../../src/server/arena/resident/room-frame-gate');
const questBoundary=require('../../../src/server/arena/resident/room-quest-boundary');
const samples=require('../sample-window.cjs');
class DurableRoom {
 static async open(config,root,send) {
  const room=new DurableRoom(config,send);
  room.outbox=await RoomOutbox.open({file:path.join(root,config.id+'-'+config.epoch+'.json'),roomId:config.id,epoch:config.epoch,maxFrames:64});
  room.gate=new RoomFrameGate(room.outbox,{onFault:error=>{room.fault=error;}});return room;
 }
 constructor(config,send) {
  this.id=config.id;this.epoch=config.epoch;this.send=send;
  this.fixture=new RoomFixture(config.id,config.profiles,performance.now(),()=>{},config.epoch,null);
  this.fixture.casts={request:(p,command)=>this.request(p,command)};
  this.requests=new Map();this.waiting=new Map();this.profiles=new Map();this.sent=new Map();this.acks=new Map();
  this.commands=[];this.completed=new Map();this.fault=null;this.stopping=false;
  this.stats={ticks:0,pauses:0,applied:0,cancelled:0,rejected:0,respawns:0,networkStates:0,maxOutbox:0,boosters:{}};
  this.tickTimes=samples();this.intervals=samples();this.flushTimes=samples();this.privateTimes=samples();this.lastAt=null;this.lastPublished=null;
  if(process.env.ROOM_BENCH_SOAK==='1')for(const key of Object.keys(this.fixture.phases))this.fixture.phases[key]=samples();
 }
 connect(ws,index){return this.fixture.connect(ws,index);}
 request(p,command) {
  if(this.stopping)throw new BoosterError('Room is stopping',409);
  if(this.completed.has(command.requestId)) {
   const done=this.completed.get(command.requestId);
   this.fixture.socketInputs?.result(p.id,command.requestId,done.ok,done.message);return;
  }
  if(this.requests.has(command.requestId))return;
  if(this.requests.size>=256)throw new BoosterError('Room cast queue full',409);
  const request={playerId:p.id,profileId:p.profileId,lifeId:p.lifeId,command:structuredClone(command)};
  this.requests.set(command.requestId,request);this.commands.push(request);
 }
 receiveReservation(message) {
  const request=this.waiting.get(message.requestId);
  if(!request || message.roomId!==this.id || message.epoch!==this.epoch || request.response)return;
  request.response=message;
 }
 receiveAck(message) {
  if(message.roomId!==this.id || message.epoch!==this.epoch)return;
  if(message.sequence<=this.outbox.ackSequence)return;
  this.acks.set(message.sequence,message);
  while(this.acks.has(this.outbox.ackSequence+1)) {
   const ack=this.acks.get(this.outbox.ackSequence+1),entry=this.outbox.entry(ack.sequence);
   if(!entry)throw Error('Receiver acknowledged unknown durable frame');
   this.outbox.acknowledge(ack);this.acks.delete(ack.sequence);this.sent.delete(ack.sequence);
   for(const profile of ack.profiles || [])this.profiles.set(profile.id,profile);
   for(const event of entry.frame.progress)if(event.type==='lifeStarted')this.fixture.readyLives.add(event.lifeId);
   for(const [casts,ok] of [[entry.frame.applied,true],[entry.frame.cancelled || [],false]])for(const cast of casts) {
    const request=[...this.requests.values()].find(r=>r.txId===cast.txId);
    if(!request)continue;
    const requestId=request.command.requestId,message=ok?undefined:'Target changed; booster returned';
    this.fixture.socketInputs?.result(request.playerId,requestId,ok,message);
    this.completed.set(requestId,{ok,message});this.requests.delete(requestId);
    while(this.completed.size>1024)this.completed.delete(this.completed.keys().next().value);
   }
  }
 }
 resend(at) {
  for(const sequence of this.outbox.pendingSequences().slice(0,4)) {
   if(at-(this.sent.get(sequence) ?? -Infinity)<1000)continue;
   this.sent.set(sequence,at);
   this.send(process.env.ROOM_BENCH_FRAME_WIRE==='json'
    ? {type:'serializedFrame',entry:this.outbox.serializedEntry(sequence)}
    : {type:'frame',entry:this.outbox.entry(sequence)});
  }
  for(const request of this.waiting.values())if(!request.response && at-(request.sentAt || -Infinity)>1000) {
   request.sentAt=at;this.send(request.message);
  }
 }
 tick(at=performance.now()) {
  this.resend(at);
  if(this.fault)throw this.fault;
  if(this.gate.blocked) {this.stats.pauses++;return false;}
  const started=performance.now(),wallAt=Date.now();
  const boundary=questBoundary.sample(this.fixture,this.lastWallAt,wallAt,this.sampledBoundary);
  if(boundary){
   this.pending=this.gate.advance(boundary,()=>{
    this.fixture.progressSecond=undefined;
    return {progress:boundary.progress,applied:[]};
   },()=>{this.sampledBoundary=boundary.boundaryAt;this.resend(performance.now());})
    .catch(error=>{this.fault=error;this.send({type:'fault',roomId:this.id,message:error.stack});});
   return true;
  }
  if(this.lastAt!==null)this.intervals.push(at-this.lastAt);this.lastAt=at;
  let result,reservations=[],appendAt;
  this.pending=this.gate.advance({at:wallAt},()=>{
   const room=this.fixture,arena=room.arena,applied=[],cancelled=[];
   for(const profile of this.profiles.values())room.lookup.set(profile.id,profile);this.profiles.clear();
   // Every mutation, including incoming cast responses, is inside this gate.
   for(const request of this.waiting.values()) {
    // A reservation delays only that cast. Other players and physics continue;
    // a late response is revalidated against the current life and item expiry.
    if(!request.response)continue;
    this.waiting.delete(request.command.requestId);
    const response=request.response,tx=response.tx;
    if(response.error) {
     this.stats.rejected++;this.requests.delete(request.command.requestId);
     reservations.push({rejected:request,message:response.error});continue;
    }
    if(!tx || !['RESERVED','APPLIED','REFUNDED'].includes(tx.status) || tx.profileId!==request.profileId || tx.lifeId!==request.lifeId ||
        tx.roomId!==this.id || tx.epoch!==this.epoch || tx.intent!==JSON.stringify(request.command))
     throw Error('Invalid reservation response for private room');
    if(tx.status!=='RESERVED') {
     const ok=tx.status==='APPLIED',message=ok?undefined:'Previously returned booster';
     this.completed.set(request.command.requestId,{ok,message});this.requests.delete(request.command.requestId);
     reservations.push({replayed:request,ok,message});continue;
    }
    request.txId=tx.txId;
    const cast={txId:tx.txId,profileId:request.profileId,lifeId:request.lifeId,boosterId:request.command.boosterId};
    let apply;
    try {
     if(arena.players.get(request.playerId)?.lifeId!==request.lifeId || (tx.expiresAt && tx.expiresAt<=wallAt))
      throw new BoosterError('Life or reserved item expired',409);
     apply=arena.prepareBooster(request.playerId,request.command,at);
    }catch(error){if(!(error instanceof BoosterError))throw error;cancelled.push(cast);this.stats.cancelled++;continue;}
    // An unexpected error AFTER mutation is terminal, never relabeled as a
    // harmless cancellation. Recovery then uses only the prior durable prefix.
    apply();cast.mass=arena.players.get(request.playerId).mass;applied.push(cast);this.stats.applied++;
    this.stats.boosters[cast.boosterId]=(this.stats.boosters[cast.boosterId] || 0)+1;
   }
   for(let i=0;i<room.players.length;i++) {
    const p=room.players[i];
    if(p.dead){arena.resetPlayer(p,at);room.populate(p,i,at);this.stats.respawns++;}
   }
   room.socketInputs?.drain(at);
   const physics=performance.now();result=stepRoom(room,at,wallAt,room.profiles,35);
   room.phases.physics.push(performance.now()-physics);
   for(const request of this.commands.splice(0)) {
    try {
     arena.prepareBooster(request.playerId,request.command,at);
     const short=createHash('sha256').update(request.command.requestId).digest('hex').slice(0,32);
     request.txId=request.profileId+'_'+short;
     request.message={type:'reserve',roomId:this.id,epoch:this.epoch,requestId:request.command.requestId,
      profileId:request.profileId,input:{roomId:this.id,epoch:this.epoch,txId:request.txId,lifeId:request.lifeId,
       boosterId:request.command.boosterId,intent:JSON.stringify(request.command)}};
     this.waiting.set(request.command.requestId,request);reservations.push(request);
    }catch(error){
     if(!(error instanceof BoosterError))throw error;this.requests.delete(request.command.requestId);
     this.stats.rejected++;reservations.push({rejected:request,message:error.message});
    }
   }
   const frame={progress:result.progress.filter(e=>room.lookup.has(e.profileId) && e.type!=='boosterUsed'),applied,cancelled};
   appendAt=performance.now();this.privateTimes.push(appendAt-started);return frame;
  },entry=>{
   this.flushTimes.push(performance.now()-appendAt);
   const room=this.fixture,snapshotAt=performance.now(),snapshot=room.arena.snapshot(at,result.events,this.stats.ticks%20===0);
   snapshot.audioEvents=room.arena.audioEvents;snapshot.visualEvents=room.arena.combat.contacts;
   room.phases.snapshot.push(performance.now()-snapshotAt);
   for(const stream of room.clients){stream.publish(snapshot);this.stats.networkStates++;}
   this.lastPublished=entry;this.lastWallAt=wallAt;this.stats.ticks++;this.stats.maxOutbox=Math.max(this.stats.maxOutbox,this.outbox.frames.size);
   for(const request of reservations) {
    if(request.rejected)room.socketInputs?.result(request.rejected.playerId,request.rejected.command.requestId,false,request.message);
    else if(request.replayed)room.socketInputs?.result(request.replayed.playerId,request.replayed.command.requestId,request.ok,request.message);
    else {request.sentAt=performance.now();this.send(request.message);}
   }
   this.resend(performance.now());this.tickTimes.push(performance.now()-started);
  }).catch(error=>{this.fault=error;this.send({type:'fault',roomId:this.id,message:error.stack});});
  return true;
 }
 report() {
  return {id:this.id,...this.stats,pendingFrames:this.outbox.frames.size,pendingCasts:this.requests.size,
   active:this.fixture.players.filter(p=>!p.dead).length,parts:this.fixture.players.reduce((n,p)=>n+(p.dead?0:this.fixture.arena.bodies(p).length),0),
   intervalMs:summary(this.intervals),tickMs:summary(this.tickTimes),privateMutationMs:summary(this.privateTimes),
   journalCommitWallMs:summary(this.flushTimes),
   physicsMs:summary(this.fixture.phases.physics),snapshotMs:summary(this.fixture.phases.snapshot),
   network:this.fixture.metrics,inputs:this.fixture.socketInputs?.metrics,fault:this.fault?.message};
 }
 async close(){await this.pending;await this.outbox.close();}
}
module.exports={DurableRoom};
