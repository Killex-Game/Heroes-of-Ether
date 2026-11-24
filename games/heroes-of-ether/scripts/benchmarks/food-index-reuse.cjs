"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const [beforeFile,output]=process.argv.slice(2);assert(beforeFile&&output);
const file=require.resolve('../../src/server/arena/worker-food-transfer'),baseline=new Module(file,module);
baseline.filename=file;baseline.paths=Module._nodeModulePaths(path.dirname(file));
baseline._compile(fs.readFileSync(path.resolve(beforeFile),'utf8'),file);
const modules=[baseline.exports,require(file)];
function initial(count,moving){return Array.from({length:count},(_,i)=>i<moving?
 {id:'e'+i,x:i/3,y:i/7,value:5,radius:5.5,color:'gold',artValue:5,ejected:true,birth:Object.freeze({at:1,x:i,y:0})}:
 Object.freeze({id:'e'+i,x:i/3,y:i/7,value:5,radius:5.5,color:'gold'}));}
function move(rows,tick,moving,churn){
 for(let i=0;i<rows.length;i++)if(rows[i].ejected)rows[i]={...rows[i],x:rows[i].x+.000001,y:rows[i].y-.000003};
 if(churn&&tick%7===0)rows.reverse();
 if(churn&&tick%11===0){const p=rows[123];rows[123]={...p,color:tick%22?'red':'gold'};}
}
function exact(){
 for(const packed of [false,true]){
  const encoders=modules.map(m=>new m.FoodTransferEncoder({packed}));
  const decoders=modules.map(m=>new m.FoodTransferDecoder());let rows=initial(220,150),old=[];
  for(let tick=0;tick<160;tick++){
   move(rows,tick,150,true);
   if(tick%13===0)rows=rows.slice(1);
   if(tick%17===0)rows.push({...rows[4],x:tick,y:-0});
   const packets=encoders.map(e=>structuredClone(e.encode(rows)));assert.deepEqual(packets[1],packets[0]);
   const decoded=packets.map((p,i)=>decoders[i].decode(p));assert.deepEqual(decoded[0],rows);assert.deepEqual(decoded[1],rows);
   for(const saved of old)assert.deepEqual(saved.actual,saved.copy);
   if(tick%20===0){old.push({actual:decoded[1],copy:structuredClone(decoded[1])});if(old.length>2)old.shift();}
  }
 }
}
exact();
function run(which,{packed,moving,churn}){
 const api=modules[which],rooms=Array.from({length:5},()=>({food:initial(6000,moving),encoder:new api.FoodTransferEncoder({packed}),decoder:new api.FoodTransferDecoder()}));
 let encodeMs=0,cloneMs=0,decodeMs=0,packets=0;
 const started=process.cpuUsage();
 for(let tick=0;tick<55;tick++)for(const room of rooms){
  move(room.food,tick,moving,churn);
  const begin=performance.now(),packet=room.encoder.encode(room.food),encoded=performance.now();
  const copy=packet&&structuredClone(packet,packed?{transfer:[packet.refs.buffer,packet.positions.buffer]}:undefined),cloned=performance.now();
  const rows=room.decoder.decode(copy),end=performance.now();
  if(tick>=5){encodeMs+=encoded-begin;cloneMs+=cloned-encoded;decodeMs+=end-cloned;if(packet)packets++;}
  if(tick%11===0)assert.deepEqual(rows,room.food);
 }
 const cpu=process.cpuUsage(started);return{variant:which?'candidate':'baseline',...{packed,moving,churn},encodeMs,cloneMs,decodeMs,cpuMs:(cpu.user+cpu.system)/1000,packets,rssMiB:process.memoryUsage().rss/1048576};
}
const results=[];
for(const packed of [false,true])for(const [moving,churn] of [[0,false],[1000,false],[4000,true]])
 for(const variant of [0,1,1,0]){global.gc?.();results.push(run(variant,{packed,moving,churn}));}
const report={node:process.version,platform:process.platform,exactPacketFrames:320,rooms:5,foodPerRoom:6000,measuredTicks:50,results,scope:'Offline internal food transport only, including both current and packed modes; not game capacity or client FPS'};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,rows:results.length,exactPacketFrames:320}));
