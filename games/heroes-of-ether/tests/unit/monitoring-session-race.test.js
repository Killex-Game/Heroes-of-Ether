"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
function fixture(){
  const pending=[],timers=new Map(),states=[];let serial=0;
  const document={hidden:false,addEventListener(){},getElementById(){return {replaceChildren(){},textContent:""};}};
  const context={window:{},document,Date,setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../../public/ui/admin/owner-monitoring.js"),"utf8"),context);
  const monitor=new context.window.KillexOwnerMonitoring({api:url=>new Promise(resolve=>pending.push({url,resolve})),onState:state=>states.push(state)});
  monitor.render=()=>{};
  return {monitor,pending,timers,states,document};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test("relogin during an outstanding graph request discards its data and resumes the new session",async()=>{
  const f=fixture();f.monitor.view("overview");assert.equal(f.pending.length,1);
  f.monitor.lock();f.monitor.view("overview");assert.equal(f.pending.length,1,"no overlapping requests");
  f.pending[0].resolve({availability:"old-session"});await settle();
  assert.deepEqual(f.states,[]);assert.equal(f.timers.size,1);
  const next=[...f.timers.values()][0];assert.equal(next.ms,0);f.timers.clear();next.fn();
  assert.equal(f.pending.length,2);assert.equal(f.pending[1].url,"monitoring?graphs=1");
  f.pending[1].resolve({availability:"new-session"});await settle();
  assert.deepEqual(f.states,["new-session"]);assert.equal(f.timers.size,1);
});
test("leaving the overview or hiding the page during a request never restarts polling",async()=>{
  for(const action of [f=>f.monitor.lock(),f=>f.monitor.view("players"),f=>{f.document.hidden=true;f.monitor.schedule();}]){
    const f=fixture();f.monitor.view("overview");action(f);
    f.pending[0].resolve({availability:"late"});await settle();assert.equal(f.timers.size,0);
  }
});
