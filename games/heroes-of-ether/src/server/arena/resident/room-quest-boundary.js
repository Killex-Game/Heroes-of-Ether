'use strict';
const {period}=require('../../clans/daily-quests/engine');
function nextAfter(at){const day=period(at);return day.active?day.end:day.nextStart;}
function crossed(previous,at){
 if(!previous || at<previous)return null;
 const edge=nextAfter(previous);
 if(at<edge)return null;
 // A simulation suspended across several windows must recover its durable
 // prefix and close; do not invent activity across a long clock discontinuity.
 if(at>=nextAfter(edge))throw Error('Resident clock crossed multiple quest windows');
 return edge;
}
function sample(room,previous,at,alreadySampled){
 const boundaryAt=crossed(previous,at);
 if(!boundaryAt || boundaryAt===alreadySampled)return null;
 const progress=[];
 for(const p of room.arena.players.values())if(!p.dead && !p.isRemnant && p.profileId)
  progress.push({type:'clanFoodSample',profileId:p.profileId,lifeId:p.lifeId,clanFood:p.clanFoodCount});
 return {at:previous,kind:'boundary',boundaryAt,progress,applied:[]};
}
function validate(room,frame){
 if(room.deadlineProtocol!==1)return;
 if(frame.kind==='boundary'){
  if(!room.sequence || frame.at!==room.at || frame.boundaryAt!==nextAfter(room.at) ||
    frame.boundaryAt===(room.boundaryThrough || 0) || frame.applied.length || frame.cancelled?.length ||
    frame.progress.length>room.profiles.length || new Set(frame.progress.map(e=>e.profileId)).size!==frame.progress.length ||
    frame.progress.some(e=>e.type!=='clanFoodSample' || typeof e.lifeId!=='string' ||
      !Number.isSafeInteger(e.clanFood) || e.clanFood<0))throw Error('Invalid resident quest boundary sample');
 }else if(room.sequence){
  const edge=crossed(room.at,frame.at);
  if(edge && room.boundaryThrough!==edge)throw Error('Resident quest boundary is missing from durable prefix');
 }
}
module.exports={nextAfter,crossed,sample,validate};
