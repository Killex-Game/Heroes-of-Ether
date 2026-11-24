'use strict';
// Offline control-plane comparison; not a physics, database or CCU benchmark.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),Module=require('module'),crypto=require('crypto');
const file=path.resolve(__dirname,'../../src/server/arena/arena-directory.js');
const {ArenaDirectory:Current}=require(file);
const baseline=process.argv[2],output=process.argv[3];
if(!baseline||!output)throw Error('Usage: node arena-directory.cjs BASELINE_JS OUTPUT_JSON');
const legacy=new Module(file,module);legacy.filename=file;legacy.paths=Module._nodeModulePaths(path.dirname(file));
legacy._compile(fs.readFileSync(baseline,'utf8'),file);
const Previous=legacy.exports.ArenaDirectory,hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let at=5000,seed=123456789;
const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
const normalize=value=>JSON.parse(JSON.stringify(value,(key,v)=>['ticket','workerLease'].includes(key)?(v?'present':v):v));
const ready=d=>{for(const room of d.rooms.values())if(room.status==='starting')d.markReady(room.id);};
function snapshot(d){return {rooms:d.list(),players:normalize([...d.players]),remnants:[...d.remnants],occupied:d.occupancy()};}
const checks=[];
for(const levelGroups of [false,true]){
 const pair=[Previous,Current].map(C=>new C({now:()=>at,levelGroups}));pair.forEach(ready);
 for(let i=0;i<300;i++)pair.forEach(d=>d.enterLobby('player-'+i));
 for(let i=0;i<6000;i++){
  const action=random(8),id='player-'+random(300),roomId='arena-'+(1+random(14)),group=['sandbox','glade','arena'][random(3)],exact=!!random(2);
  if(i%31===0)at+=1001;
  const values=pair.map(d=>{
   for(const r of d.rooms.values())if(r.status==='ready')d.heartbeat(r.id,r.workerLease);
   let result;
   if(action===0){d.enterLobby(id);result=d.reserve(id,null,group);ready(d);}
   else if(action===1){const p=d.players.get(id);result=d.confirm(id,p?.ticket,d.rooms.get(p?.arenaId)?.workerLease,group);}
   else if(action===2)result=d.leaveArena(id);
   else if(action===3)result=d.disconnect(id);
   else if(action===4){d.enterLobby(id);result=d.reserve(id,roomId,group,exact);ready(d);}
   else if(action===5){d.remnants.set(id,roomId);result=d.expand();ready(d);}
   else if(action===6)result=d.remnants.delete(id);
   else {d.sweep();d.expand();ready(d);result=d.list(group);}
   return {result:normalize(result===undefined?null:result),state:snapshot(d)};
  });
  assert.deepEqual(values[1],values[0],'routing changed at '+levelGroups+'/'+i);
 }
 checks.push({levelGroups,operations:6000,digest:hash(snapshot(pair[0])),equal:true});
}
function populated(C){const d=new C({now:()=>5000,levelGroups:true});ready(d);for(let i=0;i<390;i++){
 const id='bench-'+i,group=['sandbox','glade','arena'][i%3];d.enterLobby(id);const r=d.reserve(id,null,group);ready(d);
 if(r.ok)assert(d.confirm(id,r.ticket,r.workerLease,group).ok);
}return d;}
const pair=[Previous,Current].map(populated),measure=d=>{const start=performance.now();for(let i=0;i<3000;i++){d.expand();d.list();}return performance.now()-start;};
pair.forEach(measure);const samples=[];
for(let i=0;i<6;i++){const order=i%2?[1,0]:[0,1],times=[];for(const n of order)times[n]=measure(pair[n]);samples.push({previousMs:times[0],currentMs:times[1]});}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const before=median(samples.map(r=>r.previousMs)),after=median(samples.map(r=>r.currentMs));
const report={at:new Date().toISOString(),checks,samples,median:{previousMs:before,currentMs:after,reductionPercent:100*(before-after)/before},iterationsPerSample:3000,occupancy:pair[1].occupancy(),rooms:pair[1].rooms.size,scope:'Operation-local occupancy census only; no whole-game or CCU claim'};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
