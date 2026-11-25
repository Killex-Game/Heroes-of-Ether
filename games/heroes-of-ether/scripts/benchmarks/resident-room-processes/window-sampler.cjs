'use strict';
const {summary}=require('./room-fixture.cjs');
const delta=(now={},before={})=>Object.fromEntries(Object.entries(now).map(([key,value])=>[key,value-(before[key]||0)]));
class RoomWindowSampler {
 constructor(){this.previous=new Map();}
 sample(room,at){
  const now={at,ticks:room.metrics.ticks,times:room.times.length,intervals:room.intervals.length,
   accepted:{...room.socketInputs?.metrics.accepted},boosters:{...room.metrics.boosters},
   ack:room.casts?.ackLatencies.length||0,apply:room.casts?.applyLatencies.length||0};
  const old=this.previous.get(room.id);if(old&&at<=old.at)throw Error('Non-increasing sample clock');this.previous.set(room.id,now);if(!old)return null;
  const elapsedMs=at-old.at;
  return {id:room.id,elapsedMs,ticks:now.ticks-old.ticks,updatesHz:(now.ticks-old.ticks)*1000/elapsedMs,
   workMs:summary(room.times.slice(old.times)),intervalMs:summary(room.intervals.slice(old.intervals)),
   accepted:delta(now.accepted,old.accepted),boosters:delta(now.boosters,old.boosters),
   actionMs:summary((room.casts?.ackLatencies||[]).slice(old.ack)),
   applyMs:summary((room.casts?.applyLatencies||[]).slice(old.apply)),pending:room.frameOwner?room.frameOwner.outbox.frames.size:room.outbox.length};
 }
}
class PeerWindowSampler {
 constructor(){this.clients=new Map();this.gaps=[];this.states=0;this.previous={at:0,offset:0,states:0,latency:0,successLatency:0,failures:0};}
 register(id){if(this.clients.has(id))throw Error('Duplicate peer sampler client');this.clients.set(id,null);}
 observe(id,message,at){if(message.type!=='state'||!message.stateSequence)return;const old=this.clients.get(id);if(old!==undefined&&old!==null)this.gaps.push(at-old);this.clients.set(id,at);this.states++;}
 begin(at,inputs,failures){this.previous={at,offset:this.gaps.length,states:this.states,latency:inputs?.latencies.length||0,successLatency:inputs?.successLatencies.length||0,failures};}
 sample(at,inputs,failures){const p=this.previous,elapsedMs=at-p.at;if(elapsedMs<=0)throw Error('Non-increasing sample clock');
  const result={elapsedMs,states:this.states-p.states,clientCount:this.clients.size,maxSilenceMs:Math.max(0,...[...this.clients.values()].map(last=>at-(last??p.at))),gapMs:summary(this.gaps.slice(p.offset)),
   actionMs:summary((inputs?.latencies||[]).slice(p.latency)),successfulActionMs:summary((inputs?.successLatencies||[]).slice(p.successLatency)),failures:failures-p.failures};
  this.begin(at,inputs,failures);return result;
 }
}
function assessWindow(row){
 const problems=[];if(!row.rooms.length||!row.peers.length)problems.push('missing-samples');for(const room of row.rooms){if(!(room.updatesHz>=19))problems.push(room.id+':cadence');if(room.intervalMs.p95>100)problems.push(room.id+':interval');
  if(!(room.accepted.feed>0)||!(room.accepted.split>0))problems.push(room.id+':accepted-inputs');if(Object.values(room.boosters).reduce((s,n)=>s+n,0)<1)problems.push(room.id+':boosters');}
 for(const[ordinal,peer]of row.peers.entries()){if(peer.states<1||peer.gapMs.p99>150||peer.maxSilenceMs>500)problems.push('peer'+ordinal+':state-gap');if(peer.actionMs.p95>500)problems.push('peer'+ordinal+':action-delay');if(peer.failures)problems.push('peer'+ordinal+':decode');}
 if(row.lobby&&(row.lobby.latencyMs.p95>1000||Object.keys(row.lobby.errors).length))problems.push('lobby');
 if(row.errors)problems.push('writer');return {meetsTargets:problems.length===0,problems};
}
module.exports={RoomWindowSampler,PeerWindowSampler,assessWindow};
