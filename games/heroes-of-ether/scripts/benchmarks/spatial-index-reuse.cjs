"use strict";
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const filename=require.resolve('../../src/server/arena/spatial-collision-index'),old=new Module(filename,module);
old.filename=filename;old.paths=Module._nodeModulePaths(path.dirname(filename));old._compile(fs.readFileSync(process.argv[2],'utf8'),filename);
const Current=require(filename).CircleIndex,Previous=old.exports.CircleIndex;
const bodies=Array.from({length:6000},(_,id)=>({id,x:id*773%6000,y:id*431%4000,radius:5.5}));
const regions=Array.from({length:30},(_,id)=>({x:id*331%6000,y:id*277%4000,radius:90}));
function run(reuse,dense){
  const rows=bodies.map(p=>({...p,x:dense?p.x/6:p.x,y:dense?p.y/4:p.y}));
  const serial=[],cpu=process.cpuUsage();let index,total=0,build=0,queries=0;
  for(let frame=0;frame<360;frame++){
    for(let i=0;i<rows.length;i+=3){rows[i].x+=.25;rows[i].y-=.1;}
    const start=performance.now();
    index=reuse?(index?index.reset(rows,256):new Current(rows,256)):new Previous(rows,256);
    const built=performance.now(),queried=[];
    for(const region of regions)queried.push(index.queryOrdinals([region]));
    const end=performance.now();serial.push(createHash('sha256').update(JSON.stringify(queried)).digest('hex'));
    if(frame>=40){build+=built-start;queries+=end-built;total+=end-start;}
  }
  const used=process.cpuUsage(cpu);return {variant:reuse?'candidate':'baseline',dense,buildMs:build,queryMs:queries,totalMs:total,cpuMs:(used.user+used.system)/1000,serial};
}
const results=[];
for(const dense of [false,true]){
  const rows=[false,true,true,false].map(reuse=>run(reuse,dense));
  for(const row of rows)assert.deepEqual(row.serial,rows[0].serial);
  results.push(...rows.map(({serial,...row})=>row));
}
console.log(JSON.stringify({at:new Date().toISOString(),platform:process.platform,node:process.version,exactFrames:720,scope:'Private food index construction and queries only. Timings exclude SHA checks; CPU includes verification. No whole-game or CCU claim',results},null,2));
