'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
  const timers=new Map(),requests=[];let serial=0,lobby=true;
  const context={window:{},document:{hidden:false},AbortController,
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../public/ui/lobby/arena-picker.js'),'utf8'),context);
  const picker=Object.create(context.window.KillexArenaPicker.prototype);
  Object.assign(picker,{owner:{isLobby:()=>lobby},dialog:{open:true},cards:new Map(),status:{},title:{},paginate(){}});
  const reply=i=>requests[i].resolve({ok:true,json:async()=>({arenas:[]})});
  return{context,picker,timers,requests,reply,lobby:value=>{lobby=value;}};
}
test('closed, hidden and arena screens never poll arena choices',async()=>{
  const f=fixture();f.context.document.hidden=true;await f.picker.load();
  f.context.document.hidden=false;f.picker.dialog.open=false;await f.picker.load();
  f.picker.dialog.open=true;f.lobby(false);await f.picker.load();
  assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);
});
test('stale arena choice request cannot install another polling timer',async()=>{
  const f=fixture(),first=f.picker.load(),second=f.picker.load();
  assert.equal(f.requests[0].options.signal.aborted,true);
  f.reply(1);await second;assert.equal([...f.timers.values()].filter(t=>t.ms===4000).length,2);
  f.reply(0);await first;assert.equal(f.timers.size,1);
  f.picker.stop();assert.equal(f.timers.size,0);
});
test('hiding aborts pending choices; showing restarts once and ignores the old response',async()=>{
  const f=fixture(),first=f.picker.load();
  f.context.document.hidden=true;f.picker.syncVisibility();
  assert.equal(f.requests[0].options.signal.aborted,true);
  f.context.document.hidden=false;f.picker.syncVisibility();assert.equal(f.requests.length,2);
  f.reply(0);await first;
  assert.equal([...f.timers.values()].filter(t=>t.ms===4000).length,1,'only the current request timeout exists');
  f.reply(1);await new Promise(r=>setImmediate(r));assert.equal(f.timers.size,1);
  f.picker.dialog.open=false;f.picker.stop();assert.equal(f.timers.size,0);
});
