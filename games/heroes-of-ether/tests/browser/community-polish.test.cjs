"use strict";
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{once}=require('events'),{randomUUID}=require('crypto'),pw=require('playwright');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{createGameServer}=require('../../src/server/game-server'),{EventManager}=require('../../src/server/events/event-manager');
const engine=process.argv[2]||'chromium',out=process.env.KILLEX_TEST_ARTIFACTS||path.resolve(__dirname,'../../../../artifacts/news-medals-admin-20261114/polish-'+engine);
fs.mkdirSync(out,{recursive:true});
const now=()=>Date.UTC(2026,10,14,9),store=new ProfileStore({now}),events=new EventManager({now});
events.apply('test','start',{eventId:require('../../src/server/events/black-friday').manifest.id,revision:0,requestId:randomUUID()});
store.events=events;
store.data.gameNews={version:1,revision:1,items:[{id:'long-news',title:'Большая статья',body:('События нашего мира: путешествия, приключения и новые открытия.\n\n').repeat(70),date:'2026-11-15',category:'news',visible:true,createdAt:now(),updatedAt:now()},{id:'short-news',title:'Короткая заметка',body:'Добро пожаловать в Эфир!',date:'2026-11-14',category:'news',visible:true,createdAt:now(),updatedAt:now()}]};
const auth=store.open(),p=store.find(auth.token);
p.name='Проверка';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};
p.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(store.now()),day:1};
const app=createGameServer({profiles:store,events,wallNow:now,autoTick:false,testBots:{enabled:false}}),report={engine,checks:[],errors:[]};
let browser;
async function closeAll(page){for(let i=0;i<5;i++){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.waitForTimeout(50);}}
async function geometry(page,selector,label){const r=await page.locator(selector).evaluate(d=>{const r=d.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,scroll:d.scrollHeight-d.clientHeight};});assert.ok(r.x>=0&&r.y>=0&&r.right<=r.w+1&&r.bottom<=r.h+1&&r.scroll<=1,label+JSON.stringify(r));report.checks.push({label,...r});}
(async()=>{
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');
 const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 const context=await browser.newContext({viewport:{width:1366,height:900}});
 await context.addCookies([{name:'sferorumiya_session',value:auth.token,url}]);
 await context.addInitScript(()=>document.addEventListener('killex:profile',e=>window.testProfile=e.detail));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>!window.KillexBoot?.active);
 await closeAll(page);
 assert.equal(await page.locator('#eventAnnouncement').count(),0);
 for(const size of [{width:1366,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
  await page.setViewportSize(size);await page.locator('#newsSection').click();
  await page.locator('.news-article h3').getByText('Большая статья',{exact:true}).waitFor();
  const fixed=await page.locator('#releaseNotesDialog').boundingBox();
  assert.equal(await page.locator('.news-section-tile').count(),3);
  assert.equal(await page.locator('.news-pager span').innerText(),'1 / 2');
  await page.locator('.news-article').hover();await page.mouse.wheel(0,550);await page.waitForFunction(()=>document.querySelector('.news-article').scrollTop>20);
  assert.equal(await page.locator('.news-article').evaluate(n=>getComputedStyle(n).scrollbarWidth),'none');
  await page.getByRole('button',{name:'Следующая страница новостей',exact:true}).click();
  assert.equal(await page.locator('.news-article h3').innerText(),'Короткая заметка');
  assert.equal(await page.locator('.news-article').evaluate(n=>n.scrollTop),0);
  assert.deepEqual(await page.locator('#releaseNotesDialog').boundingBox(),fixed);
  await page.locator('#releaseNotesDialog').screenshot({path:path.join(out,'newspaper-short-'+size.width+'.png')});
  report.checks.push({label:'fixed-newspaper-scroll-whole-article-'+size.width});
  await page.locator('.news-tabs [data-category="event"]').click();
  await page.locator('.news-event-figure img').evaluate(img=>img.decode());
  assert.match(await page.locator('.news-article').innerText(),/Чёрная пятница/);
  assert.doesNotMatch(await page.locator('.news-date').innerText(),/\d+:\d+/);
  let count=0;
  for(;;){await geometry(page,'#releaseNotesDialog','event-'+size.width+'-'+count);if(!count)await page.locator('#releaseNotesDialog').screenshot({path:path.join(out,'event-'+size.width+'.png')});count++;const next=page.getByRole('button',{name:'Следующая страница новостей',exact:true});if(await next.isDisabled())break;await next.click();assert.ok(count<20);}
  await page.locator('.news-event-link').click();await page.locator('#blackFridayDialog[open]').waitFor();await closeAll(page);
 }
 await page.route('**/api/**',r=>r.abort());
 await page.waitForTimeout(200);await closeAll(page);
 const ranks=['novice','experienced','expert','sage','master','pro','prince','king','emperor','boss'];
 for(const size of [{width:1366,height:900},{width:390,height:844}]){
  await page.setViewportSize(size);let lastArea=0;
  for(let i=0;i<ranks.length;i++){
   await page.evaluate(({id,degree})=>{const p=structuredClone(window.testProfile);p.title={id,name:id,degree};document.dispatchEvent(new CustomEvent('killex:profile',{detail:p}));},{id:ranks[i],degree:i+1});
   const measure=await page.locator('#profileMedal img').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let l=c.width,t=c.height,r=0,b=0;for(let y=0;y<c.height;y++)for(let q=0;q<c.width;q++)if(d[(y*c.width+q)*4+3]>16){l=Math.min(l,q);r=Math.max(r,q);t=Math.min(t,y);b=Math.max(b,y);}const ir=img.getBoundingClientRect(),pr=img.parentElement.getBoundingClientRect();return{w:(r-l+1)*ir.width/c.width,h:(b-t+1)*ir.height/c.height,slotW:pr.width,slotH:pr.height};});
   assert.ok(measure.w<=measure.slotW+1&&measure.h<=measure.slotH+1);assert.ok(measure.w*measure.h>lastArea,ranks[i]);lastArea=measure.w*measure.h;
   report.checks.push({label:'medal-'+ranks[i]+'-'+size.width,...measure});
   if([0,1,9].includes(i))await page.locator('.profile-card').screenshot({path:path.join(out,'medal-'+ranks[i]+'-'+size.width+'.png')});
  }
  const menu=await page.locator('.side-nav .menu-tile').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),t=n.querySelector('strong').getBoundingClientRect(),im=n.querySelector('img').getBoundingClientRect();return{id:n.id,h:r.height,delta:Math.abs((t.top+t.bottom)/2-(im.top+im.bottom)/2)};}));
  assert.ok(menu.every(m=>m.delta<1),JSON.stringify(menu));assert.ok(Math.max(...menu.map(m=>m.h))-Math.min(...menu.map(m=>m.h))<1);
  await page.locator('.side-nav').screenshot({path:path.join(out,'menu-'+size.width+'.png')});report.checks.push({label:'menu-'+size.width});
 }
 for(const theme of ['default','visual','prism','glass','heroic'])for(const size of [{width:1920,height:1080},{width:1366,height:900},{width:1366,height:768},{width:1024,height:768},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);
  await page.evaluate(theme=>{const p=structuredClone(window.testProfile);p.appearance={...p.appearance,uiTheme:theme,unlocked:[theme],availableUntil:{[theme]:null}};document.dispatchEvent(new CustomEvent('killex:profile',{detail:p}));},theme);
  await page.locator('.side-nav .menu-icon').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
  if(size.width===1366&&size.height===900){
   const sources=await page.locator('.side-nav .menu-icon').evaluateAll(images=>images.map(img=>({id:img.closest('button').id,src:img.getAttribute('src'),transform:getComputedStyle(img).transform})));
   for(const item of sources){assert.equal(item.transform,'none',theme+' '+item.id);if(theme==='heroic')assert.ok(item.src.includes('/heroic/menu-v2/'));if(theme!=='default'&&['promoCodeSection','newsSection','petsSection'].includes(item.id))assert.ok(item.src.includes('/'+theme+'/menu-v2/'));}
   await page.locator('.side-nav').screenshot({path:path.join(out,'menu-theme-'+theme+'.png')});
  }
  const boxes=await page.locator('.side-nav .menu-tile').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect(),t=n.querySelector('strong').getBoundingClientRect(),i=n.querySelector('img').getBoundingClientRect();return{id:n.id,height:b.height,delta:Math.abs((t.top+t.bottom-i.top-i.bottom)/2),textTop:t.top-b.top,textBottom:b.bottom-t.bottom,font:getComputedStyle(n.querySelector('strong')).fontSize};}));
  assert.ok(boxes.every(b=>b.height>=47&&b.delta<1&&b.textTop>=0&&b.textBottom>=0),theme+size.width+JSON.stringify(boxes));
  assert.equal(new Set(boxes.map(b=>b.font)).size,1);assert.ok(Math.max(...boxes.map(b=>b.height))-Math.min(...boxes.map(b=>b.height))<1);
  if(size.width>960){const alignment=await page.evaluate(()=>({menu:document.querySelector('.side-nav').getBoundingClientRect().top,level:document.querySelector('.progress-experience').getBoundingClientRect().top}));assert.ok(Math.abs(alignment.menu-alignment.level)<1,theme+JSON.stringify(alignment));}
  report.checks.push({label:'all-buttons-'+theme+'-'+size.width+'x'+size.height});
  if(theme==='default'&&size.width>=1024)await page.screenshot({path:path.join(out,'lobby-'+size.width+'x'+size.height+'.png')});
 }
 await page.setViewportSize({width:1920,height:1080});
 const future=await page.evaluate(()=>{const nav=document.querySelector('.side-nav'),before=[...nav.children].map(n=>n.getBoundingClientRect().height),extra=nav.lastElementChild.cloneNode(true);extra.id='future-menu-test';nav.append(extra);const after=[...nav.children].map(n=>n.getBoundingClientRect().height);extra.remove();return{before,after};});
 assert.ok(future.before.every(h=>h===future.after[0])&&future.after.every(h=>h===future.after[0]));report.checks.push({label:'new-menu-item-does-not-shrink-existing-buttons'});
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify({engine,checks:report.checks.length}));
})().catch(e=>{report.failure=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await app.close();});
