'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events'),pw=require('playwright');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{OwnerAccess}=require('../../src/server/admin/owner-access'),{Maintenance}=require('../../src/server/runtime/maintenance'),{createGameServer}=require('../../src/server/game-server');
const engine=process.argv[2]||'chromium',out=process.env.SERVICE_TEST_OUTPUT?path.resolve(process.env.SERVICE_TEST_OUTPUT):path.resolve(__dirname,'../../../../artifacts/service-controls-20261114/browser-'+engine);fs.mkdirSync(out,{recursive:true});
let at=Math.floor(Date.now()/60000)*60000;const profiles=new ProfileStore({now:()=>at}),auth=profiles.open(),p=profiles.find(auth.token);
p.name='Мастер';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};p.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(at),day:1};
const monitorDirectory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'service-browser-')),mongo={enabled:true,health:{state:'ok'},metrics:{epoch:'browser',at,read:0,write:0}};
const access=new OwnerAccess({ownerId:p.id}),maintenance=new Maintenance({now:()=>at}),app=createGameServer({profiles,ownerAccess:access,maintenance,wallNow:()=>at,testBots:{enabled:false},monitorDirectory,mongoMonitor:()=>mongo});
const report={engine,checks:[],errors:[],missing:[]};let browser;
const stamp=t=>new Date(t+3*3600000).toISOString().slice(0,16);
async function dismiss(page){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));}
(async()=>{try{
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1366,height:900},timezoneId:'Asia/Yekaterinburg'});
 await context.addCookies([{name:'sferorumiya_session',value:auth.token,url,httpOnly:true}]);
 await context.addInitScript(()=>document.addEventListener('killex:profile',e=>{localStorage.setItem(KillexPlatform.storageKey('.releaseNotes.v1.'+e.detail.id),KillexRelease.id);localStorage.setItem(KillexPlatform.storageKey('.achievement-notices.v1.')+e.detail.id,JSON.stringify(Object.fromEntries((e.detail.progress?.achievements||[]).map(a=>[a.id,10]))));}));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()===404)report.missing.push(r.url());});
 await page.goto(url);await page.waitForFunction(()=>!KillexBoot.active&&!document.getElementById('playButton').disabled);await dismiss(page);
 const admin=await context.newPage();admin.on('pageerror',e=>report.errors.push(e.message));await admin.goto(url+'/admin.html');await admin.locator('#setupCode').fill(access.bootstrapCode);await admin.locator('#password').fill('Long maintenance owner password');await admin.locator('#loginForm button').click();await admin.locator('#workspace').waitFor({state:'visible'});
 await admin.locator('#ownerNavigation [data-admin-target="maintenance"]').click();await admin.locator('#maintenanceForm').waitFor();assert.equal(await admin.locator('.service-mode input[type="checkbox"]').count(),3);
 async function save(mode,start=at,end=at+3600000){
   for(const id of ['maintenance','failure','unavailable'])await admin.locator('#service-'+id).setChecked(id===mode);
   if(mode){await admin.locator('#service-'+mode+'-startsAt').fill(stamp(start));await admin.locator('#service-'+mode+'-endsAt').fill(stamp(end));}
   await admin.locator('#service-reason').fill('Браузерная проверка');await admin.locator('#maintenanceForm button[type="submit"]').click();await admin.locator('#service-save-status').getByText('Расписание сохранено.',{exact:true}).waitFor();
 }
 await save('failure',at+60000,at+120000);assert.equal(maintenance.active,false);assert.equal(profiles.data.serviceAvailability.windows[1].startsAt,at+60000);report.checks.push('schedule uses Moscow time in a different browser timezone');
 await page.bringToFront();await page.locator('#playButton').click();await page.waitForFunction(()=>document.body.dataset.screen==='arena');
 at+=60000;maintenance.refreshState();await page.locator('#maintenanceTitle').getByText('Что-то пошло не так',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.getElementById('maintenanceDialog').open);for(let i=0;i<100&&profiles.byId(p.id).progress.session;i++)await page.waitForTimeout(20);assert.equal(profiles.byId(p.id).progress.session,null);
 await page.evaluate(()=>KillexWindows.open(document.getElementById('connectionLostDialog')));assert.equal(await page.locator('#connectionLostDialog').isVisible(),false);report.checks.push('scheduled activation stops arena, settles life, keeps gate above other dialogs');
 for(const [mode,title] of [['maintenance','Техническое обновление'],['failure','Что-то пошло не так'],['unavailable','Игра временно недоступна']]){
   await admin.bringToFront();await save(mode);await page.bringToFront();await page.evaluate(()=>KillexMaintenance.check());await page.locator('#maintenanceTitle').getByText(title,{exact:true}).waitFor();
   for(const [width,height] of [[1366,900],[390,844],[320,568],[844,390]]){
     await page.setViewportSize({width,height});const bounds=await page.locator('#maintenanceDialog').evaluate(d=>{const r=d.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:d.scrollWidth-d.clientWidth};});
     assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.right<=bounds.w+1&&bounds.bottom<=bounds.h+1&&bounds.overflow<=1,JSON.stringify(bounds));
     await page.locator('#maintenanceDialog').screenshot({path:path.join(out,`${mode}-${width}.png`)});report.checks.push({mode,width,bounds});
   }
 }
 await admin.bringToFront();await admin.setViewportSize({width:1366,height:1000});await admin.locator('#maintenancePanel').screenshot({path:path.join(out,'admin.png')});
 await admin.setViewportSize({width:390,height:844});assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await admin.screenshot({path:path.join(out,'admin-mobile.png')});await admin.setViewportSize({width:1366,height:1000});
 await save(null);await page.bringToFront();await page.evaluate(()=>KillexMaintenance.check());await page.locator('#maintenanceDialog button').waitFor({state:'visible'});await page.locator('#maintenanceDialog button').click();await page.waitForFunction(()=>window.KillexBoot&&!window.KillexBoot.active);await dismiss(page);
 for(let i=0;i<12;i++){at+=5000;mongo.metrics={...mongo.metrics,at,read:20+i*4,write:10+i*2};app.serviceObserver.requestMetrics();app.serviceObserver.sample();for(let j=0;j<100&&app.serviceObserver.snapshot().at!==at;j++)await new Promise(r=>setTimeout(r,10));}
 await admin.bringToFront();await admin.locator('#ownerNavigation [data-admin-target="overview"]').click();await admin.locator('.monitor-chart').first().waitFor();assert.equal(await admin.locator('.monitor-chart').count(),2);await admin.locator('.owner-monitoring').screenshot({path:path.join(out,'monitoring.png')});
 await admin.setViewportSize({width:390,height:844});assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await admin.screenshot({path:path.join(out,'monitoring-mobile.png')});await admin.setViewportSize({width:1366,height:1000});
 await admin.locator('#ownerNavigation [data-admin-target="maintenance"]').click();await admin.locator('#service-reason').fill('Несохранённый текст');
 mongo.health={state:'error'};app.serviceObserver.sample();await admin.waitForFunction(()=>document.getElementById('service-failure').checked&&document.getElementById('service-failure').disabled);assert.equal(await admin.locator('#service-reason').inputValue(),'Несохранённый текст');await admin.locator('#maintenancePanel').screenshot({path:path.join(out,'automatic-failure.png')});
 mongo.health={state:'ok'};at+=5000;app.serviceObserver.sample();await admin.waitForFunction(()=>!document.getElementById('service-failure').checked&&!document.getElementById('service-failure').disabled);
 await admin.locator('#ownerNavigation [data-admin-target="audit"]').click();await admin.locator('.service-log-entry').first().waitFor();assert.ok((await admin.locator('#serviceLog').textContent()).includes('MongoDB'));await admin.screenshot({path:path.join(out,'service-journal.png')});report.checks.push('live graphs, responsive overview, automatic failure/recovery, preserved unsaved edits, durable incident journal');
 await page.bringToFront();
 await page.route('**/api/service-status',r=>r.abort());await page.evaluate(async()=>{await KillexMaintenance.check();await KillexMaintenance.check();});await page.locator('#maintenanceTitle').getByText('Что-то пошло не так',{exact:true}).waitFor();report.checks.push('connection failure screen and restored access');
 await page.unroute('**/api/service-status');await page.evaluate(()=>KillexMaintenance.check());await page.locator('#maintenanceDialog button').waitFor({state:'visible'});
 const broken=await context.newPage();await broken.route('**/game-client.js*',r=>r.abort());await broken.goto(url);await broken.locator('#maintenanceTitle').getByText('Что-то пошло не так',{exact:true}).waitFor();await broken.locator('#maintenanceDialog button').getByText('Попробовать снова').waitFor();report.checks.push('failed startup script shows failure with retry');
 const fallback=await context.newPage();await fallback.route('**/__fallback__',r=>r.fulfill({status:503,contentType:'text/html',body:fs.readFileSync(path.resolve(__dirname,'../../deployment/maintenance/maintenance.html'),'utf8')}));await fallback.route('**/api/service-status',r=>r.fulfill({status:503,contentType:'text/html',body:'Unavailable'}));
 await fallback.goto(url+'/__fallback__');assert.equal(await fallback.locator('#title').textContent(),'Игра временно недоступна');await fallback.screenshot({path:path.join(out,'server-stopped.png')});await fallback.unroute('**/api/service-status');await fallback.locator('#retry').click();await fallback.locator('#title').getByText('Игра снова доступна').waitFor();report.checks.push('standalone fallback works without Node assets and recovers');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);console.log('service availability browser checks passed');
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await app.close();fs.rmSync(monitorDirectory,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
