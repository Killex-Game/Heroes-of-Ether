'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),WebSocket=require('ws');
const {temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store'),{OwnerAccess}=require('../../src/server/admin/owner-access'),{Maintenance}=require('../../src/server/runtime/maintenance'),{createGameServer}=require('../../src/server/game-server'),{Arena}=require('../../src/server/arena/arena-simulation');
const service=require('../../src/server/admin/service-availability'),{recover}=require('../../src/server/profiles/profile-journal');
const eventually=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}assert.ok(check(),'Condition did not settle');};
async function fixture(t,{monitor=false}={}){
 let at=Date.now(),gameAt=1000,cleanup;const file=path.join(temporary({after(fn){cleanup=fn;}},'service-availability'),'profiles.json');
 const profiles=new ProfileStore({filePath:file,journal:true,now:()=>at}),owner=profiles.open(),player=profiles.open(),access=new OwnerAccess({ownerId:owner.profile.id}),maintenance=new Maintenance({now:()=>at});
 const mongo={enabled:true,health:{state:'ok'},metrics:{epoch:'test',at,read:0,write:0}},metricSwitches=[];
 const app=createGameServer({profiles,ownerAccess:access,maintenance,now:()=>gameAt,wallNow:()=>at,autoTick:false,arena:new Arena({etherCount:0}),testBots:{enabled:false},...(monitor?{monitorDirectory:path.join(path.dirname(file),'monitoring'),mongoMonitor:()=>mongo,mongoMetrics:on=>metricSwitches.push(on)}:{})});
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');t.after(async()=>{await app.close();cleanup();});const url='http://127.0.0.1:'+app.httpServer.address().port;let adminCookie='',csrf='';
 const call=async(route,body,token=owner.token,headers={})=>{const r=await fetch(url+route,{method:body?'POST':'GET',headers:{Cookie:'sferorumiya_session='+token+'; '+(token===owner.token?adminCookie:''),Origin:url,...(body?{'Content-Type':'application/json','X-Owner-CSRF':csrf}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,headers:r.headers,data:await r.json()};};
 const login=await call('/api/admin/setup',{password:'Long maintenance test password',setupCode:access.bootstrapCode});assert.equal(login.status,200);adminCookie=login.headers.get('set-cookie').split(';')[0];csrf=login.data.csrf;
 const command=(mode,start=at,end=at+60000)=>({revision:profiles.data.serviceAvailability?.revision||0,requestId:randomUUID(),reason:'Проверка расписания',windows:service.empty().windows.map(w=>w.mode===mode?{...w,enabled:true,startsAt:start,endsAt:end}:w)});
 const connect=async()=>{const ws=new WebSocket(url.replace('http:','ws:'),{headers:{Cookie:'sferorumiya_session='+player.token}});ws.on('error',()=>{});await once(ws,'open');await eventually(()=>!!profiles.byId(player.profile.id).progress.session);return ws;};
 return {app,profiles,player,maintenance,call,command,connect,file,mongo,metricSwitches,advance(ms){at+=ms;gameAt+=ms;},get at(){return at;}};
}
test('owner schedule validates dates and CSRF, is durable and idempotent; every mode closes and reopens at exact boundaries',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('/api/admin/maintenance',null,f.player.token)).status,403);
 assert.equal((await f.call('/api/admin/maintenance',f.command('failure'),undefined,{'X-Owner-CSRF':'bad'})).status,403);
 assert.equal((await f.call('/api/admin/maintenance',f.command('failure',f.at+10000,f.at))).status,400);
 for(const mode of ['maintenance','failure','unavailable']){
  const ws=await f.connect(),closed=once(ws,'close');f.advance(10000);f.app.tick();await eventually(()=>!f.app.persistenceStatus().arenaBatches);
  const cmd=f.command(mode,f.at+1000,f.at+5000),saved=await f.call('/api/admin/maintenance',cmd);assert.equal(saved.status,200);assert.equal(saved.data.status.maintenance,false);
  assert.equal((await f.call('/api/admin/maintenance',cmd)).data.replay,true);
  assert.equal((await f.call('/api/admin/maintenance',{...cmd,requestId:randomUUID()})).status,409);
  f.advance(999);f.maintenance.refreshState();assert.equal(f.maintenance.active,false);
  f.advance(1);f.maintenance.refreshState();assert.equal(f.maintenance.active,true);
  assert.equal((await f.call('/api/profile',null,f.player.token)).status,503);
  assert.equal((await closed)[0],1012);
  const persisted=recover(f.file).data;const p=Object.values(persisted.profiles).find(p=>p.id===f.player.profile.id);
  assert.equal(p.progress.session,null);assert.ok(p.progress.lastLife.durationSeconds>=10);
  assert.equal(persisted.serviceAvailability.windows.find(w=>w.enabled).mode,mode);
  assert.equal((await f.call('/api/admin/maintenance')).data.status.mode,mode);
  assert.equal((await f.call('/api/admin/players')).status,200);
  const restoredGate=new Maintenance({now:()=>f.at});restoredGate.bind(()=>persisted.serviceAvailability);assert.equal(restoredGate.status().mode,mode);restoredGate.close();
  f.advance(4000);f.maintenance.refreshState();assert.equal(f.maintenance.active,false);
  assert.equal((await f.call('/api/profile',null,f.player.token)).status,200);
 }
 assert.equal(f.profiles.data.administration.audit.filter(e=>e.action==='serviceAvailability').length,3);
 const restarted=new Maintenance({now:()=>f.at});restarted.bind(()=>recover(f.file).data.serviceAvailability);assert.equal(restarted.active,false);restarted.close();
});
test('failed final save holds admission closed beyond schedule end; retry persists life before closing socket',async t=>{
 const f=await fixture(t),ws=await f.connect();let closed=false;ws.on('close',()=>closed=true);f.advance(12000);
 const save=f.profiles.applyArenaProgress.bind(f.profiles);let refuse=true;
 f.profiles.applyArenaProgress=(...args)=>{if(refuse)throw Error('Injected disk failure');return save(...args);};
 const result=await f.call('/api/admin/maintenance',f.command('unavailable',f.at,f.at+500));assert.equal(result.status,200);
 await new Promise(r=>setTimeout(r,100));assert.equal(closed,false);
 assert.equal((await f.call('/api/admin/login',{password:'Long maintenance test password'})).status,200,'owner can sign in while progress save is unavailable');f.advance(500);f.maintenance.refreshState();assert.equal(f.maintenance.active,true);
 assert.equal((await f.call('/api/profile',null,f.player.token)).status,503);
 refuse=false;await eventually(()=>closed);assert.equal(f.maintenance.active,false);
 const p=Object.values(recover(f.file).data.profiles).find(p=>p.id===f.player.profile.id);assert.equal(p.progress.session,null);assert.equal(p.progress.lastLife.durationSeconds,12);
});
test('overlapping modes have stable priority and manual deployment flag cannot be cancelled by schedule',()=>{
 let at=100;const state=service.empty();state.windows=state.windows.map(w=>({...w,enabled:true,startsAt:100,endsAt:200}));
 const m=new Maintenance({now:()=>at});m.bind(()=>state);assert.equal(m.status().mode,'unavailable');state.windows[2].enabled=false;m.refreshState();assert.equal(m.status().mode,'failure');
 m.set(true);assert.equal(m.status().mode,'maintenance');at=200;m.refreshState();assert.equal(m.active,true);m.set(false);assert.equal(m.active,false);m.close();
});

