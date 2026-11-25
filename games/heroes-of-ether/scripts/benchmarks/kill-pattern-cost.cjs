'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),Module=require('module'),{performance}=require('perf_hooks');
const root=path.resolve(__dirname,'../..'),filename=path.join(root,'src/server/arena/kill-detector.js');
const baseline=process.env.KILL_BASELINE_FILE?fs.readFileSync(process.env.KILL_BASELINE_FILE,'utf8'):
 cp.execFileSync('git',['show','3116db3:games/heroes-of-ether/src/server/arena/kill-detector.js'],{cwd:root,encoding:'utf8'});
const oldModule=new Module(filename,module);oldModule.filename=filename;oldModule.paths=Module._nodeModulePaths(path.dirname(filename));oldModule._compile(baseline,filename);
const Before=oldModule.exports.KillDetector,After=require(filename).KillDetector;
function run(Detector,players,mode){
 const detector=new Detector({profiles:{data:{}},now:()=>Date.UTC(2026,10,26)}),sessions=Array.from({length:players},()=>detector.session());detector.report=async()=>false;
 const message={type:'move',x:1000,y:1000},options={spawn:1,width:10000,height:10000};let n=0;
 const t=performance.now();for(let at=0;at<300000;at+=50){
  message.x=mode==='loop'?1000+Math.round(Math.cos(at/9000)*500):1000+at/100;
  message.y=mode==='loop'?1000+Math.round(Math.sin(at/9000)*500):1000;
  for(let i=0;i<players;i++){detector.observe(sessions[i],String(i),message,at,options);n++;}
 }
 return {ms:performance.now()-t,commands:n,maxRoute:sessions.reduce((n,s)=>Math.max(n,s.patterns?.route?.rows.length||0),0)};
}
run(Before,10,'straight');run(After,10,'straight');const rows=[];
for(const mode of ['straight','loop'])for(const players of [30,120])for(let trial=0;trial<3;trial++){
 const first=trial%2?After:Before,second=trial%2?Before:After,a=run(first,players,mode),b=run(second,players,mode);
 const before=first===Before?a:b,after=first===After?a:b;rows.push({mode,players,trial,before,after,addedMicrosecondsPerCommand:(after.ms-before.ms)*1000/after.commands});
}
const result={scope:'CPU of detector only, synthetic 5 minutes per player at 20 Hz; not full game, real online capacity or browser FPS',rows};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
