'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const wire=require('../../public/shared/arena-wire');
const {ArenaStateStream}=require('../../src/server/arena/state-stream');
const {ArenaStateWorkers}=require('../../src/server/arena/state-workers');
function client(protocol,pool){
  const ws={readyState:1,bufferedAmount:0,protocol,playerId:'p'},decoder=new wire.Decoder(),raw=[],states=[];
  const send=(_,data)=>{const packet=JSON.parse(data);raw.push(packet);const decoded=decoder.decode(packet);
    delete decoded.foodDelta;states.push(structuredClone(decoded));};
  const stream=pool?pool.createStream('room',ws,send):new ArenaStateStream(ws,send,()=>0);
  return {ws,decoder,raw,states,stream};
}
function snapshot(tick,ether){return {type:'state',tick,world:{width:6000,height:4000},
  players:[{id:'p',name:'Путник 😀',x:100,y:100,mass:100,radius:20,parts:[{id:'part',x:100,y:100,mass:100,radius:20}]}],
  ether,projectiles:[],hazards:[],events:[],audioEvents:[],visualEvents:[]};}
test('food schema preserves every subset, birth precision and extension metadata',()=>{
  const base={value:5,radius:6,color:'#bfa3ff',artValue:3,ejected:true,birth:{tick:9,x:1.2345678901234,y:-3.4567890123456}};
  for(let mask=0;mask<64;mask++){
    const meta=Object.fromEntries(Object.entries(base).filter((_,i)=>mask&(1<<i)));
    assert.deepEqual(wire.unpackFoodMetadata(wire.packFoodMetadata(meta)),meta);
  }
  for(const meta of [{...base,extra:'расширение 😀'},{birth:{...base.birth,other:3}},{birth:[1,2,3]},{birth:null},{value:0,ejected:false}])
    assert.deepEqual(wire.unpackFoodMetadata(wire.packFoodMetadata(meta)),meta);
  for(const bad of [[128],[64],[1],[0,1],[96,[1,2]],[96,[1,'x',3]]])assert.throws(()=>wire.unpackFoodMetadata(bad));
});
test('v9 and v8 decode identically through metadata deletion, skipped ACKs, movement and reconnect',()=>{
  const a=client(wire.PROTOCOL),b=client(wire.SCHEMA_PROTOCOL),oldFrames=[];
  const birth={tick:1,x:12.3456789,y:98.7654321};
  for(let tick=0;tick<30;tick++){
    const ether=tick===21?[]:[{id:'w1',x:100+tick,y:100,value:5,radius:6,color:'#bfa3ff',
      ...(tick<9?{artValue:3,ejected:true,birth}:{}),...(tick>12&&tick<20?{extra:'😀'}:{})}];
    const frame=snapshot(tick,ether);
    for(const c of [a,b]){c.stream.publish(frame);if(tick%5===0)c.stream.acknowledge(c.stream.sequence);}
    assert.deepEqual(b.states,a.states);assert.deepEqual([...b.decoder.food],[...a.decoder.food]);
    if(tick===0){assert(!Array.isArray(a.raw[0].foodDelta.upsert[0][3]));assert(Array.isArray(b.raw[0].foodDelta.upsert[0][3]));}
    oldFrames.push(structuredClone(b.states.at(-1)));
    if(tick===29){const join=client(wire.SCHEMA_PROTOCOL);join.stream.publish(frame);
      a.stream.acknowledge(a.stream.sequence);b.stream.acknowledge(b.stream.sequence);
      assert.deepEqual([...join.decoder.food],[...b.decoder.food]);}
  }
  const before=structuredClone(b.states);b.stream.publish(snapshot(31,[]));assert.deepEqual(b.states.slice(0,before.length),before);
});
test('schema works in worker encoding, separate room histories and lane recovery',async t=>{
  const pool=new ArenaStateWorkers({maxWorkers:1,onError:()=>{}});t.after(()=>pool.close());
  const a=client(wire.SCHEMA_PROTOCOL,pool),b=client(wire.SCHEMA_PROTOCOL),legacy=client(wire.PROTOCOL,pool);
  async function until(fn){const deadline=Date.now()+5000;while(!fn()){if(Date.now()>deadline)throw Error('Worker timeout');await delay(5);}}
  for(let tick=1;tick<=5;tick++){
    const frame=snapshot(tick,[{id:'w1',x:100+tick,y:100,value:5,radius:6,color:'#bfa3ff',birth:{tick:1,x:100.12345678,y:100}}]);
    for(const c of [a,b,legacy]){c.stream.publish(frame);}
    await until(()=>a.raw.at(-1)?.tick===tick&&legacy.raw.at(-1)?.tick===tick);
    assert.deepEqual(a.raw.at(-1),b.raw.at(-1));assert.deepEqual(a.states.at(-1),legacy.states.at(-1));
    for(const c of [a,b,legacy])c.stream.acknowledge(c.stream.sequence);
  }
  await a.stream.room.lane.worker.terminate();await until(()=>pool.stats.failures===1);
  assert.equal(a.raw.at(-1).stateReset,true);assert.deepEqual([...a.decoder.food],[...b.decoder.food]);
});