test('actual Mongo failure closes admission with durable life result, marks automatic checkbox, logs recovery and preserves manual schedule',async t=>{
 const f=await fixture(t,{monitor:true});await eventually(()=>f.app.serviceObserver.snapshot().at!==null);
 const ws=await f.connect(),closed=once(ws,'close');f.advance(9000);
 f.mongo.health={state:'error',lastError:'MONGO_OPERATION_FAILED'};f.app.serviceObserver.sample();assert.equal(f.maintenance.status().mode,'failure');assert.equal(f.maintenance.status().automatic,true);
 assert.equal((await closed)[0],1012);const p=Object.values(recover(f.file).data.profiles).find(p=>p.id===f.player.profile.id);assert.equal(p.progress.session,null);assert.equal(p.progress.lastLife.durationSeconds,9);
 assert.equal((await f.call('/api/admin/monitoring',null,f.player.token)).status,403);assert.equal((await f.call('/api/admin/service-journal',null,f.player.token)).status,403);
 assert.equal((await f.call('/api/admin/maintenance')).data.automatic.active,true);
 const manual=await f.call('/api/admin/maintenance',f.command('maintenance',f.at,f.at+10000));assert.equal(manual.status,200);assert.equal(f.maintenance.status().mode,'failure');
 f.mongo.health={state:'ok'};f.advance(5000);f.app.serviceObserver.sample();assert.equal(f.maintenance.status().mode,'maintenance');assert.equal((await f.call('/api/admin/maintenance')).data.automatic.active,false);
 f.advance(5000);f.maintenance.refreshState();assert.equal(f.maintenance.active,false);
 const journal=await f.call('/api/admin/service-journal');assert.equal(journal.status,200);
 for(const reason of ['MONGODB_FAILED','Период, установленный владельцем'])assert.deepEqual(journal.data.entries.filter(e=>e.reason===reason).map(e=>e.kind),['ended','started']);
 assert.ok(!JSON.stringify(journal.data).includes(f.player.token));
});

test('graphs stay idle without the visible owner overview; lease expiry stops disk samples and Mongo instrumentation while incidents remain monitored',async t=>{
 const f=await fixture(t,{monitor:true});await eventually(()=>f.app.serviceObserver.snapshot().at!==null);
 assert.deepEqual(f.app.serviceObserver.snapshot().series,[]);assert.deepEqual(f.metricSwitches,[false]);
 assert.equal((await f.call('/api/admin/monitoring?graphs=1',null,f.player.token)).status,403);assert.deepEqual(f.metricSwitches,[false]);
 await f.call('/api/admin/monitoring?graphs=1');await eventually(()=>f.app.serviceObserver.snapshot().collecting===true);assert.deepEqual(f.metricSwitches,[false,true]);
 f.advance(5000);f.mongo.metrics={...f.mongo.metrics,at:f.at,read:10,write:5};f.app.serviceObserver.sample();await eventually(()=>f.app.serviceObserver.snapshot().at===f.at);assert.ok(f.app.serviceObserver.snapshot().series.length>=2);
 f.advance(15000);f.app.serviceObserver.sample();await eventually(()=>f.app.serviceObserver.snapshot().at===f.at);assert.equal(f.app.serviceObserver.snapshot().collecting,false);assert.deepEqual(f.metricSwitches,[false,true,false]);const length=f.app.serviceObserver.snapshot().series.length;
 f.mongo.health={state:'error'};f.advance(5000);f.app.serviceObserver.sample();await eventually(()=>f.app.serviceObserver.snapshot().at===f.at);assert.equal(f.maintenance.status().automatic,true);assert.equal(f.app.serviceObserver.snapshot().series.length,length);
 f.mongo.health={state:'ok'};f.app.serviceObserver.sample();assert.equal(f.maintenance.status().automatic,false);
});
