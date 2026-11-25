'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID,randomBytes}=require('node:crypto');
const pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{createGameServer}=require('../../src/server/game-server'),{OwnerAccess}=require('../../src/server/admin/owner-access');
const {ControlAccess}=require('../../src/server/admin/control-access'),{createControlServer}=require('../../src/server/admin/control-server');
const engine=process.argv[2]||'chromium',out=path.resolve(process.env.FRIDAY_OUTPUT||'artifacts/friday-editor',engine);fs.mkdirSync(out,{recursive:true});
let at=Date.parse('2026-11-20T12:00:00+03:00');const now=()=>at,config=require('../../config/promotions.json'),profiles=new ProfileStore({now,promotionConfig:config}),auth=profiles.open();
profiles.setPersonal(auth.token,{name:'Проверка пятницы',expectedName:auth.profile.name,gender:'unspecified',requestId:randomUUID()});profiles.find(auth.token).personal.introPending=false;
const key=randomBytes(32),access=new OwnerAccess({ownerId:auth.profile.id,now}),report={engine,checks:[],errors:[],missing:[]};let app,control,browser;
const closeDialogs=page=>page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
(async()=>{try{
 const http=require('node:http'),reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const gamePort=reserve.address().port;await new Promise(r=>reserve.close(r));
 const gameUrl='http://127.0.0.1:'+gamePort,directory=fs.mkdtempSync(path.join(out,'control-'));
 control=createControlServer({access,key,gameUrl,directory,publicDir:path.resolve(__dirname,'../../public'),mediaDirectory:path.join(directory,'media'),now});control.server.listen(0,'127.0.0.1');await once(control.server,'listening');const adminUrl='http://127.0.0.1:'+control.server.address().port;
 app=createGameServer({profiles,ownerAccess:new ControlAccess({ownerId:auth.profile.id,key,url:adminUrl,directory,now}),wallNow:now,autoTick:false,testBots:{enabled:false}});app.httpServer.listen(gamePort,'127.0.0.1');await once(app.httpServer,'listening');
 const password='Friday browser isolated password',req={method:'POST',headers:{host:new URL(adminUrl).host,origin:adminUrl,'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}};
 await access.login({password,setupCode:access.bootstrapCode},req,{setHeader(){}},{id:auth.profile.id},true);access.session=null;
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const login=await context.request.post(adminUrl+'/api/admin/auth/login',{data:{login:'owner',password},headers:{Origin:adminUrl}});assert.equal(login.status(),200,await login.text());
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()===404)report.missing.push(r.url());});
 await page.goto(adminUrl+'/admin.html#friday');await page.locator('#weekendPromotionsPanel h2').waitFor();
 const editor=page.locator('#weekendPromotionsPanel'),offerForm=editor.locator('form').first();
 await offerForm.getByLabel('Название',{exact:true}).fill('Мой пятничный набор');await offerForm.getByLabel('Цена, голоса',{exact:true}).fill('2');
 await offerForm.getByLabel('Количество награды 1',{exact:true}).fill('123');await offerForm.getByLabel('Причина изменения (для журнала)',{exact:true}).fill('Проверка редактора в браузере');
 await offerForm.getByRole('button',{name:'Сохранить набор',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.friday-message').textContent.startsWith('Сохранено'));
 assert.equal(profiles.data.weekendPromotions.offers['promotion:weekend:01'].votes,2);assert.equal(profiles.data.weekendPromotions.offers['promotion:weekend:01'].rewards[0].amount,123);report.checks.push('independent-admin-save');
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewportSize(viewport);await page.screenshot({path:path.join(out,'admin-'+viewport.width+'.png'),fullPage:true});const metrics=await editor.evaluate(el=>({width:el.scrollWidth,client:el.clientWidth}));assert(metrics.width<=metrics.client+2,JSON.stringify(metrics));report.checks.push('admin-layout-'+viewport.width);}
 await page.setViewportSize({width:1440,height:1000});const schedule=editor.locator('form').nth(1);await schedule.getByLabel('Показывать пятничные акции',{exact:true}).uncheck();await schedule.getByLabel('Причина изменения расписания',{exact:true}).fill('Проверка паузы');await schedule.getByRole('button',{name:'Сохранить расписание',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.friday-message').textContent.startsWith('Сохранено'));assert.equal(profiles.view(profiles.find(auth.token)).promotions.filter(id=>id.includes('weekend')).length,0);
 await schedule.getByLabel('Показывать пятничные акции',{exact:true}).check();await schedule.getByLabel('Причина изменения расписания',{exact:true}).fill('Возобновить показ');await schedule.getByRole('button',{name:'Сохранить расписание',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.friday-message').textContent.startsWith('Сохранено'));report.checks.push('pause-resume');
 await context.addCookies([{name:'sferorumiya_session',value:auth.token,url:gameUrl,httpOnly:true}]);
 const player=profiles.find(auth.token);player.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(at),day:1};player.seenPromotionIds=profiles.view(player).promotions;
 await context.addInitScript(()=>document.addEventListener('killex:profile',e=>{window.__profile=e.detail;localStorage.setItem(KillexPlatform.storageKey('.releaseNotes.v1.'+e.detail.id),KillexRelease.id);}));
 await page.goto(gameUrl);await page.waitForFunction(()=>window.__profile&&document.body.dataset.screen==='lobby');
 for(let i=0;i<5;i++){await closeDialogs(page);await page.waitForTimeout(50);}
 await page.locator('#promotionsButton').click();
 await page.locator('.promotion-tabs').getByRole('button',{name:/Мой пятничный набор/}).click();
 await page.waitForFunction(()=>document.querySelector('#promotionsTitle').textContent==='Мой пятничный набор');assert.equal(await page.locator('.promotion-buy').innerText(),'Купить за 2 голоса');
 for(const viewport of [{width:1366,height:900},{width:390,height:844}]){await page.setViewportSize(viewport);await page.screenshot({path:path.join(out,'offer-'+viewport.width+'.png')});const box=await page.locator('#promotionsDialog').evaluate(d=>({width:d.scrollWidth,client:d.clientWidth,left:d.getBoundingClientRect().left,right:d.getBoundingClientRect().right,v:innerWidth}));assert(box.width<=box.client+2&&box.left>=-1&&box.right<=box.v+1,JSON.stringify(box));}
 await page.locator('.promotion-buy').click();await page.getByRole('dialog',{name:'Подтверждение покупки'}).waitFor();assert.match(await page.getByRole('dialog',{name:'Подтверждение покупки'}).innerText(),/2 голоса/);report.checks.push('player-dynamic-offer-mobile-checkout');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);
 }catch(e){report.failure=e.stack;process.exitCode=1;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser?.close();await control?.close();await app?.close();}})();
