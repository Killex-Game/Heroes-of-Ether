'use strict';
// Real game HTTP + browser bootstrap; SDK host replies are mocked explicitly.
// Real VK/OK launch and payment tests require registered app credentials.
const test=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events'),{createHmac}=require('node:crypto');
const playwright=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createGameServer}=require('../../src/server/game-server'),{Arena}=require('../../src/server/arena/arena-simulation');
const config={enabled:true,requirePlatform:false,vkAppId:'123',okAppId:'789',appSecret:'browser-test-secret',sessionSecret:'c'.repeat(64)};
function signed(site){const f={vk_app_id:'123',vk_user_id:'456',vk_ts:String(Math.floor(Date.now()/1000)),...(site==='ok'?{vk_client:'ok',vk_ok_app_id:'789',vk_ok_user_id:'9007199254740993'}:{})};const q=Object.keys(f).sort().map(k=>k+'='+encodeURIComponent(f[k])).join('&');return q+'&sign='+createHmac('sha256',config.appSecret).update(q).digest('base64url');}
for(const engine of ['chromium','firefox','webkit'])test(engine+': iframe session transport and reload for VK/OK; ordinary page has zero SDK requests',async t=>{
 const app=createGameServer({socialConfig:config,autoTick:false,arena:new Arena({etherCount:0}),testBots:{enabled:false}});t.after(()=>app.close());
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const base='http://127.0.0.1:'+app.httpServer.address().port;
 const browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});t.after(()=>browser.close());
 const context=await browser.newContext();
 await context.route('**/social-container*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><iframe style="width:100%;height:600px" src="'+base+'/platform-test?'+signed(new URL(route.request().url()).searchParams.get('site'))+'"></iframe>'}));
 await context.route('**/platform-test*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="referrer" content="no-referrer"><script src="/shared/social-platform.js"></script><body>Platform transport fixture</body>'}));
 let sdkRequests=0;
 await context.route('**/vendor/vk-bridge/browser.min.js',route=>{sdkRequests++;return route.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:function(method){window.bridgeMethod=method;return Promise.resolve({result:true});}};'});});
 const ordinary=await context.newPage();await ordinary.goto(base+'/platform-test');assert.equal(await ordinary.evaluate(()=>!!window.KillexSocial),false);assert.equal(sdkRequests,0);
 for(const site of ['vk','ok']){
  const page=await context.newPage();await page.goto(base.replace('127.0.0.1','localhost')+'/social-container?site='+site);
  const frame=page.frames().find(f=>f.url().includes('/platform-test'));
  assert(frame);await frame.waitForFunction(()=>window.KillexSocial);
  const first=await frame.evaluate(async()=>{await KillexSocial.ready;const r=await fetch('/api/profile');return {status:r.status,data:await r.json(),method:window.bridgeMethod,url:location.search,protocols:KillexSocial.socketProtocols()};});
  assert.equal(first.status,200);assert.equal(first.data.profile.platform,site);assert.equal(first.method,'VKWebAppInit');assert.equal(first.url,'?social_launch=1');assert.equal(first.protocols.length,1);
  assert.equal(await frame.evaluate(async()=>(await fetch(new URL('/api/profile',location.href))).status),200);
  assert.equal((await context.cookies()).length,0);
  await frame.goto(frame.url());const reloaded=await frame.evaluate(async()=>{const r=await fetch('/api/profile');return r.json();});assert.equal(reloaded.profile.id,first.data.profile.id);
  const bad=await frame.evaluate(async()=>{sessionStorage.setItem('heroether.social-session.v1',JSON.stringify({ticket:'0'.repeat(64),network:'vk',expiresAt:Date.now()+100000}));return true;});assert(bad);
  await frame.goto(frame.url());assert.equal(await frame.evaluate(async()=>(await fetch('/api/profile')).status),401);
  await page.close();
 }
 assert.equal(Object.keys(app.profiles.data.profiles).length,2);
});
