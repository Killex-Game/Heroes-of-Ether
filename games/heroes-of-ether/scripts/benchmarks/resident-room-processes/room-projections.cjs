"use strict";
// Isolated benchmark transport. These messages go only to the process already
// bound to this roster; no complete profiles, wallets or history cross the IPC.
const {roomProfile}=require('./room-profile.cjs');
class RoomProjections {
  constructor(store){this.store=store;this.rooms=new Map();this.error=null;this.metrics={messages:0,profiles:0,eventContexts:0};}
  bind(config,child){
    if(this.rooms.has(config.id)||!child||!Array.isArray(config.profiles)||config.profiles.length>30||
      new Set(config.profiles.map(p=>p.id)).size!==config.profiles.length)throw Error('Invalid projection owner');
    this.rooms.set(config.id,{epoch:config.epoch,child,ids:config.profiles.map(p=>p.id),previous:new Map(),sequence:0,events:undefined,initialized:false});
  }
  flush(){
    if(this.error)throw this.error;
    for(const [roomId,room]of this.rooms){
      if(!room.child.connected)continue;
      const updates=[],remember=[];
      for(const id of room.ids){
        const profile=this.store.byId(id);if(!profile)throw Error('Owned projection profile disappeared');
        const clan=this.store.data.clans[profile.clanId],appearance=this.store.arenaAppearance(profile),old=room.previous.get(id);
        if(old?.profile===profile&&old.clan===clan&&old.appearance===appearance)continue;
        updates.push({profile:roomProfile(profile),identity:this.store.identity(profile)});
        remember.push([id,{profile,clan,appearance}]);
      }
      const events=this.store.events?.data,changedEvents=!room.initialized||room.events!==events;
      if(!updates.length&&!changedEvents)continue;
      room.child.send({type:'roomProjection',roomId,epoch:room.epoch,sequence:++room.sequence,updates,
        ...(changedEvents?{events:events||null}:{})},error=>{if(error)this.error=error;});
      for(const [id,value]of remember)room.previous.set(id,value);
      room.events=events;room.initialized=true;
      this.metrics.messages++;this.metrics.profiles+=updates.length;if(changedEvents)this.metrics.eventContexts++;
    }
  }
}
function applyProjection(room,message){
  if(message.roomId!==room.id||message.epoch!==room.epoch||!Number.isSafeInteger(message.sequence)||message.sequence<1)
    throw Error('Invalid room projection envelope');
  if(message.sequence<=(room.projectionSequence||0))return false;
  if(!Array.isArray(message.updates)||new Set(message.updates.map(row=>row?.profile?.id)).size!==message.updates.length||
    message.updates.some(row=>!row?.profile||!room.lookup.has(row.profile.id)||!row.identity||
      !Number.isSafeInteger(row.profile.revision)||row.profile.revision<0))
    throw Error('Unowned room projection profile');
  room.identities ||= new Map();
  for(const {profile,identity}of message.updates){
    const old=room.lookup.get(profile.id);
    if(Number.isSafeInteger(old?.revision)&&profile.revision<old.revision)continue;
    room.lookup.set(profile.id,profile);room.identities.set(profile.id,identity);
    const player=room.players.find(p=>p.profileId===profile.id);
    if(player)Object.assign(player,identity,{quickSlots:profile.quickSlots});
  }
  if(Object.hasOwn(message,'events')){
    if(message.events){
      room.profiles.events ||= new (require('../../../src/server/events/event-manager').EventManager)({now:room.wallNow});
      room.profiles.events.data=message.events;
    }else room.profiles.events=undefined;
  }
  room.projectionSequence=message.sequence;
  return true;
}
module.exports={RoomProjections,applyProjection};
