"use strict";
const { createHash } = require('node:crypto');
const { BOOSTERS } = require('../boosters/booster-catalog');
const WINDOW = 60000, HISTORY = 256;
const round = n => Math.round(n * 1000) / 1000;
const median = a => { const b = [...a].sort((x,y)=>x-y); return b[Math.floor(b.length / 2)]; };
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const envelope = details => ({version:1,reason:'arena-repeated-patterns',features:null,windows:[],modelReady:false,modelScore:null,
  patternEvidence:{version:1,domain:'arena-patterns-v1',...details}});
function manualKey(message) {
  if (message.type === 'split') return 'split';
  if (message.type === 'useBooster') {
    const item = BOOSTERS.get(message.boosterId);
    // Feeding boosters deliberately support holding a key with timed repetition.
    return item && item.kind !== 'mass' ? 'booster:' + item.id : null;
  }
  return ['usePetBooster','useAccessoryBooster'].includes(message.type) ? message.type : null;
}
function session() { return {channels:new Map(),seen:new Set(),ids:[],route:null,last:0,quietUntil:0,spawn:null}; }
function reset(s, at, spawn) {
  s.channels.clear();s.seen.clear();s.ids.length=0;s.route=null;s.last=at;s.spawn=spawn;s.quietUntil=at+2000;
}
function cadence(s,key,at,wallAt) {
  let c=s.channels.get(key);
  if(!c) {
    if(s.channels.size>=8)s.channels.delete(s.channels.keys().next().value);
    c={last:at,start:at,count:1,intervals:[],samples:[]};s.channels.set(key,c);return null;
  }
  const dt=at-c.last;
  if(dt<40||dt>10000) { c.start=at;c.last=at;c.count=1;c.intervals=[];c.samples=[];return null; }
  c.last=at;c.count++;c.intervals.push(dt);
  if(c.intervals.length>HISTORY) { c.start=at;c.count=1;c.intervals=[];c.samples=[];return null; }
  if(at-c.start<WINDOW)return null;
  const m=median(c.intervals),tolerance=Math.max(8,m*.015);
  const regular=c.intervals.filter(n=>Math.abs(n-m)<=tolerance).length/c.intervals.length;
  const sample={start:wallAt-(at-c.start),end:wallAt,count:c.count,medianIntervalMs:m,
    toleranceMs:round(tolerance),regularFraction:round(regular),eventsSha256:digest(c.intervals)};
  if(c.count>=13&&m>=100&&m<=5000&&regular>=.95)c.samples.push(sample);else c.samples=[];
  c.start=at;c.count=1;c.intervals=[];
  if(c.samples.length<3)return null;
  const samples=c.samples.splice(0);
  return envelope({kind:'manual-cadence',command:key,samples});
}
function route(s,message,at,wallAt,width,height) {
  if(!Number.isFinite(message.x)||!Number.isFinite(message.y)||message.x<0||message.y<0||message.x>width||message.y>height)return null;
  let r=s.route;
  if(!r)r=s.route={rows:[],lastSample:-Infinity,nextCheck:at+120000,x:null,y:null};
  if(at-r.lastSample<1000)return null;
  r.lastSample=at;
  const x=Math.round(message.x/4)*4,y=Math.round(message.y/4)*4;
  // A stationary pointer or a straight held joystick is not a repeating route.
  if(x===r.x&&y===r.y)return null;
  r.x=x;r.y=y;r.rows.push({x,y,at});if(r.rows.length>HISTORY)r.rows.shift();
  if(at<r.nextCheck||r.rows.length<12)return null;
  r.nextCheck=at+5000;
  const rows=r.rows,n=rows.length;
  for(let period=3;period<=Math.min(64,Math.floor(n/4));period++) {
    const length=period*4,start=n-length,elapsed=at-rows[start].at;
    if(elapsed<120000)continue;
    let matches=true;
    for(let i=start+period;i<n;i++) {
      const p=rows[i],previous=rows[i-period];
      if(p.x!==previous.x||p.y!==previous.y){matches=false;break;}
    }
    if(!matches)continue;
    // Allocate summaries only after a route actually repeats.
    const a=rows.slice(start);
    const cycle=a.slice(0,period),unique=new Set(cycle.map(p=>p.x+':'+p.y));
    if(unique.size<3||Math.max(...cycle.map(p=>p.x))-Math.min(...cycle.map(p=>p.x))<120||
        Math.max(...cycle.map(p=>p.y))-Math.min(...cycle.map(p=>p.y))<120)continue;
    const durations=[];
    for(let i=period;i<length;i++) {
      const p=a[i],previous=a[i-period];
      durations.push(p.at-previous.at);
    }
    const m=median(durations),tolerance=Math.max(50,m*.015);
    const regular=durations.filter(dt=>Math.abs(dt-m)<=tolerance).length/durations.length;
    if(regular<.95)continue;
    return envelope({kind:'repeated-route',start:wallAt-elapsed,end:wallAt,cycles:4,pointsPerCycle:period,
      cycleMs:m,toleranceMs:round(tolerance),regularFraction:round(regular),eventsSha256:digest(a),
      // Bounded reproducible route sample; no full world/player history copied.
      route:cycle.map(p=>({x:p.x,y:p.y,offsetMs:p.at-cycle[0].at}))});
  }
  return null;
}
function observe(s,message,at,{wallAt,stalled=false,spawn=null,width=100000,height=100000}={}) {
  at=Math.trunc(at);wallAt=Math.trunc(wallAt);
  if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(wallAt)||wallAt<0||!message)return null;
  if(stalled||s.spawn!==spawn||at<s.last||s.last&&at-s.last>10000){reset(s,at,spawn);return null;}
  s.last=at;
  if(at<s.quietUntil)return null;
  if(message.spawnSerial!==undefined&&spawn!==null&&message.spawnSerial!==spawn)return null;
  if(message.type==='stop'){s.route=null;return null;}
  let evidence;
  if(message.type==='move')evidence=route(s,message,at,wallAt,width,height);
  else {
    const key=manualKey(message);if(!key)return null;
    if(message.type!=='split') {
      const id=message.requestId;
      if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(id)||s.seen.has(id))return null;
      s.seen.add(id);s.ids.push(id);if(s.ids.length>HISTORY)s.seen.delete(s.ids.shift());
    }
    evidence=cadence(s,key,at,wallAt);
  }
  if(evidence){reset(s,at,spawn);s.quietUntil=at+3600000;}
  return evidence;
}
module.exports={session,observe,manualKey,HISTORY};
