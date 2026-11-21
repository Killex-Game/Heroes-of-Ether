'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),pw=require('playwright');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{OwnerAccess}=require('../../src/server/admin/owner-access'),{createGameServer}=require('../../src/server/game-server'),{EventManager}=require('../../src/server/events/event-manager');
const engine=process.argv[2]||'chromium',out=path.resolve(process.env.NEWS_OUTPUT_ROOT||path.resolve(__dirname,'../../../../artifacts/news-editor-idle-20261114'),'browser-'+engine);fs.mkdirSync(out,{recursive:true});
const store=new ProfileStore(),auth=store.open(),p=store.find(auth.token),at=Math.floor(Date.now()/60000)*60000,events=new EventManager({now:()=>at});
p.name='Редактор';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};p.skinId=require('../../public/shared/player-identity').skins[0].id;p.wallet={coins:100000,crystals:10000,bucks:10000};p.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(Date.now()),day:1};
events.apply('test','upload',{revision:events.data.revision,requestId:randomUUID(),manifest:{schemaVersion:1,id:'news-test',title:'Событие для проверки',description:'Описание события',durationMinutes:60,contentPack:'core-v1',features:{roulette:true,lite:true}}});
events.apply('test','start',{revision:events.data.revision,requestId:randomUUID(),eventId:'news-test'});
const access=new OwnerAccess({ownerId:p.id}),app=createGameServer({profiles:store,ownerAccess:access,events,autoTick:false,testBots:{enabled:false}}),report={engine,checks:[],errors:[],missing:[]};let browser;
require('../../src/server/accounts/lite-account').activate(p,store.rouletteConfig,Date.now(),events.active().id);store.save(store.data);
async function close(page){for(let i=0;i<6;i++){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.waitForTimeout(40);}}
(async()=>{try{
app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome',ignoreDefaultArgs:['--hide-scrollbars']}:{})});const context=await browser.newContext({viewport:{width:1366,height:900},reducedMotion:'no-preference'});
await context.addCookies([{name:'sferorumiya_session',value:auth.token,url,httpOnly:true}]);
await context.addInitScript(()=>{document.addEventListener('killex:profile',e=>{window.__profile=e.detail;localStorage.setItem(KillexPlatform.storageKey('.releaseNotes.v1.'+e.detail.id),KillexRelease.id);const all=Object.fromEntries((e.detail.progress?.achievements||[]).map(a=>[a.eventRunId?a.id+':'+a.eventRunId:a.id,10]));localStorage.setItem(KillexPlatform.storageKey('.achievement-notices.v1.')+e.detail.id,JSON.stringify(all));});window.__motions=[];const old=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.classList.contains('roulette-wheel'))window.__motions.push(options.duration);return old.call(this,frames,options);};});
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()===404)report.missing.push(r.url());});
await page.setContent('<div style="height:80px;overflow:auto;scrollbar-width:thin!important">'+('text<br>'.repeat(40))+'</div>');report.nativeScrollbarBaseline=await page.locator('div').evaluate(n=>getComputedStyle(n).scrollbarWidth);
await page.goto(url);await page.waitForFunction(()=>!window.KillexBoot?.active&&!document.getElementById('playButton').disabled);await close(page);
assert.deepEqual(report.errors,[]);console.log('boot passed');
const admin=await context.newPage();admin.on('pageerror',e=>report.errors.push(e.message));await admin.goto(url+'/admin.html');await admin.locator('#setupCode').fill(access.bootstrapCode);await admin.locator('#password').fill('Long test owner password 2026');await admin.locator('#loginForm button').click();await admin.locator('#workspace').waitFor({state:'visible'});await admin.locator('#ownerNavigation [data-admin-target="news"]').click();await admin.locator('#newsAdminPanel .content-row').first().waitFor();
await admin.locator('#newsAdminPanel').getByRole('button',{name:'Создать',exact:true}).click();
assert.equal(await admin.locator('#news-layout').inputValue(),'banner');
assert.equal(await admin.locator('.news-editor-preview').getAttribute('data-layout'),'banner');
assert.equal(await admin.locator('#news-layout option').count(),4);
report.checks.push('new article defaults to banner; four layouts remain available');
await admin.locator('#news-title').fill('Большая статья');await admin.locator('#news-body').fill(('Абзац газеты с важными новостями мира. '.repeat(8)+'\n\n').repeat(16));await admin.locator('#news-visible').check();await admin.locator('#news-reason').fill('Проверка редактора');
await admin.locator('#news-banner').setInputFiles(path.resolve(__dirname,'../fixtures/news-banner.png'));await admin.locator('.content-status').filter({hasText:'Баннер загружен'}).waitFor();
await admin.locator('#news-layout').selectOption('right');assert.equal(await admin.locator('.news-editor-preview').getAttribute('data-layout'),'right');await admin.locator('#newsAdminPanel button[type="submit"]').click();await admin.locator('#newsAdminPanel .content-status').getByText('Сохранено.',{exact:true}).waitFor();
assert.match(store.data.gameNews.items[0].image,/^\/news-media\//);report.checks.push('admin upload, live preview and publish');console.log('editor passed');
require('../../src/server/admin/content-actions').apply(store,access,store.find(auth.token),'gameNews',{title:'Свежая заметка о событии',body:'Новая публикация',date:'2026-11-14',category:'event',visible:true,revision:1,requestId:randomUUID(),reason:'Проверка индикатора'},require('../../src/server/profiles/game-news').normalize);
await page.bringToFront();await page.evaluate(()=>document.dispatchEvent(new CustomEvent('killex:news-changed',{detail:2})));await page.locator('#newsSection .menu-notification-dot:not([hidden])').waitFor();
await page.locator('#newsSection').click();await page.locator('.news-article h3').getByText('Большая статья').waitFor();assert.equal(await page.locator('.news-tabs [data-category="news"] .menu-notification-dot').isHidden(),true);
assert.equal(await page.locator('.news-tabs [data-category="event"] .menu-notification-dot').isVisible(),true);
for(const [width,height] of [[1366,900],[390,844],[844,390]]){
 await page.setViewportSize({width,height});
 for(const layout of ['left','right','banner','columns']){
  await page.locator('.news-article').evaluate((n,x)=>n.dataset.layout=x,layout);
  const bounds=await page.locator('#releaseNotesDialog').evaluate(d=>{const r=d.getBoundingClientRect(),a=d.querySelector('.news-article');return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:d.scrollWidth-d.clientWidth,scroll:a.scrollHeight>a.clientHeight,bar:getComputedStyle(a).scrollbarWidth};});
  if(bounds.bar==='none')console.log('scrollbar diagnostic',await page.locator('.news-article').evaluate(n=>{const rows=[];const scan=rules=>{for(const r of rules){if(r.style?.scrollbarWidth){try{if(n.matches(r.selectorText))rows.push(r.cssText);}catch{}}if(r.cssRules)scan(r.cssRules);}};for(const s of document.styleSheets)try{scan(s.cssRules);}catch{}return{data:n.dataset.showScrollbar,inline:n.getAttribute('style'),rules:rows};}));
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.right<=bounds.w+1&&bounds.bottom<=bounds.h+1&&bounds.overflow<=1,JSON.stringify(bounds));assert.equal(bounds.scroll,true);
  if(report.nativeScrollbarBaseline!=='none')assert.notEqual(bounds.bar,'none');else{assert.equal(engine,'firefox');assert.equal(await page.locator('.news-article').getAttribute('data-show-scrollbar'),'true');}
  await page.locator('.news-article').evaluate(n=>n.scrollTop=200);assert.ok(await page.locator('.news-article').evaluate(n=>n.scrollTop>0));
  await page.locator('#releaseNotesDialog').screenshot({path:path.join(out,`news-${layout}-${width}.png`)});report.checks.push({layout,width,bounds});
 }
}
await page.setViewportSize({width:1366,height:900});await close(page);
if(process.env.NEWS_LAYOUT_ONLY==='1'){
 await page.locator('#newsSection').click();await page.locator('.news-tabs [data-category="release"]').click();
 assert.equal(await page.locator('.news-article').getAttribute('data-layout'),'banner');
 await page.locator('#releaseNotesDialog').screenshot({path:path.join(out,'release-banner.png')});
 await page.locator('.news-tabs [data-category="event"]').click();
 assert.equal(await page.locator('.news-article').getAttribute('data-layout'),'banner');
 await page.locator('#releaseNotesDialog').screenshot({path:path.join(out,'event-banner.png')});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);report.checks.push('release and event use banner');console.log('news layout checks passed');return;
}
// Timers are removed rather than repeatedly waking to return early.
const idle=await page.evaluate(()=>window.KillexActivity.running);await page.locator('#questsSection').click();const opened=await page.evaluate(()=>window.KillexActivity.running);assert.ok(opened>idle);await close(page);await page.waitForTimeout(70);assert.equal(await page.evaluate(()=>window.KillexActivity.running),idle);
await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(70);assert.equal(await page.evaluate(()=>window.KillexActivity.running),0);
const urls=[];const listen=r=>{if(r.url().includes('/api/'))urls.push(r.url());};page.on('request',listen);await page.waitForTimeout(10500);page.off('request',listen);assert.deepEqual(urls,[]);
await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>window.KillexActivity.running)>0);report.checks.push({timers:{idle,opened,hidden:0},hiddenRequests:urls.length});console.log('idle passed');
// Existing Lite eligibility; the committed prize is followed by a brief real animation.
await close(page);await page.locator('#rouletteButton').click();await page.locator('#rouletteFastSpin').check();await page.evaluate(()=>{window.__sounds=[];const play=KillexAudio.play;KillexAudio.play=(...args)=>{window.__sounds.push(args);return play(...args);};});
const before=store.find(auth.token).roulette.tickets;await page.locator('.roulette-spin:not(.roulette-spin-five)').click();await page.waitForFunction(()=>document.querySelector('.roulette-status').textContent.startsWith('Поздравляем!'));assert.equal(store.find(auth.token).roulette.tickets,before-1);
assert.ok((await page.evaluate(()=>window.__motions)).includes(680));assert.ok((await page.evaluate(()=>window.__sounds)).some(x=>x[0]==='roulette'&&x[2]===2.8));assert.equal(await page.locator('.is-fast-spinning').count(),0);
await page.emulateMedia({reducedMotion:'reduce'});const count=await page.evaluate(()=>window.__motions.length);await page.locator('.roulette-spin:not(.roulette-spin-five)').click();await page.waitForFunction(()=>document.querySelector('.roulette-status').textContent.startsWith('Поздравляем!'));assert.equal(await page.evaluate(()=>window.__motions.length),count);report.checks.push('fast spin: 680ms, accelerated sound, one ticket, reduced-motion');
assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);console.log('all browser checks passed');
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
