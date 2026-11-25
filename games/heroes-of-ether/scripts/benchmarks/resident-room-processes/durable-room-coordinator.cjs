'use strict';
const {RoomProfileLedger}=require('../../../src/server/arena/resident/room-profile-ledger');
class DurableRoomCoordinator {
  constructor(store,tokens){this.store=store;this.tokens=tokens;this.ledger=new RoomProfileLedger(store);this.owners=new Map();this.pending=new Set();this.errors=[];}
  async claim(child,config){
    if(this.owners.has(config.id))throw Error('Room already claimed');
    const players=new Map(config.profiles.map((p,i)=>['room-'+config.id+'-player-'+i,p.id]));
    if(players.size!==config.profiles.length || players.size>30)throw Error('Invalid room roster');
    await this.ledger.claim({roomId:config.id,epoch:config.epoch,profileIds:config.profiles.map(p=>p.id)},child);
    this.owners.set(config.id,{child,epoch:config.epoch,players});
  }
  send(child,message){if(child.connected)child.send(message);}
  receive(child,message){
    if(!['residentReserve','residentFrame'].includes(message.type))return false;
    const roomId=message.type==='residentFrame'?message.entry?.frame?.roomId:message.roomId;
    const epoch=message.type==='residentFrame'?message.entry?.frame?.epoch:message.epoch;
    const owner=this.owners.get(roomId);
    if(!owner || owner.child!==child || owner.epoch!==epoch)throw Error('Unowned resident message');
    let operation;
    if(message.type==='residentFrame'){
      operation=this.ledger.accept(child,message.entry).then(ack=>this.send(child,{type:'residentAck',...ack}));
    }else{
      if(owner.players.get(message.playerId)!==message.profileId || message.txId!==message.profileId+'_'+message.requestId)
        throw Error('Unowned resident request');
      const envelope={roomId,epoch,requestId:message.requestId,txId:message.txId};
      operation=this.ledger.reserve(child,this.tokens.get(message.profileId),message)
        .then(reservation=>this.send(child,{type:'residentReserved',...envelope,reservation}),
          error=>this.send(child,{type:'residentRejected',...envelope,message:error.message}));
    }
    this.pending.add(operation);
    operation.catch(error=>{this.errors.push(error);if(child.connected)child.disconnect();})
      .finally(()=>this.pending.delete(operation));
    return true;
  }
  async idle(){while(this.pending.size)await Promise.allSettled([...this.pending]);await this.ledger.chain;if(this.errors.length)throw this.errors[0];}
}
module.exports={DurableRoomCoordinator};
