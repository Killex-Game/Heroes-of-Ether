"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {CircleIndex}=require('../../src/server/arena/spatial-collision-index');
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation');
const seeded=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);

test('reset food index removes stale cells and epochs across growth, shrink, overflow coordinates and failed bounds',()=>{
  const reused=new CircleIndex([],64),random=seeded(9),saved=[];
  for(let frame=0;frame<120;frame++){
    const count=[0,1,31,32,33,129,512,9000][frame%8],size=[64,128,256][frame%3],centers=frame%2===0;
    const rows=Array.from({length:count},(_,id)=>({id,x:(random()-.5)*size*140000,y:(random()-.5)*size*140000,radius:random()*20}));
    reused.reset(rows,size,centers);const fresh=new CircleIndex(rows,size,centers);
    if(frame%7===0)reused.querySerial=0xfffffffe;
    const queries=rows.slice(0,20).map(row=>({...row,radius:100}));
    for(const start of [0,1,31,32,33,129,9000])assert.deepEqual(reused.queryMany(queries,start),fresh.queryMany(queries,start));
    const retained=reused.queryMany(queries);saved.push([retained,structuredClone(retained)]);
    assert(reused.bucketPool.length<=4096);
    if(frame%11===0){assert.throws(()=>reused.reset([{x:NaN,y:0,radius:1}]),RangeError);reused.reset([],size,centers);assert.deepEqual(reused.query({x:0,y:0,radius:1}),[]);}
  }
  for(const [actual,expected]of saved)assert.deepEqual(actual,expected,'returned query arrays retain their original objects');
});

test('repeated food collection equals linear search through moving W particles, replenishment and the index threshold',()=>{
  for(let seed=1;seed<=16;seed++){
    const random=seeded(seed),arena=new Arena({etherCount:0,random}),linear=new Arena({etherCount:0,spatialIndex:false});
    for(let i=0;i<12;i++){
      const p=arena.addPlayer(0,'p'+i);p.level=501;p.outfit=i%2?{bow:'novice_bow'}:{};
      p.parts=Array.from({length:4},(_,j)=>({id:`${i}-${j}`,x:random()*1500,y:random()*1500,mass:2000,radius:radiusForMass(2000)}));
      arena.syncParts(p);
    }
    linear.players=structuredClone(arena.players);
    for(let frame=0;frame<12;frame++){
      const count=[128,700,127,129][frame%4];
      const food=Array.from({length:count},(_,i)=>({id:`${frame}-${i}`,x:random()*1800,y:random()*1800,value:1+Math.floor(random()*30),
        ...(i%2?{ejected:true,sourceId:'p'+i%12,sourcePickupAt:2500}:{}),...(i%3?{radius:5.5}:{})}));
      arena.ether=structuredClone(food);linear.ether=structuredClone(food);
      const at=1000+frame*250;arena.collectEther(at);linear.collectEther(at);
      assert.deepEqual(arena.ether,linear.ether,`food ${seed}/${frame}`);
      assert.deepEqual(arena.players,linear.players,`players ${seed}/${frame}`);
      assert.deepEqual(arena.progressEvents,linear.progressEvents,`progress ${seed}/${frame}`);
    }
  }
});
