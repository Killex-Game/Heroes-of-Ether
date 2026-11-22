"use strict";
// Historical gift observations have a different feature domain from arena keys.
// Keep unreviewed evidence for humans; never inject it into the booster model.
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
function validate(c){
 const g=c?.giftEvidence;
 if(!c||c.version!==1||!/^[a-f0-9-]{36}$/.test(c.id||'')||!['new','confirmed','dismissed'].includes(c.status)||
  !integer(c.createdAt)||c.reason!=='gift-dispatch-pattern'||c.features!==null||c.modelReady!==false||c.modelScore!==null||
  !Array.isArray(c.windows)||c.windows.length!==0||!g||g.version!==1||g.domain!=='gift-dispatch-v1'||
  !/^[a-f0-9]{64}$/.test(g.sourceSha256||'')||!/^[a-f0-9]{64}$/.test(g.eventsSha256||'')||
  !integer(g.start)||!integer(g.end)||g.end<g.start||!integer(g.count,1)||!integer(g.recipients,1)||g.recipients>g.count||
  !integer(g.longestSeries,1)||g.longestSeries>g.count||!integer(g.medianIntervalMs)||!integer(g.peakPerMinute,1)||
  !Array.isArray(g.relatedIds)||g.relatedIds.length>8||g.relatedIds.some(id=>!/^[a-f0-9-]{36}$/.test(id))||
  (c.status!=='new'&&(!integer(c.reviewedAt)||c.reviewedAt<c.createdAt||typeof c.reviewedBy!=='string'||typeof c.reviewReason!=='string'||c.reviewReason.length>500)))
  throw Error('Повреждены материалы проверки подарков Kill.');
}
function register(world,entries,at){
 if(!Array.isArray(entries)||entries.length>100||!integer(at))throw Error('Invalid evidence batch');
 const profiles={...world.profiles},seen=new Set(),added=[],skipped=[];
 for(const entry of entries){
  if(!entry||seen.has(entry.playerId))throw Error('Duplicate evidence player');seen.add(entry.playerId);
  const key=Object.keys(profiles).find(key=>profiles[key].id===entry.playerId),p=profiles[key];
  if(!p||p.testBot)throw Error('Evidence requires an existing real player');
  const record={...entry.record,createdAt:at,status:'new'};validate(record);
  if(p.kill?.id===record.id){skipped.push({id:p.id,reason:'already-recorded'});continue;}
  if(p.kill?.status==='new')throw Error('An open case already exists; preserve it before adding evidence');
  profiles[key]={...p,revision:p.revision+1,kill:record};added.push(p.id);
 }
 return {world:added.length?{...world,profiles}:world,added,skipped};
}
module.exports={validate,register};
