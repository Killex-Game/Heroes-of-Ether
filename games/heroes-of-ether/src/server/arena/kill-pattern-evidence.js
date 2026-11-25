"use strict";
const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fraction=n=>Number.isFinite(n)&&n>=.95&&n<=1;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function validate(c) {
  const e=c?.patternEvidence;
  const bad=()=>{throw Error('Повреждены материалы проверки повторяемости Kill.');};
  if(!c||c.version!==1||!/^[a-f0-9-]{36}$/.test(c.id||'')||!['new','confirmed','dismissed'].includes(c.status)||
    !integer(c.createdAt)||c.reason!=='arena-repeated-patterns'||c.features!==null||c.modelReady!==false||c.modelScore!==null||
    !Array.isArray(c.windows)||c.windows.length||e?.version!==1||e.domain!=='arena-patterns-v1')bad();
  const times=(start,end)=>integer(start)&&integer(end)&&end>start&&end<=c.createdAt;
  if(e.kind==='manual-cadence') {
    if(typeof e.command!=='string'||!(/^(split|usePetBooster|useAccessoryBooster|booster:[a-z0-9_]{1,60})$/).test(e.command)||
      !Array.isArray(e.samples)||e.samples.length!==3)bad();
    let end=0;
    for(const w of e.samples) {
      if(!w||!times(w.start,w.end)||w.start<end||w.end-w.start<60000||!integer(w.count,13,257)||
        !integer(w.medianIntervalMs,100,5000)||!fraction(w.regularFraction)||!Number.isFinite(w.toleranceMs)||
        w.toleranceMs<8||w.toleranceMs>75||!sha(w.eventsSha256))bad();end=w.end;
    }
  } else if(e.kind==='repeated-route') {
    if(!times(e.start,e.end)||e.end-e.start<120000||e.cycles!==4||!integer(e.pointsPerCycle,3,64)||
      !integer(e.cycleMs,1)||!Number.isFinite(e.toleranceMs)||e.toleranceMs<50||!fraction(e.regularFraction)||
      !sha(e.eventsSha256)||!Array.isArray(e.route)||e.route.length!==e.pointsPerCycle)bad();
    let last=-1;
    for(const p of e.route){if(!p||!integer(p.x)||!integer(p.y)||!integer(p.offsetMs)||p.offsetMs<=last||p.offsetMs>=e.cycleMs)bad();last=p.offsetMs;}
  } else bad();
  if(c.status!=='new'&&(!integer(c.reviewedAt)||c.reviewedAt<c.createdAt||typeof c.reviewedBy!=='string'||
    typeof c.reviewReason!=='string'||c.reviewReason.length>500))bad();
}
module.exports={validate};
