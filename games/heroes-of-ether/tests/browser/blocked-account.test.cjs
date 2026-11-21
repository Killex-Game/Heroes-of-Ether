'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events'),pw=require('playwright');
const {createGameServer}=require('../../src/server/game-server'),{ProfileStore}=require('../../src/server/profiles/profile-store'),{Arena}=require('../../src/server/arena/arena-simulation');
const out=path.resolve(process.env.BLOCKED_TEST_OUTPUT||path.join(__dirname,'../../../../artifacts/blocked-account-public-20261114/browser'));
fs.mkdirSync(out,{recursive:true});
const profiles=new ProfileStore(),auth=profiles.open(),app=createGameServer({profiles,arena:new Arena({etherCount:0}),autoTick:false,testBots:{enabled:false}});
let browser,upstream;
// Match the deployed public proxy boundary: owner files remain inaccessible.
const proxy=http.createServer((req,res)=>{
 if(process.env.BROWSER_ASSET_ROOT && req.url.startsWith('/assets/')){
   const root=path.resolve(process.env.BROWSER_ASSET_ROOT),file=path.resolve(root,decodeURIComponent(req.url.split('?')[0].slice('/assets/'.length)));
   if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
   return fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(b);});
 }
 if(req.url.startsWith('/ui/admin/')||req.url.split('?')[0]==='/admin.html'){res.writeHead(404);return res.end();}
 const target=http.request({hostname:'127.0.0.1',port:upstream,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
 target.on('error',()=>{res.writeHead(502);res.end();});req.pipe(target);
});
async function main(){
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');upstream=app.httpServer.address().port;
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const url='http://127.0.0.1:'+proxy.address().port;
 for(const engine of (process.env.BLOCKED_TEST_ENGINES||'chromium,firefox,webkit').split(',')){
  browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
  const context=await browser.newContext({viewport:{width:1366,height:768},timezoneId:'Asia/Yekaterinburg'});
  await context.addCookies([{name:'sferorumiya_session',value:auth.token,url}]);
  const page=await context.newPage(),errors=[],badAssets=[],adminRequests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/ui/admin/'))adminRequests.push(r.url());});
  page.on('response',r=>{if(r.status()>=400&&['script','stylesheet','image'].includes(r.request().resourceType()))badAssets.push({url:r.url(),status:r.status()});});
  const reason='Нарушение правил <img src=x onerror=alert(1)>';
  const setBan=until=>{profiles.find(auth.token).moderation={version:1,ban:{at:Date.now()-60000,until,reason,by:'owner',id:'K7M2Q9'}};};
  setBan(Date.now()+3600000);
  await page.goto(url+'/blocked.html');
  await page.waitForFunction(()=>document.getElementById('title').textContent==='Аккаунт заблокирован',null,{timeout:6000});
  assert.equal(await page.locator('#reason').textContent(),'Причина: '+reason);
  assert.equal(await page.locator('#reason img').count(),0);
  assert.equal(await page.locator('#banId').textContent(),'ID бана: K7M2Q9');
  assert.equal(await page.locator('#moderator').textContent(),'Модератор: Killex');
  assert(await page.evaluate(()=>['banId','reason','moderator','until'].every((id,i,ids)=>!i||document.getElementById(id).getBoundingClientRect().top>document.getElementById(ids[i-1]).getBoundingClientRect().top)));
  assert.match(await page.locator('#until').textContent(),/^До /);
  assert.equal(await page.locator('#check').isEnabled(),true);
  assert.equal((await context.request.get(url+'/api/profile')).status(),403);
  assert.equal((await context.request.get(url+'/admin.html')).status(),404);
  for(const width of [1366,390]){await page.setViewportSize({width,height:768});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,`${engine}-${width}.png`)});}
  for(const [by,byName,expected]of [['moderator:test','Имя <img src=x onerror=alert(1)>','Имя <img src=x onerror=alert(1)>'],['system:chat',null,'Системная блокировка']]){
    Object.assign(profiles.find(auth.token).moderation.ban,{by,...(byName?{byName}:{})});
    await page.locator('#check').click();await page.waitForFunction(text=>document.getElementById('moderator').textContent==='Модератор: '+text,expected);
    assert.equal(await page.locator('#moderator img').count(),0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  setBan(null);await page.locator('#check').click();await page.waitForFunction(()=>document.getElementById('until').textContent==='Блокировка без срока окончания.');
  let checks=0;await page.route('**/api/access',async route=>{checks++;await new Promise(resolve=>setTimeout(resolve,250));await route.continue();});
  await page.locator('#check').click();assert(await page.locator('#check').isDisabled());await page.waitForFunction(()=>!document.getElementById('check').disabled);assert.equal(checks,1);await page.unroute('**/api/access');
  await page.route('**/api/access',route=>route.fulfill({status:503,body:'unavailable'}));await page.locator('#check').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Не удалось связаться'));
  assert(await page.locator('#check').isEnabled());await page.unroute('**/api/access');
  await page.route(url+'/',route=>route.fulfill({contentType:'text/html',body:'<h1>Return destination</h1>'}));
  profiles.find(auth.token).moderation.ban=null;
  await Promise.all([page.waitForURL(url+'/'),page.locator('#check').click()]);
  setBan(Date.now()-1000);await page.goto(url+'/blocked.html');await page.waitForURL(url+'/');
  assert.deepEqual(errors,[]);assert.deepEqual(badAssets,[]);assert.deepEqual(adminRequests,[]);
  fs.writeFileSync(path.join(out,engine+'.json'),JSON.stringify({passed:true,temporary:true,permanent:true,expired:true,unban:true,errorRetry:true,duplicatesPrevented:true,reasonEscaped:true,adminProtected:true,errors,badAssets},null,2));
  console.log(engine+': public blocked page, ban details, expiry/unban, retry, desktop/mobile PASS');
  await browser.close();browser=null;
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>proxy.close(resolve));await app.close();});
