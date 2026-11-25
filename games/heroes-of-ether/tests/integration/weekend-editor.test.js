'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto'),{once}=require('node:events');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),editor=require('../../src/server/shop/weekend-editor');
const {temporary}=require('../temp'),config=require('../../config/promotions.json'),catalog=require('../../public/shared/weekend-promotion-catalog');
const {createGameServer}=require('../../src/server/game-server'),{OwnerAccess}=require('../../src/server/admin/owner-access');
const START=Date.parse('2026-11-20T12:00:00+03:00'),id='promotion:weekend:01:2026-11-20:0';
function fixture(t,journal=false){let at=START;const filePath=path.join(temporary(t,'weekend-editor'),'world.json'),store=new ProfileStore({filePath,journal,now:()=>at,promotionConfig:config}),auth=store.open();
 t.after(()=>store.close?.());return {store,auth,filePath,p:()=>store.find(auth.token),set:n=>{at=n;},access:{isOwner:a=>a.id===auth.profile.id},actor:{id:auth.profile.id}};}
const offer=()=>({id:catalog.products[0].id,name:'Набор владельца',votes:2,purchaseLimit:1,rewards:[{kind:'currency',id:'bucks',amount:51},{kind:'booster',id:'freeze',amount:23}]});
function edit(f,extra){return editor.apply(f.store,f.access,f.actor,{action:'offer',offer:offer(),revision:f.store.data.weekendPromotions?.revision||0,reason:'Обновить набор',requestId:randomUUID(),...extra});}
const purchase=(extra={})=>({productId:id,confirmed:true,requestId:randomUUID(),...extra});
test('default catalog remains unchanged; owner edits share player tables, persist audit and reject stale/reused commands',t=>{
 const f=fixture(t),before=f.store.data;assert.equal(editor.view(f.store).offers.length,26);assert.strictEqual(f.store.data,before);
 const input={requestId:randomUUID()},out=edit(f,input);assert.equal(out.revision,1);assert.strictEqual(f.store.data.profiles,before.profiles);assert.strictEqual(f.store.data.clans,before.clans);
 assert.equal(f.store.data.administration.audit.at(-1).after.votes,2);assert.equal(editor.view(f.store).offers[0].votes,2);assert.equal(catalog.products[0].votes,7);
 assert.equal(edit(f,{...input,revision:0}).replay,true);assert.throws(()=>edit(f,{...input,offer:{...offer(),votes:4}}),/использован/);
 assert.throws(()=>edit(f,{revision:0}),/другой вкладке/);assert.strictEqual(f.store.promotionSettings(),f.store.promotionSettings());
});
test('invalid composition, duplicate rewards, unknown IDs, prices and failed save never change state',t=>{
 const f=fixture(t),before=f.store.data;
 for(const o of [{...offer(),votes:0},{...offer(),votes:1.5},{...offer(),id:'promotion:starter'},{...offer(),purchaseLimit:6},{...offer(),rewards:[]},{...offer(),rewards:[{kind:'currency',id:'__proto__',amount:1}]},{...offer(),rewards:[...offer().rewards,...offer().rewards]},{...offer(),rewards:[{kind:'booster',id:'freeze',amount:Infinity}]}])assert.throws(()=>edit(f,{offer:o}));
 assert.strictEqual(f.store.data,before);const save=f.store.save;f.store.save=()=>{throw Error('disk failed');};assert.throws(()=>edit(f),/disk failed/);assert.strictEqual(f.store.data,before);f.store.save=save;
 assert.throws(()=>editor.apply(f.store,{isOwner:()=>false},f.actor,{}),e=>e.status===403);
});
test('server composition and quote; receipt replay keeps historical price, inventory, achievements and purchase limit',t=>{
 const f=fixture(t);edit(f);const before=structuredClone(f.p()),order=purchase({promotionRevision:1});
 assert.throws(()=>f.store.confirmMockPurchase(f.auth.token,purchase()),/Условия акции/);assert.deepEqual(f.p(),before);
 const visible=f.store.view(f.p());assert.equal(visible.promotionProducts[id].votes,2);assert.equal(visible.promotionProducts[id].exactBoosters.freeze,23);
 const result=f.store.confirmMockPurchase(f.auth.token,order);assert.equal(result.payment.votes,2);assert.equal(f.p().wallet.bucks,before.wallet.bucks+51);assert.equal(f.p().inventory.freeze,(before.inventory.freeze||0)+23);assert.equal(f.p().activity.values.banker,before.activity.values.banker+51);
 assert.equal(f.p().transactions.entries.at(-1).payment.votes,2);edit(f,{offer:{...offer(),votes:14,rewards:[{kind:'currency',id:'coins',amount:999}]}});
 const after=structuredClone(f.p());const replay=f.store.confirmMockPurchase(f.auth.token,order);assert.equal(replay.replay,true);assert.equal(replay.payment.votes,2);assert.deepEqual(f.p(),after);
 assert.throws(()=>f.store.confirmMockPurchase(f.auth.token,purchase({promotionRevision:2})),/уже куплен/);
});
test('configured Friday time, duration, order, one cycle and pause; defaults remain separate',t=>{
 const f=fixture(t),schedule={enabled:true,startsOn:'2026-11-20',startTime:'14:30',durationHours:2,repeat:false,offerIds:[catalog.products[0].id,catalog.products[2].id]};
 edit(f,{action:'schedule',schedule});assert.equal(f.store.view(f.p()).promotions.length,0);
 f.set(START+2.5*3600000);assert.deepEqual(f.store.view(f.p()).promotions,[id]);assert.equal(f.store.virtualProduct(id).endsAt,START+4.5*3600000);
 f.set(START+4.5*3600000);assert.equal(f.store.view(f.p()).promotions.length,0);
 f.set(START+2.5*3600000+7*86400000);assert.equal(f.store.view(f.p()).promotions[0],'promotion:weekend:03:2026-11-20:1');
 f.set(START+2.5*3600000+14*86400000);assert.equal(f.store.view(f.p()).promotions.length,0);
 const version=f.store.view(f.p()).promotionVersion;edit(f,{action:'schedule',schedule:{...schedule,enabled:false}});assert.notEqual(f.store.view(f.p()).promotionVersion,version);
 for(const bad of [{...schedule,startsOn:'2026-11-21'},{...schedule,startTime:'25:00'},{...schedule,durationHours:169},{...schedule,offerIds:[]},{...schedule,offerIds:[catalog.products[0].id,catalog.products[0].id]}])assert.throws(()=>edit(f,{action:'schedule',schedule:bad}));
});
test('purchase save failure/overflow roll back all rewards and receipt; settings survive restart',t=>{
 const f=fixture(t);edit(f);const before=structuredClone(f.p()),save=f.store.save,order=purchase({promotionRevision:1});
 f.store.save=()=>{throw Error('disk failed');};assert.throws(()=>f.store.confirmMockPurchase(f.auth.token,order),/disk failed/);assert.deepEqual(f.p(),before);f.store.save=save;
 f.p().inventory.freeze=Number.MAX_SAFE_INTEGER;const overflow=structuredClone(f.p());assert.throws(()=>f.store.confirmMockPurchase(f.auth.token,order),/баланс/);assert.deepEqual(f.p(),overflow);
 const restored=new ProfileStore({filePath:f.filePath,now:()=>START,promotionConfig:config});assert.equal(editor.view(restored).offers[0].votes,2);assert.equal(restored.virtualProduct(id).promotionRevision,1);
});
test('WAL retains owner edit and purchase after immediate process exit, no duplicate grant',async t=>{
 const {spawnSync}=require('node:child_process'),filePath=path.join(temporary(t,'friday-editor-wal'),'world.json');
 const script=`const {ProfileStore}=require('./src/server/profiles/profile-store'),editor=require('./src/server/shop/weekend-editor');
 const store=new ProfileStore({filePath:process.argv[1],journal:true,now:()=>${START},promotionConfig:require('./config/promotions.json')}),a=store.open();
 editor.apply(store,{isOwner:()=>true},{id:a.profile.id},{action:'offer',offer:${JSON.stringify(offer())},revision:0,reason:'WAL recovery check',requestId:'friday-config-wal'});
 const order={productId:'${id}',promotionRevision:1,confirmed:true,requestId:'friday-purchase-wal'};store.confirmMockPurchase(a.token,order);
 process.stdout.write(JSON.stringify({token:a.token,profile:store.find(a.token),order}));process.exit(0);`;
 const child=spawnSync(process.execPath,['-e',script,filePath],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'});assert.equal(child.status,0,child.stderr);const saved=JSON.parse(child.stdout);
 const store=new ProfileStore({filePath,journal:true,now:()=>START,promotionConfig:config});try{assert.deepEqual(store.find(saved.token),saved.profile);assert.equal(editor.view(store).offers[0].votes,2);assert.equal(store.confirmMockPurchase(saved.token,saved.order).replay,true);assert.deepEqual(store.find(saved.token),saved.profile);}finally{await store.close();}
});
test('HTTP requires owner and CSRF; edited price reaches profile and rejects stale checkout',async t=>{
 const profiles=new ProfileStore({now:()=>START,promotionConfig:config}),auth=profiles.open(),access=new OwnerAccess({ownerId:auth.profile.id,now:()=>START});
 const app=createGameServer({profiles,ownerAccess:access,wallNow:()=>START,autoTick:false,testBots:{enabled:false}});app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');t.after(()=>app.close());
 const url='http://127.0.0.1:'+app.httpServer.address().port;let cookie='',csrf='';
 const call=async(route,body,headers={})=>{const r=await fetch(url+route,{method:body?'POST':'GET',headers:{Origin:url,Cookie:'sferorumiya_session='+auth.token+'; '+cookie,...(body?{'Content-Type':'application/json','X-Owner-CSRF':csrf}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,headers:r.headers,data:await r.json()};};
 assert.equal((await call('/api/admin/weekend-promotions')).status,401);
 const login=await call('/api/admin/setup',{password:'Isolated Friday editor password 2026',setupCode:access.bootstrapCode});assert.equal(login.status,200,JSON.stringify(login.data));cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.data.csrf;
 const body={action:'offer',offer:offer(),revision:0,reason:'HTTP editor check',requestId:randomUUID()};
 assert.equal((await call('/api/admin/weekend-promotions',body,{'X-Owner-CSRF':'wrong'})).status,403);
 assert.equal((await call('/api/admin/weekend-promotions',body)).status,200);
 assert.equal((await call('/api/mock-payments/confirm',purchase())).status,409);
 const bought=await call('/api/mock-payments/confirm',purchase({promotionRevision:1}));assert.equal(bought.status,200,JSON.stringify(bought.data));assert.equal(bought.data.payment.votes,2);
});
test('Russian vote prices use grammatical singular, paucal and plural',()=>{
 const {votesLabel}=require('../../public/shared/virtual-product-catalog');
 for(const [n,label] of [[1,'1 голос'],[2,'2 голоса'],[4,'4 голоса'],[5,'5 голосов'],[11,'11 голосов'],[12,'12 голосов'],[14,'14 голосов'],[21,'21 голос'],[22,'22 голоса'],[112,'112 голосов']])assert.equal(votesLabel(n),label);
});
