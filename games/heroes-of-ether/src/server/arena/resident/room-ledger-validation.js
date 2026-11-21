"use strict";
const records=require('./room-cast-records');
const integer=value=>Number.isSafeInteger(value) && value>=0;
const object=value=>value && typeof value==='object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const digest=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
function validate(world) {
  if(world.version!==15 || !object(world.residentRooms) || Object.keys(world.residentRooms).length>256)
    throw Error('Invalid experimental resident world');
  const profiles=new Map(Object.values(world.profiles).map(p=>[p.id,p])),owned=new Set();
  for(const [key,room] of Object.entries(world.residentRooms)) {
    if(!object(room) || key!==room.roomId || !records.keyOK(key) || !records.keyOK(room.epoch) ||
        !['ACTIVE','FENCED','CLOSED'].includes(room.status) || !integer(room.at) || !integer(room.sequence) ||
        (room.sequence===0?room.digest!==null:!digest(room.digest)) || !object(room.frameReceipts) ||
        !Array.isArray(room.profiles) || !room.profiles.length || room.profiles.length>35 ||
        new Set(room.profiles).size!==room.profiles.length || room.profiles.some(id=>!profiles.has(id)))
      throw Error('Invalid durable resident room');
    if(room.deadlineProtocol!==undefined && (room.deadlineProtocol!==1 || !integer(room.boundaryThrough) ||
       (room.boundaryThrough && (!room.sequence ||
        room.boundaryThrough!==require('./room-quest-boundary').nextAfter(room.boundaryThrough-1) ||
        room.boundaryThrough>require('./room-quest-boundary').nextAfter(room.at)))))
      throw Error('Invalid resident daily boundary protocol');
    const first=Math.max(1,room.sequence-255);
    if(Object.keys(room.frameReceipts).length!==Math.min(256,room.sequence))throw Error('Resident receipt prefix gap');
    for(let sequence=first;sequence<=room.sequence;sequence++)
      if(!digest(room.frameReceipts[sequence]))throw Error('Resident receipt prefix gap');
    if(room.sequence && room.frameReceipts[room.sequence]!==room.digest)throw Error('Resident prefix digest differs');
    if(room.status!=='CLOSED')for(const id of room.profiles) {
      if(owned.has(id))throw Error('Profile has multiple resident owners');owned.add(id);
    }
  }
  for(const p of profiles.values()) {
    if(p.residentCasts===undefined)continue;
    if(!object(p.residentCasts) || Object.keys(p.residentCasts).length>8)throw Error('Invalid resident reservation index');
    for(const [txId,pending] of Object.entries(p.residentCasts)) {
      const tx=records.read(p,txId),room=world.residentRooms[tx?.roomId];
      if(pending!==true || !tx || tx.status!=='RESERVED' || !room || room.status==='CLOSED' ||
          tx.epoch!==room.epoch || !room.profiles.includes(p.id) || !txId.startsWith(p.id+'_') ||
          !records.keyOK(tx.lifeId) || !records.keyOK(tx.boosterId) || !integer(tx.createdAt) ||
          typeof tx.intent!=='string' || !tx.intent || tx.intent.length>4096 ||
          (tx.boosterId==='easter_egg' && (!integer(tx.expiresAt) || (tx.expiresAt+10800000)%86400000)))
        throw Error('Invalid durable resident reservation');
    }
  }
}
module.exports={validate};
