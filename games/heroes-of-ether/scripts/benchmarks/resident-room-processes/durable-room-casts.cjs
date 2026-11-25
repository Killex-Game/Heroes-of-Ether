'use strict';
const {BoosterError}=require('../../../src/server/boosters/booster-catalog');
class DurableRoomCasts {
  constructor(room,send){
    this.room=room;this.send=send;this.requests=new Map();this.replies=[];this.completed=new Map();this.locks=new Map();
    this.metrics={submitted:0,applied:0,rejected:0,replays:0,lockPauses:0,maxPending:0};
    this.lockDurations=[];this.ackLatencies=[];this.applyLatencies=[];
  }
  get locked(){return false;}
  request(player,command){
    if(!this.room.frameOwner?.capturing)throw Error('Input outside private frame');
    if(typeof command.requestId!=='string' || !/^[a-zA-Z0-9_-]{16,40}$/.test(command.requestId))throw new BoosterError('Invalid cast ID',400);
    const signature=JSON.stringify(command),pending=this.requests.get(command.requestId),done=this.completed.get(command.requestId);
    if(pending || done){
      const previous=pending || done;
      if(previous.playerId!==player.id || previous.lifeId!==player.lifeId || previous.signature!==signature)throw new BoosterError('Conflicting cast ID',409);
      if(pending)this.send(pending.intent);
      else this.room.frameOwner.defer(()=>{this.metrics.replays++;this.room.socketInputs?.result(player.id,command.requestId,done.applied,done.message);});
      return;
    }
    if(this.requests.size>=240)throw new BoosterError('Pending cast limit',409);
    this.room.arena.prepareBooster(player.id,command,performance.now());
    for(const [id,done]of this.completed)if(done.playerId===player.id && done.lifeId!==player.lifeId)this.completed.delete(id);
    const input=structuredClone(command),at=performance.now(),txId=player.profileId+'_'+input.requestId;
    const intent={type:'residentReserve',roomId:this.room.id,epoch:this.room.epoch,playerId:player.id,
      profileId:player.profileId,lifeId:player.lifeId,txId,boosterId:input.boosterId,intent:JSON.stringify(input),requestId:input.requestId};
    this.requests.set(input.requestId,{playerId:player.id,profileId:player.profileId,lifeId:player.lifeId,
      command:input,txId,intent,signature,at,retryAt:at+1000});
    this.metrics.submitted++;this.metrics.maxPending=Math.max(this.metrics.maxPending,this.requests.size);
    // A reservation is only a reversible hold. No effect or successful client
    // response is sent until an applied/cancelled frame becomes durable.
    this.send(intent);
  }
  receive(message){
    if(message.roomId!==this.room.id || message.epoch!==this.room.epoch)return;
    if(!['residentReserved','residentRejected'].includes(message.type))return;
    const request=this.requests.get(message.requestId);
    if(!request)return;
    if(message.txId!==request.txId)throw Error('Reservation identity changed');
    if(this.replies.length>=1024)throw Error('Reservation reply limit');
    this.replies.push(structuredClone(message));
  }
  retryPending(at){for(const request of this.requests.values())if(at>=request.retryAt){this.send(request.intent);request.retryAt=at+1000;}}
  beforeFrame(at){
    for(const response of this.replies.splice(0)){
      const request=this.requests.get(response.requestId);if(!request || request.resolving)continue;
      request.resolving=true;
      if(response.type==='residentRejected'){
        this.room.frameOwner.defer(()=>{this.metrics.rejected++;this.room.socketInputs?.result(request.playerId,response.requestId,false,response.message);this.requests.delete(response.requestId);});
        continue;
      }
      const tx=response.reservation;
      if(!tx || tx.status!=='RESERVED' || tx.txId!==request.txId || tx.profileId!==request.profileId ||
        tx.roomId!==this.room.id || tx.epoch!==this.room.epoch || tx.lifeId!==request.lifeId ||
        tx.boosterId!==request.command.boosterId || tx.intent!==request.intent.intent)throw Error('Invalid durable reservation');
      const p=this.room.arena.players.get(request.playerId);
      let applied=false,message;
      try{
        if(!p || p.dead || p.lifeId!==request.lifeId || (tx.expiresAt!==undefined && tx.expiresAt<=this.room.wallNow()))
          throw new BoosterError('Life or reserved lot ended',409);
        this.room.arena.prepareBooster(request.playerId,request.command,at)();applied=true;
      }catch(error){if(!(error instanceof BoosterError))throw error;message=error.message;}
      this.room.frameOwner.outcome({txId:tx.txId,profileId:tx.profileId,lifeId:tx.lifeId,boosterId:tx.boosterId,
        ...(applied?{mass:p.mass}:{})},applied);
      this.room.frameOwner.defer(()=>{
        if(applied){this.metrics.applied++;this.room.metrics.boosters[tx.boosterId]=(this.room.metrics.boosters[tx.boosterId]||0)+1;
          this.ackLatencies.push(performance.now()-request.at);this.applyLatencies.push(performance.now()-request.at);}
        else this.metrics.rejected++;
        this.completed.set(response.requestId,{playerId:request.playerId,lifeId:request.lifeId,signature:request.signature,applied,message});
        this.room.socketInputs?.result(request.playerId,response.requestId,applied,message);
        this.requests.delete(response.requestId);
      });
    }
  }
}
module.exports={DurableRoomCasts};
