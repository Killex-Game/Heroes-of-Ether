'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const wire=require('../../public/shared/arena-wire');
function analyze(directory){
  const phases=[];
  for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.ndjson')).sort()){
    const before=new wire.Decoder(),after=new wire.Decoder();
    let originalBytes=0,candidateBytes=0,foodBytesBefore=0,foodBytesAfter=0,frames=0;
    for(const line of fs.readFileSync(path.join(directory,file),'utf8').trim().split('\n').filter(Boolean)){
      const packet=JSON.parse(line),candidate=structuredClone(packet);
      for(const row of candidate.foodDelta?.upsert||[])if(row.length>3)row[3]=wire.packFoodMetadata(row[3]);
      const bytes=Buffer.byteLength(JSON.stringify(packet)),next=Buffer.byteLength(JSON.stringify(candidate));
      // Captures are sparse and do not contain player motion baselines. Only
      // replay food here; the live stream tests cover complete decoded states.
      before.decode({foodDelta:packet.foodDelta});after.decode({foodDelta:candidate.foodDelta});
      assert.deepEqual([...after.food],[...before.food]);
      const a={...packet},b={...candidate};delete a.foodDelta;delete b.foodDelta;assert.deepEqual(b,a);
      originalBytes+=bytes;candidateBytes+=next;frames++;
      foodBytesBefore+=Buffer.byteLength(JSON.stringify(packet.foodDelta||{}));
      foodBytesAfter+=Buffer.byteLength(JSON.stringify(candidate.foodDelta||{}));
    }
    phases.push({file,frames,originalBytes,candidateBytes,savedBytes:originalBytes-candidateBytes,
      reductionPercent:100*(1-candidateBytes/originalBytes),foodBytesBefore,foodBytesAfter});
  }
  return {scope:'Offline sparse packet replay; exact UTF-8 bytes, food decoding equality, all other fields unchanged. Player motion baselines absent; not whole-state replay, live bandwidth or capacity.',
    defaultProtocol:wire.PROTOCOL,candidateProtocol:wire.SCHEMA_PROTOCOL,phases};
}
if(require.main===module)console.log(JSON.stringify(analyze(process.argv[2]),null,2));
module.exports={analyze};
