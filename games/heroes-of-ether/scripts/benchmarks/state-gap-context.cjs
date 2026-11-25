"use strict";
// Preserve the original unfiltered gap samples. These bounded annotations help
// distinguish a respawn boundary from an unexplained interruption; neither is
// excluded from acceptance or reported as a proven cause by this probe.
function record(client, at, previousSerial, sequence) {
  if(client.last===null||at-client.last<=200)return;
  const end=client.lastLifeEndAt;
  client.longGaps.push({at,gapMs:at-client.last,roomId:client.roomId,slot:client.indexInRoom,
    stateSequence:sequence,spawnChanged:previousSerial!==undefined&&client.serial!==previousSerial,
    spansLifeEnd:Number.isFinite(end)&&end>=client.last&&end<=at,
    lifeEndAgoMs:Number.isFinite(end)?at-end:null,pendingActions:client.requests.size,
    outgoingBytes:client.ws.bufferedAmount});
  client.longGaps.sort((a,b)=>b.gapMs-a.gapMs);client.longGaps.length=Math.min(client.longGaps.length,8);
}
function combine(samples){return samples.flatMap(s=>s.longestStateGaps||[]).sort((a,b)=>b.gapMs-a.gapMs).slice(0,32);}
module.exports={record,combine};
