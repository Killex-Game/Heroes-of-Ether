'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHmac,randomUUID}=require('node:crypto'),{once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {createGameServer}=require('../../src/server/game-server');
const {Arena}=require('../../src/server/arena/arena-simulation');
const launch=require('../../src/server/platform/launch');
const {PlatformSessions}=require('../../src/server/platform/sessions');
const {validate}=require('../../src/server/platform/config');
const NOW=Date.UTC(2026,10,25,12), config={enabled:true,vkAppId:'123',okAppId:'789',appSecret:'test-app-secret',sessionSecret:'a'.repeat(64),requirePlatform:false};
function signed(extra={},secret=config.appSecret){const fields={vk_app_id:'123',vk_user_id:'456',vk_ts:String(NOW/1000),...extra};
 const q=Object.keys(fields).sort().map(k=>k+'='+encodeURIComponent(fields[k])).join('&');return q+'&sign='+createHmac('sha256',secret).update(q).digest('base64url');}
const ok={vk_client:'ok',vk_ok_app_id:'789',vk_ok_user_id:'9007199254740993'};
function store(t,journal=false){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'heroether-social-')); const filePath=path.join(dir,'profiles.json');const s=new ProfileStore({filePath,journal,now:()=>NOW});t.after(async()=>{await s.close();fs.rmSync(dir,{recursive:true,force:true});});return s;}
test('signed site and stable OK LongID; original VK ID does not move an OK profile',()=>{
 const a=launch.verify(signed(ok),config,NOW),b=launch.verify(signed({...ok,vk_user_id:'987',vk_original_vk_id:'456'}),config,NOW);
 assert.deepEqual(a,b);assert.equal(a.userId,'9007199254740993');assert.equal(launch.profileToken(a,config.sessionSecret),launch.profileToken(b,config.sessionSecret));
 assert.notEqual(launch.profileToken(a,config.sessionSecret),launch.profileToken(launch.verify(signed({vk_user_id:a.userId}),config,NOW),config.sessionSecret));
 assert.throws(()=>launch.profileToken({...a},config.sessionSecret),/NOT_VERIFIED/);
 for(const p of [{...ok,vk_ok_app_id:'790'},{...ok,vk_ok_user_id:''},{...ok,vk_ok_user_id:'9223372036854775808'},{vk_client:'evil'}, {vk_app_id:'124'},{vk_ts:String(NOW/1000-301)},{vk_ts:String(NOW/1000+31)},{vk_user_id:'0'},{vk_user_id:'0456'},{vk_ok_user_id:'123'}])assert.equal(launch.verify(signed(p),config,NOW),null);
 assert.equal(launch.verify(signed(ok)+'&vk_client=vk',config,NOW),null);
 assert.equal(launch.verify(signed(ok).replace('vk_client=ok','vk_client=vk'),config,NOW),null);
 assert.equal(launch.verify(signed()+'&client=ok',config,NOW).network,'vk');
});
test('invalid configuration fails closed; disabled integration needs no credentials',()=>{
 assert.equal(validate(null),null);assert.equal(validate({enabled:false}),null);
 for(const bad of [{...config,vkAppId:123},{...config,sessionSecret:''},{...config,okAppId:789},{...config,requirePlatform:undefined}])assert.throws(()=>validate(bad),/CONFIG_INVALID/);
});
test('one new profile across login, device, restart and app-secret rotation; guests stay untouched',t=>{
 const s=store(t),guest=s.open(),before=structuredClone(s.find(guest.token));
 const identity=launch.verify(signed(ok),config,NOW),first=s.openPlatform(identity,config.sessionSecret);
 s.transact(first.token,randomUUID(),'earned',p=>{p.wallet.coins+=7;p.inventory.freeze=3;});
 const again=s.openPlatform(launch.verify(signed({...ok,vk_user_id:'987'}),config,NOW),config.sessionSecret);
 assert.equal(again.profile.id,first.profile.id);assert.equal(again.profile.wallet.coins,107);assert.equal(Object.keys(s.data.profiles).length,2);assert.deepEqual(s.find(guest.token),before);
 const restored=new ProfileStore({filePath:s.filePath,now:()=>NOW}),rotated={...config,appSecret:'new-app-secret'};
 const binding=restored.find(first.token).platformIdentity;
 restored.find(first.token).platformIdentity=Object.fromEntries(Object.entries(binding).reverse());
 const next=restored.openPlatform(launch.verify(signed(ok,rotated.appSecret),rotated,NOW),config.sessionSecret);
 assert.equal(next.profile.id,first.profile.id);assert.equal(next.profile.inventory.freeze,3);
 assert.throws(()=>restored.openPlatform(identity,'b'.repeat(64)),/восстановить профиль/);assert.equal(Object.keys(restored.data.profiles).length,2);
 assert.equal(require('../../src/server/profiles/empty-registration').isEmptyRegistration(s.find(first.token)),false);
 assert.throws(()=>s.confirmMockPurchase(first.token,{productId:'account:vip',confirmed:true,requestId:randomUUID()}),e=>e.status===403);
 assert.throws(()=>s.activateAccount(first.token,{kind:'vip',requestId:randomUUID()}),e=>e.status===403);
});
test('failed save issues neither session nor profile; WAL restores the binding',async t=>{
 const s=store(t,true),sessions=new PlatformSessions(config,{now:()=>NOW}),identity=sessions.authenticate(signed());
 const before=s.data,save=s.save;s.save=()=>{throw Error('disk failed');};assert.throws(()=>sessions.issue(identity,s),/disk failed/);assert.strictEqual(s.data,before);assert.equal(sessions.sessions.size,0);s.save=save;
 const result=sessions.issue(identity,s),persisted=require('../../src/server/profiles/profile-journal').recover(s.filePath).data;
 assert(Object.values(persisted.profiles).some(p=>p.id===result.profile.id&&p.platformIdentity.userId==='456'));
});
test('bearer and socket tickets expire; invalid tickets never fall back to another cookie profile',t=>{
 let at=NOW;const s=store(t),sessions=new PlatformSessions(config,{now:()=>at,maxSessions:2}),identity=sessions.authenticate(signed());
 const a=sessions.issue(identity,s),b=sessions.issue(identity,s),fallback=()=>{throw Error('cookie fallback');};
 const req=raw=>({headers:{authorization:'Bearer '+raw}});
 assert.equal(s.find(sessions.token(req(a.ticket),fallback)).id,a.profile.id);
 assert.equal(sessions.token({headers:{'sec-websocket-protocol':'sferorumiya-state-v1, killex-session.'+b.ticket}},fallback),sessions.token(req(a.ticket),fallback));
 assert.throws(()=>sessions.issue(identity,s),e=>e.status===503);assert.equal(sessions.token(req('b'.repeat(64)),fallback),undefined);
 at+=12*3600000;assert.equal(sessions.token(req(a.ticket),fallback),undefined);assert.equal(sessions.sessions.size,2);
 sessions.issue(identity,s);assert.equal(sessions.sessions.size,1);
});
test('real HTTP launch without cookies, strict origin, no guest fallback, preserved admin frame protection',async t=>{
 const s=store(t),app=createGameServer({profiles:s,socialConfig:config,wallNow:()=>NOW,autoTick:false,arena:new Arena({etherCount:0}),testBots:{enabled:false}});
 t.after(()=>app.close());app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const base='http://127.0.0.1:'+app.httpServer.address().port;
 const login=()=>fetch(base+'/api/platform/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({launch:signed(ok)})});
 const results=await Promise.all([login(),login()]),sessions=await Promise.all(results.map(r=>{assert.equal(r.status,200);return r.json();}));
 assert.equal(Object.keys(s.data.profiles).length,1);assert.notEqual(sessions[0].ticket,sessions[1].ticket);
 const read=await fetch(base+'/api/profile',{headers:{Authorization:'Bearer '+sessions[0].ticket}});assert.equal(read.status,200);const p=(await read.json()).profile;assert.equal(p.platform,'ok');assert.equal(read.headers.get('set-cookie'),null);
 const invalid=await fetch(base+'/api/profile',{headers:{Authorization:'Bearer '+'0'.repeat(64)}});assert.equal(invalid.status,401);assert.equal(Object.keys(s.data.profiles).length,1);
 const cross=await fetch(base+'/api/platform/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.invalid'},body:JSON.stringify({launch:signed()})});assert.equal(cross.status,403);
 const page=await fetch(base+'/?'+signed());assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.equal(page.headers.get('x-frame-options'),null);
 const admin=await fetch(base+'/admin.html');assert.equal(admin.headers.get('x-frame-options'),'DENY');
 const WebSocket=require('ws'),ws=new WebSocket(base.replace('http:','ws:')+'/', ['sferorumiya-state-v1','killex-session.'+sessions[0].ticket],{headers:{Origin:base}});
 t.after(()=>ws.terminate());await once(ws,'open');assert.equal(ws.protocol,'sferorumiya-state-v1');ws.close();
});
test('platform-only server refuses anonymous registration',async t=>{
 const s=store(t),app=createGameServer({profiles:s,socialConfig:{...config,requirePlatform:true},autoTick:false,arena:new Arena({etherCount:0}),testBots:{enabled:false}});
 t.after(()=>app.close());app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const r=await fetch('http://127.0.0.1:'+app.httpServer.address().port+'/api/profile');assert.equal(r.status,401);assert.equal(Object.keys(s.data.profiles).length,0);
});
test('real PostgreSQL retains social identity and progress atomically',{skip:!process.env.HEROETHER_PG_TEST_CONFIG},async t=>{
 const {PostgreSQLState}=require('../../src/server/persistence/postgresql-state'),{pack}=require('../../src/server/persistence/state-snapshot');
 const cfg={...JSON.parse(fs.readFileSync(process.env.HEROETHER_PG_TEST_CONFIG,'utf8')),schema:'heroether_test_'+randomUUID().replaceAll('-','')};
 const state=new PostgreSQLState(cfg),s=store(t);
 try{
  const beforeWorld={...s.data,_journalRevision:1},before=pack(beforeWorld,{});await state.initialize(before);await state.acquire(before);
  const identity=launch.verify(signed(ok),config,NOW),a=s.openPlatform(identity,config.sessionSecret);
  s.transact(a.token,randomUUID(),'earned',p=>{p.wallet.coins+=5;p.inventory.freeze=7;});
  const world={...s.data,_journalRevision:2},next=pack(world,{}),put=state.put;
  state.put=async function(client,docs){await put.call(this,client,docs.slice(0,1));throw Error('injected social save failure');};
  await assert.rejects(state.sync(next),/injected social/);state.put=put;assert.deepEqual((await state.read()).world,beforeWorld);
  await state.sync(next);const read=await state.read();assert.deepEqual(read.world,world);
  const restored=new ProfileStore({now:()=>NOW});restored.data=read.world;
  const reopened=restored.openPlatform(identity,config.sessionSecret);assert.equal(reopened.profile.id,a.profile.id);assert.equal(reopened.profile.inventory.freeze,7);assert.equal(reopened.profile.wallet.coins,105);
 }finally{assert(/^heroether_test_[a-f0-9]{32}$/.test(cfg.schema));await state.pool.query(`DROP SCHEMA ${state.table} CASCADE`);state.manifestValue=null;await state.close();}
});
