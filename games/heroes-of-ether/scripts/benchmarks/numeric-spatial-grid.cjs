"use strict";
// Compare a supplied baseline and a source transform without changing the game.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const file=require.resolve('../../src/server/arena/spatial-collision-index');
function candidateSource(source){
  const replacements=[
    ['this.cells = new Map();','this.cells = new Map(); this.wideCells = new Map();'],
    [`let column = this.cells.get(x);
        if (!column) this.cells.set(x, (column = new Map()));
        let bucket = column.get(y);
        if (!bucket) column.set(y, (bucket = []));`,
    `let bucket;
        if(x>=-32768&&x<=32767&&y>=-32768&&y<=32767){
          const key=(x<<16)|(y&65535);bucket=this.cells.get(key);
          if(!bucket)this.cells.set(key,(bucket=[]));
        }else{
          let column=this.wideCells.get(x);
          if(!column)this.wideCells.set(x,(column=new Map()));
          bucket=column.get(y);if(!bucket)column.set(y,(bucket=[]));
        }`],
    ['for (const column of this.cells.values())\n        for (const bucket of column.values()) bucket.visited = 0;',
     'for (const bucket of this.cells.values()) bucket.visited = 0;\n      for (const column of this.wideCells.values())\n        for (const bucket of column.values()) bucket.visited = 0;'],
    ['const bucket = this.cells.get(x)?.get(y);',
     'const bucket = x>=-32768&&x<=32767&&y>=-32768&&y<=32767 ? this.cells.get((x<<16)|(y&65535)) : this.wideCells.get(x)?.get(y);'],
  ];
  source=source.replace(/\r\n/g,'\n');
  for(const [from,to] of replacements){assert.equal(source.split(from).length,2,'single exact source match');source=source.replace(from,to);}
  return source;
}
function load(source){const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(source,file);return m.exports;}
const source=fs.readFileSync(process.env.BASELINE_SPATIAL_INDEX||file,'utf8');
const transform=process.env.GRID_TRANSFORM?require(path.resolve(process.env.GRID_TRANSFORM)).candidateSource:candidateSource;
const before=load(source),after=load(transform(source));
for(const offset of [-65536,-32769,-32768,0,32767,32768,65536]){
  const bodies=Array.from({length:70},(_,i)=>({id:i,x:(offset+i-35)*256+10,y:(offset-i+35)*256+10,radius:100}));
  const a=new before.CircleIndex(bodies),b=new after.CircleIndex(bodies);
  for(const body of bodies)assert.deepEqual(b.query(body),a.query(body));
  a.querySerial=b.querySerial=0xfffffffe;
  assert.deepEqual(b.queryMany(bodies),a.queryMany(bodies));
  assert.deepEqual(b.query(bodies[0]),a.query(bodies[0]));
}
const results=[];
for(const dense of [false,true])for(const count of [560,6000]){
  let seed=16;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const span=dense?1300:6000;
  const bodies=Array.from({length:count},(_,i)=>({id:i,x:rnd()*span,y:rnd()*span,radius:count===560?20+rnd()*160:5.5}));
  const queries=Array.from({length:150},()=>({x:rnd()*span,y:rnd()*span,radius:50+rnd()*300}));
  for(const centersOnly of [false,true]){
    const a=new before.CircleIndex(bodies,256,centersOnly),b=new after.CircleIndex(bodies,256,centersOnly);
    for(const q of queries)for(const first of [0,31,32,127,559])assert.deepEqual(b.query(q,first),a.query(q,first));
    for(const variant of [0,1,1,0]){
      const Index=(variant?after:before).CircleIndex;let hits=0;const start=performance.now();
      for(let frame=0;frame<100;frame++){
        const index=new Index(bodies,256,centersOnly);
        for(const q of queries)hits+=index.query(q).length;
      }
      results.push({variant:variant?'after':'before',dense,count,centersOnly,hits,ms:performance.now()-start});
    }
  }
}
console.log(JSON.stringify({exact:true,results}));
