'use strict';
// Isolated benchmark adapter. Production admission and routing are not supplied.
const {RoomOutbox}=require('../../../src/server/arena/resident/room-outbox');
const {RoomFrameGate}=require('../../../src/server/arena/resident/room-frame-gate');
const questBoundary=require('../../../src/server/arena/resident/room-quest-boundary');
class DurableRoomOwner {
  static async open(room,file,send,{onFault=()=>{}}={}){
    if(room.metrics.ticks || room.outbox.length || room.frameOwner)throw Error('Fresh room required');
    const outbox=await RoomOutbox.open({file,roomId:room.id,epoch:room.epoch});
    return new DurableRoomOwner(room,outbox,send,onFault);
  }
  constructor(room,outbox,send,onFault){
    this.room=room;this.outbox=outbox;this.send=send;this.capturing=null;this.inFlight=new Map();
    this.gate=new RoomFrameGate(outbox,{onFault});this.pending=null;this.frames=0;this.durableFrameMs=[];
    this.completedAt=0;this.boundaryThrough=0;this.currentWallAt=null;
    room.frameOwner=this;
  }
  defer(publish){if(!this.capturing)throw Error('Publication outside private frame');this.capturing.publish.push(publish);}
  recordProgress(events){if(!this.capturing)throw Error('Progress outside private frame');this.capturing.progress.push(...events.filter(e=>e.type!=='boosterUsed'));}
  outcome(cast,applied){if(!this.capturing)throw Error('Cast outside private frame');this.capturing[applied?'applied':'cancelled'].push(cast);}
  tick(at){
    this.resend(at);
    if(this.pending||this.gate.blocked)return false;
    let wallAt,sample;
    try{
      wallAt=this.room.wallNow();
      if(!Number.isSafeInteger(wallAt)||wallAt<this.completedAt)throw Error('Resident simulation clock moved backwards');
      sample=questBoundary.sample(this.room,this.completedAt,wallAt,this.boundaryThrough);
    }catch(error){this.gate.fail(error);return Promise.reject(error);}
    if(sample){
      // Preserve the last completed state before consuming post-cutoff inputs.
      // An ephemeral position-only prefix needs one timestamp anchor, not a
      // new journal record on every position update throughout the day.
      return this.track((async()=>{
        if(this.gate.lastAt<sample.at)await this.commit({progress:[],applied:[],cancelled:[],publish:[]},sample.at);
        const entry=await this.commit({...sample,cancelled:[],publish:[]},sample.at,'boundary',sample.boundaryAt);
        this.boundaryThrough=sample.boundaryAt;return entry;
      })());
    }
    const captured={progress:[],applied:[],cancelled:[],publish:[]},started=performance.now();
    this.capturing=captured;this.currentWallAt=wallAt;
    try{this.room.tick(at);}catch(error){this.capturing=null;this.gate.fail(error);return Promise.reject(error);}
    finally{this.currentWallAt=null;}
    this.capturing=null;
    this.completedAt=wallAt;
    // Positions are ephemeral, as in the canonical server. Frames with no
    // economic progress/outcome may publish without writing empty WAL entries.
    // A private error is still terminal; every paid effect remains journaled.
    if(this.gate.lastAt>=this.boundaryThrough&&!captured.progress.length&&!captured.applied.length&&!captured.cancelled.length){
      try{for(const publish of captured.publish)publish();return Promise.resolve(null);}
      catch(error){this.gate.fail(error);return Promise.reject(error);}
    }
    return this.track(this.commit(captured,wallAt,'tick',undefined,started));
  }
  commit(captured,at,kind='tick',boundaryAt,started=performance.now()){
    return this.gate.advance({at,kind,boundaryAt},()=>captured,entry=>{
      // The next frame remains blocked while these values are published.
      for(const publish of captured.publish)publish();
      this.frames++;this.durableFrameMs.push(performance.now()-started);
      this.send({type:'residentFrame',entry});this.inFlight.set(entry.frame.sequence,performance.now());
    });
  }
  track(result){
    this.pending=result.finally(()=>{this.pending=null;});
    return this.pending;
  }
  acknowledge(ack){
    const entry=this.outbox.entry(ack.sequence),changed=this.outbox.acknowledge(ack);
    if(changed){
      for(const event of entry.frame.progress)if(event.type==='lifeStarted')this.room.readyLives.add(event.lifeId);
      const lives=new Set(this.room.players.map(p=>p.lifeId));
      for(const life of this.room.readyLives)if(!lives.has(life))this.room.readyLives.delete(life);
      this.inFlight.delete(ack.sequence);
    }
    return changed;
  }
  resend(at){
    for(const sequence of this.outbox.pendingSequences().slice(0,4)){
      const sent=this.inFlight.get(sequence);
      if(sent!==undefined && at-sent<1000)continue;
      this.send({type:'residentFrame',entry:this.outbox.entry(sequence)});this.inFlight.set(sequence,at);
    }
  }
  async close(){await this.pending?.catch(()=>{});await this.outbox.close();}
}
module.exports={DurableRoomOwner};
