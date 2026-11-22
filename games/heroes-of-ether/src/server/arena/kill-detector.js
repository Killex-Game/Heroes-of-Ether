"use strict";
const { randomUUID } = require('node:crypto');
const { BOOSTERS } = require('../boosters/booster-catalog');
const { profileKeys, remember } = require('../profiles/profile-index');
const { replaceBatchProfile } = require('../profiles/profile-batch');
const { copyRecord } = require('../profiles/copy-record');
const deltas = require('../profiles/immutable-table-delta');
const model = require('./kill-model');
const WINDOW=15000, RETRY=3600000;
function fresh(at) { return {start:at,last:at,n:0,short:0,same:0,sum:0,square:0,lastKey:null,kinds:new Set(),burst:0,maxBurst:0}; }
function features(w,at) {
  const intervals=Math.max(1,w.n-1),mean=w.sum/intervals;
  const cv=mean>0?Math.sqrt(Math.max(0,w.square/intervals-mean*mean))/mean:0;
  const rate=w.n/Math.max(1,(at-w.start)/1000);
  return {rate,shortFraction:w.short/intervals,regularity:1/(1+cv),switchFraction:1-w.same/intervals,maxBurst:w.maxBurst,
    vector:[Math.min(1,rate/40),w.short/intervals,1/(1+cv),1-w.same/intervals,Math.min(1,w.maxBurst/20)]};
}
class KillDetector {
  constructor({profiles,actionQueue,now=Date.now,onError=()=>{}}) {
    Object.assign(this,{profiles,actionQueue,now,onError});this.pending=new Map();this.model=model.train(profiles.data.administration?.audit);
  }
  retrain() { this.model=model.train(this.profiles.data.administration?.audit); }
  session() { return {window:null,hits:0,windows:[],seen:new Set(),recent:[],quietUntil:0}; }
  observe(s,id,message,at,{stalled=false}={}) {
    at=Math.trunc(at);
    if(message?.type!=='useBooster'||!BOOSTERS.has(message.boosterId)||
        typeof message.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(message.requestId))return;
    if(stalled){s.window=null;s.hits=0;s.windows=[];s.quietUntil=at+2000;return;}
    if(at<s.quietUntil)return;
    if(s.seen.has(message.requestId))return;
    s.seen.add(message.requestId);s.recent.push(message.requestId);
    if(s.recent.length>256)s.seen.delete(s.recent.shift());
    if(!s.window||at<s.window.last||at-s.window.last>5000){s.window=fresh(at);s.hits=0;s.windows=[];}
    const w=s.window;
    if(at-w.start>=WINDOW){
      const f=features(w,at),score=this.model.ready?model.predict(this.model,f.vector):null;
      // Ordinary built-in 100 ms mass-booster repetition is expressly excluded.
      // Require sustained mixed-key bursts in three windows, never a lone TCP batch.
      const burst=w.n>=80&&w.kinds.size>=2&&f.shortFraction>=0.45&&w.maxBurst>=4;
      const suspect=burst || (this.model.ready&&score>=0.9&&w.n>=80&&w.kinds.size>=2);
      if(suspect){s.hits++;s.windows.push({start:w.start,end:at,count:w.n,kinds:w.kinds.size,
        rate:Math.round(f.rate*100)/100,shortFraction:Math.round(f.shortFraction*1000)/1000,maxBurst:w.maxBurst});}
      else{s.hits=0;s.windows=[];}
      if(s.hits>=3){
        const evidence={version:1,features:f.vector,windows:s.windows.slice(-3),modelReady:this.model.ready,modelScore:score,
          reason:burst?'repeated-mixed-bursts':'reviewed-model-anomaly'};
        this.report(id,evidence).catch(this.onError);s.hits=0;s.windows=[];s.quietUntil=at+60000;
      }
      s.window=fresh(at);
    }
    const c=s.window,dt=at-c.last;
    if(c.n){c.sum+=dt;c.square+=dt*dt;if(dt<=20){c.short++;c.burst++;}else c.burst=1;if(c.lastKey===message.boosterId)c.same++;}
    else c.burst=1;
    c.maxBurst=Math.max(c.maxBurst,c.burst);c.n++;c.kinds.add(message.boosterId);c.lastKey=message.boosterId;c.last=at;
  }
  report(id,evidence) {
    if(this.pending.has(id))return this.pending.get(id);
    const prepare=batch=>{
      const world=batch?.next||this.profiles.data,index=profileKeys(world.profiles),key=index.get(id),p=world.profiles[key];
      if(!p||p.testBot||p.kill?.status==='new'||(p.kill&&this.now()-p.kill.createdAt<RETRY))return {finish:()=>false};
      const at=this.now(),record={id:randomUUID(),version:1,status:'new',createdAt:at,...evidence};
      const draft={...p,revision:p.revision+1,kill:record};
      const changed=batch&&replaceBatchProfile(batch,world,key,draft);
      const table=changed?.profiles||Object.assign(copyRecord(world.profiles),{[key]:draft});
      if(!changed)deltas.remember(table,world.profiles,[key],true);remember(table,index);
      const next={...(changed||world),profiles:table};validate(record);
      if(batch)batch.next=next;else this.profiles.save(next,at);
      return {finish:()=>true};
    };
    const pending=Promise.resolve().then(()=>{
      if(!this.profiles.journal||!this.actionQueue)return prepare().finish();
      return new Promise((resolve,reject)=>this.actionQueue.use({owner:id,prepare:batch=>{const r=prepare(batch);return {finish:()=>resolve(r.finish())};},fail:reject}));
    }).finally(()=>this.pending.delete(id));this.pending.set(id,pending);return pending;
  }
}
function validate(c) {
  if(c===undefined)return;
  if(c?.reason==='owner-reported-automation')return require('./kill-owner-evidence').validate(c);
  if(c?.reason==='gift-dispatch-pattern')return require('./kill-gift-evidence').validate(c);
  if(!c||c.version!==1||typeof c.id!=='string'||!/^[a-f0-9-]{36}$/.test(c.id)||!['new','confirmed','dismissed'].includes(c.status)||
    !Number.isSafeInteger(c.createdAt)||c.createdAt<0||!['repeated-mixed-bursts','reviewed-model-anomaly'].includes(c.reason)||
    !Array.isArray(c.features)||c.features.length!==5||!c.features.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||
    typeof c.modelReady!=='boolean'||(c.modelScore!==null&&(!Number.isFinite(c.modelScore)||c.modelScore<0||c.modelScore>1))||
    !Array.isArray(c.windows)||c.windows.length!==3||c.windows.some(w=>!w||!Number.isSafeInteger(w.start)||!Number.isSafeInteger(w.end)||w.end<=w.start||
      !Number.isSafeInteger(w.count)||w.count<1||!Number.isSafeInteger(w.kinds)||w.kinds<1||!Number.isSafeInteger(w.maxBurst)||w.maxBurst<1||!Number.isFinite(w.rate)||w.rate<0||!Number.isFinite(w.shortFraction)||w.shortFraction<0||w.shortFraction>1)||
    (c.status!=='new'&&(!Number.isSafeInteger(c.reviewedAt)||c.reviewedAt<c.createdAt||typeof c.reviewedBy!=='string'||typeof c.reviewReason!=='string'||c.reviewReason.length>500)))throw Error('Повреждены данные проверки Kill.');
}
module.exports={KillDetector,validate,features};
