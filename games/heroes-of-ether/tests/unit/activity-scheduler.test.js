'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('UI lifecycle stops timer ownership while hidden/closed, resumes once and disposes safely',()=>{
 const timers=new Map(),events={},micro=[];let sequence=0,mutate,open=false,called=0;
 const document={hidden:false,documentElement:{},addEventListener:(n,fn)=>events[n]=fn};
 const context={document,window:{},addEventListener:(n,fn)=>events[n]=fn,queueMicrotask:fn=>micro.push(fn),setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id),MutationObserver:class{constructor(fn){mutate=fn;}observe(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../public/shared/activity-scheduler.js'),'utf8'),context);
 const flush=()=>{while(micro.length)micro.shift()();},api=context.window.KillexActivity;
 const cancel=api.every(()=>called++,1000,()=>open);flush();assert.equal(timers.size,0);
 open=true;mutate();flush();assert.equal(timers.size,1);mutate();flush();assert.equal(timers.size,1);
 const [id,task]=[...timers][0];timers.delete(id);task.fn();flush();assert.equal(called,1);assert.equal(timers.size,1);
 document.hidden=true;events.visibilitychange();flush();assert.equal(timers.size,0);
 document.hidden=false;events.visibilitychange();flush();assert.equal(timers.size,1);
 open=false;mutate();flush();assert.equal(timers.size,0);
 open=true;mutate();flush();cancel();assert.equal(timers.size,0);
 events['pageshow']();flush();assert.equal(timers.size,0);
 const remove=api.every(()=>{},()=>123);flush();assert.equal([...timers.values()][0].ms,123);
 events['pagehide']();flush();assert.equal(timers.size,0);events['pageshow']();flush();assert.equal(timers.size,1);remove();
});
