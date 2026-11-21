'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),WebSocket=require('ws');
const {temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store'),{createGameServer}=require('../../src/server/game-server'),{Arena}=require('../../src/server/arena/arena-simulation');
const {ArenaTestingGate,MESSAGE}=require('../../src/server/runtime/arena-testing-gate'),{recover}=require('../../src/server/profiles/profile-journal');
const eventually=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}assert.ok(check(),'Condition did not settle');};
async function fixture(t){
 let at=Date.now(),gameAt=1000,cleanup;const dir=temporary({after(fn){cleanup=fn;}},'arena-testing'),file=path.join(dir,'profiles.json');
 const profiles=new ProfileStore({filePath:file,journal:true,now:()=>at}),player=profiles.open(),gate=new ArenaTestingGate({now:()=>at});
 const app=createGameServer({profiles,arenaTesting:gate,now:()=>gameAt,wallNow:()=>at,autoTick:false,arena:new Arena({etherCount:0}),testBots:{enabled:false}});
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');t.after(async()=>{await app.close();cleanup();});
 const url='http://127.0.0.1:'+app.httpServer.address().port;
 const call=async(route,body)=>{const r=await fetch(url+route,{method:body?'POST':'GET',headers:{Cookie:'sferorumiya_session='+player.token,Origin:url,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};};
 const connect=async()=>{const ws=new WebSocket(url.replace('http:','ws:'),{headers:{Cookie:'sferorumiya_session='+player.token}});ws.on('error',()=>{});await once(ws,'open');await eventually(()=>!!profiles.byId(player.profile.id).progress.session);return ws;};
 return{app,profiles,player,gate,call,connect,file,url,advance(ms){at+=ms;gameAt+=ms;},get at(){return at;},closeArena(ms=60000){gate.read(JSON.stringify({id:'test-run',expiresAt:at+ms}));gate.refreshState();}};
}
test('arena-only test closure saves the life before notification, blocks HTTP/WS admission and keeps the lobby open',async t=>{
 const f=await fixture(t),ws=await f.connect(),inventory=structuredClone(f.profiles.byId(f.player.profile.id).inventory),closed=once(ws,'close');
 let notice=false;ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='arenaClosed'){
  const saved=Object.values(recover(f.file).data.profiles).find(p=>p.id===f.player.profile.id);
  assert.equal(saved.progress.session,null);assert.equal(saved.progress.lastLife.durationSeconds,12);assert.equal(m.message,MESSAGE);notice=true;
 }});
 f.advance(12000);f.closeArena();assert.equal((await closed)[0],1013);assert.equal(notice,true);
 for(const route of ['/api/profile','/api/presence','/api/service-status'])assert.equal((await f.call(route)).status,200);
 assert.equal((await f.call('/api/service-status')).data.maintenance,false);
 assert.equal((await f.call('/api/arenas')).data.code,'ARENA_TEMPORARILY_CLOSED');
 assert.equal((await f.call('/api/arena-reservations',{requestId:randomUUID()})).data.code,'ARENA_TEMPORARILY_CLOSED');
 assert.deepEqual((await f.call('/api/arena/availability')).data,{ready:false,closed:true,draining:false,message:MESSAGE});
 await new Promise((resolve,reject)=>{const s=new WebSocket(f.url.replace('http:','ws:'));s.on('error',()=>{});s.on('open',()=>reject(Error('Entered closed arena')));s.on('unexpected-response',(_,r)=>{assert.equal(r.statusCode,503);r.resume();s.terminate();resolve();});});
 assert.deepEqual(f.profiles.byId(f.player.profile.id).inventory,inventory);
 assert.equal([...f.app.arena.players.values()].filter(p=>p.isRemnant).length,0);
 const saved=structuredClone(f.profiles.data);f.gate.refreshState();assert.deepEqual(f.profiles.data,saved);
 f.advance(60000);f.gate.refreshState();assert.equal((await f.call('/api/arena/availability')).data.ready,true);
 const again=await f.connect();again.close();
});
test('failed final save holds arena closure after lease expiry and preserves the frozen duration on retry',async t=>{
 const f=await fixture(t),ws=await f.connect();let closed=false;ws.on('close',()=>closed=true);f.advance(12000);
 const original=f.profiles.applyArenaProgress.bind(f.profiles);let refuse=true;
 f.profiles.applyArenaProgress=(...args)=>{if(refuse)throw Error('Injected test disk refusal');return original(...args);};
 f.closeArena(500);await new Promise(r=>setTimeout(r,80));assert.equal(closed,false);assert.equal(f.gate.status().draining,true);
 f.advance(1000);f.gate.refreshState();assert.equal(f.gate.active,true);assert.equal((await f.call('/api/profile')).status,200);
 refuse=false;await eventually(()=>closed);assert.equal(f.gate.active,false);
 const p=Object.values(recover(f.file).data.profiles).find(p=>p.id===f.player.profile.id);assert.equal(p.progress.lastLife.durationSeconds,12);assert.equal(p.progress.session,null);
});
test('operator lease is bounded, survives server restart, expires and cannot permanently lock the arena on malformed input',async t=>{
 const file=path.join(temporary(t,'arena-testing-lease'),'arena-testing.json');let at=1000;
 fs.writeFileSync(file,JSON.stringify({id:'load-run',expiresAt:at+60000}));const gate=new ArenaTestingGate({filePath:file,now:()=>at});t.after(()=>gate.close());
 assert.equal(gate.active,true);assert.throws(()=>gate.read(JSON.stringify({id:'infinite',expiresAt:at+31*60000})),/Invalid/);
 fs.writeFileSync(file,'broken');await gate.refresh();assert.equal(gate.active,true);at+=60000;gate.refreshState();assert.equal(gate.active,false);
 fs.unlinkSync(file);await gate.refresh();assert.equal(gate.lastError,null);assert.equal(gate.active,false);
});
