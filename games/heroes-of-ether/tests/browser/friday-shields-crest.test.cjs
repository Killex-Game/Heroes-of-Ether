"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright'),engine=process.env.SF_BROWSER_ENGINE||'chromium';
const {createGameServer}=require('../../src/server/game-server'),{Arena}=require('../../src/server/arena/arena-simulation'),{ClanService}=require('../../src/server/clans/clan-service');
const fixture=require('../helpers/black-friday-fixture'),f=fixture({journal:false}),p=f.p();
const {xpForLevel}=require('../../src/server/progression/experience-progression');
p.personal.introPending=false;p.name='Проверка';p.level=12;p.progress.xp=xpForLevel(12);p.wallet.coins=100000;p.wallet.crystals=1000;p.wallet.bucks=500;
const clans=new ClanService(f.store);clans.mutate(f.user.token,{action:'create',name:'Проверка герба',prefix:'TEST',privacy:'open',emblem:'astral',requestId:randomUUID()});
const app=createGameServer({profiles:f.store,clans,events:f.manager,arena:new Arena({etherCount:0}),autoTick:false,wallNow:f.now,now:f.now,rateNow:()=>performance.now(),testBots:{enabled:false}});
const out=process.env.OWNER_BROWSER_OUT||path.resolve(__dirname,'../artifacts/friday-shields-crest',engine);fs.mkdirSync(out,{recursive:true});
let browser,page;const errors=[],results=[];
(async()=>{try{
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 for(const viewport of [{width:1920,height:1080},{width:1280,height:800},{width:390,height:844}]){
  const context=await browser.newContext({viewport});context.setDefaultTimeout(60000);await context.addCookies([{name:'sferorumiya_session',value:f.user.token,url}]);page=await context.newPage();console.log('Viewport',viewport);
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/maintenance'))errors.push(r.status()+' '+r.url());});
  await page.addInitScript(()=>{document.addEventListener('killex:profile',e=>{if(e.detail?.id&&window.KillexRelease)localStorage.setItem(window.KillexPlatform.storageKey('.releaseNotes.v1.'+e.detail.id),window.KillexRelease.id);},true);const original=HTMLDialogElement.prototype.showModal;HTMLDialogElement.prototype.showModal=function(){if(this.id==='releaseNotesDialog'||this.id==='eventAnnouncementDialog'||this.classList.contains('daily-login-dialog'))return;return original.call(this);};});
  await page.goto(url);await page.waitForFunction(()=>!document.getElementById('playButton').disabled);await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  await page.locator('#clanSection').click();await page.locator('#clanDialog').getByRole('button',{name:'Настройки',exact:true}).click();
  const heights=[];for(const [tab,label] of [['frames','Форма'],['metals','Рамка'],['patterns','Поле'],['colors','Цвета'],['symbols','Символ']]){
    await page.locator('.clan-crest-tabs').getByRole('button',{name:label,exact:true}).click();
    const layout=await page.evaluate(tab=>{const root=document.querySelector('.clan-crest-builder'),panel=root.querySelector('.clan-crest-category.is-active'),r=root.getBoundingClientRect(),save=document.querySelector('.clan-form-actions').getBoundingClientRect();const items=[...panel.querySelectorAll('.clan-crest-choice')];return {tab,count:items.length,expected:KillexClanCrests.choicesForLevel(tab,root.crestBuilder.clanLevel).length,height:r.height,saveOffset:save.top-r.top,pages:root.querySelectorAll('.clan-symbol-pages').length,overflow:root.scrollWidth-root.clientWidth,clipped:items.some(n=>{const b=n.getBoundingClientRect();return b.bottom>r.bottom+1||b.right>r.right+1||b.width<40||b.height<40;})};},tab);
    assert.equal(layout.count,layout.expected);assert.equal(layout.pages,0);assert.ok(layout.overflow<=1,JSON.stringify(layout));assert.equal(layout.clipped,false,JSON.stringify(layout));heights.push(layout.height);results.push({viewport,...layout});
    if(tab==='colors')await page.screenshot({path:path.join(out,'crest-'+viewport.width+'.png')});
  }
  assert.ok(Math.max(...heights)-Math.min(...heights)<1,JSON.stringify(heights));
  // Changes still reach the clan service and survive reopening the settings.
  await page.locator('.clan-crest-tabs').getByRole('button',{name:'Цвета',exact:true}).click();
  const choice=page.locator('.clan-crest-category.is-active .clan-crest-choice').nth(viewport.width===390?2:1);const id=await choice.getAttribute('data-choice');await choice.click();
  await page.locator('#clanForm button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#clanForm'));
  assert.equal(f.store.data.clans[f.p().clanId].crest.color,id);await page.keyboard.press('Escape');
  await page.locator('#blackFridayButton').click();await page.locator('#blackFridayDialog [data-tab="exchange"]').click();
  const dialog=page.locator('#blackFridayDialog'),before=await dialog.boundingBox();
  await dialog.getByRole('button',{name:'Обменять',exact:true}).first().click();await page.locator('.manya-notice:not([hidden])').waitFor();
  const after=await dialog.boundingBox();assert.deepEqual(after,before);assert.equal(await page.locator('.manya-notice').textContent(),'Обмен выполнен');assert.equal(await page.locator('.manya-notice').evaluate(n=>getComputedStyle(n).pointerEvents),'none');
  await page.screenshot({path:path.join(out,'exchange-'+viewport.width+'.png')});await page.locator('.manya-notice').waitFor({state:'hidden'});await page.keyboard.press('Escape');
  await page.locator('#walletStatus .currency-add[data-currency="bucks"]').click();await page.locator('[data-package-id="change"] .donation-action').click();
  const payment=page.locator('#mockPaymentDialog');await payment.waitFor();const copy=await payment.innerText();assert.match(copy,/2 голос/);assert.match(copy,/20 жетонов/);await payment.getByRole('button',{name:'Отмена',exact:true}).click();
  await context.close();page=null;
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({engine,results,errors},null,2));console.log(JSON.stringify({engine,cases:results.length,errors}));
}catch(e){if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure-dom.html'),await page.content());}throw e;}finally{if(browser)await browser.close();await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
