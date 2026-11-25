'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{once}=require('events'),{randomUUID}=require('crypto');
const pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{ClanService}=require('../../src/server/clans/clan-service'),{createGameServer}=require('../../src/server/game-server'),{xpForLevel}=require('../../src/server/progression/experience-progression');
const engine=process.argv[2]||'chromium',out=process.env.CLAN_NAV_OUTPUT||path.resolve(__dirname,'../artifacts/clan-membership-navigation',engine);fs.mkdirSync(out,{recursive:true});
const profiles=new ProfileStore(),clans=new ClanService(profiles),head=profiles.open(),member=profiles.open();
for(const [i,user] of [head,member].entries()){const p=profiles.find(user.token);p.name=i?'Lunar 2000':'Глава проверки';p.personal={nameSet:true,introPending:false,gender:'unspecified'};p.level=25;p.progress.xp=xpForLevel(25);p.wallet.coins=30000;p.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(Date.now()),day:1};}
clans.mutate(head.token,{action:'create',requestId:randomUUID(),name:'Клан проверки',prefix:'TEST',emblem:'astral',privacy:'open'});
const clanId=profiles.find(head.token).clanId;clans.mutate(member.token,{action:'apply',requestId:randomUUID(),clanId});
const app=createGameServer({profiles,clans,autoTick:false,testBots:{enabled:false}}),report={engine,checks:[],errors:[]};let browser,page;
(async()=>{try{
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1366,height:768}});await context.addCookies([{name:'sferorumiya_session',value:member.token,url,httpOnly:true}]);
 await context.addInitScript(()=>document.addEventListener('killex:profile',e=>{window.__profile=e.detail;localStorage.setItem(KillexPlatform.storageKey('.releaseNotes.v1.'+e.detail.id),KillexRelease.id);}));
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 if(process.env.CLAN_NAV_BASELINE)await page.route('**/ui/clans/clan-dialog.js?*',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.CLAN_NAV_BASELINE)}));
 await page.goto(url);await page.waitForFunction(()=>window.__profile&&!document.getElementById('playButton').disabled);
 for(let i=0;i<5;i++){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.waitForTimeout(60);}
 await page.locator('#clanSection').click();await page.locator('#clanDialog .clan-banner').waitFor();
 await page.getByRole('button',{name:'Выйти из клана',exact:true}).click();await page.locator('#clanDialog').getByRole('button',{name:'Подтвердить',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#clanDialog').open,{},{timeout:5000});assert(!profiles.find(member.token).clanId);report.checks.push('leave-closes-immediately');
 async function create(suffix){if(!await page.locator('#topsDialog').evaluate(d=>d.open))await page.locator('#clanSection').click();await page.locator('#topsDialog').getByRole('button',{name:'Создать клан',exact:true}).click();await page.locator('#clanForm').waitFor();
  await page.locator('#clan-name').fill('Новый клан '+suffix);await page.locator('#clan-prefix').fill('N'+suffix);await page.locator('#clanForm button[type="submit"]').click();await page.locator('#clanDialog .clan-banner').waitFor();assert(profiles.find(member.token).clanId);report.checks.push('create-'+suffix);
 }
 await create('1');
 for(const [w,h] of [[1366,768],[390,844]]){await page.setViewportSize({width:w,height:h});for(const label of ['Казна и склад','Чат','Настройки','Мой клан']){await page.locator('#clanDialog .clan-nav').getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(80);}await page.screenshot({path:path.join(out,'clan-'+w+'.png')});report.checks.push('member-tabs-'+w);}
 await page.setViewportSize({width:1366,height:768});await page.locator('#clanDialog').getByRole('button',{name:'Распустить клан',exact:true}).click();await page.locator('#clanDialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#clanDialog').open);assert(!profiles.find(member.token).clanId);report.checks.push('disband-closes');
 await create('2');await page.locator('#clanDialog').getByRole('button',{name:'Закрыть кланы',exact:true}).click();
 await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
 clans.mutate(member.token,{action:'disband',clanId:profiles.find(member.token).clanId,requestId:randomUUID()});
 for(const tab of ['Мой клан','Чат']){
  clans.mutate(member.token,{action:'apply',requestId:randomUUID(),clanId});
  await page.locator('#clanSection').click();await page.locator('#clanDialog .clan-banner').waitFor();
  await page.locator('#clanDialog .clan-nav').getByRole('button',{name:tab,exact:true}).click();
  if(tab==='Чат')await page.waitForResponse(r=>r.url().includes('/api/clans/chat?')&&r.status()===200);
  clans.mutate(head.token,{action:'kick',clanId,memberId:member.profile.id,requestId:randomUUID()});
  await page.waitForFunction(()=>!document.querySelector('#clanDialog').open,{},{timeout:22000});
  report.checks.push('kicked-closes-'+tab);
 }
 for(const id of ['shopSection','wardrobeSection','inventorySection','achievementsButton','questsSection','rankingsButton']){for(let i=0;i<2;i++){await page.locator('#'+id).click();await page.waitForTimeout(150);await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));}report.checks.push('reopen-'+id);}
 assert.deepEqual(report.errors,[]);assert(!await page.locator('.system-message-toast').filter({hasText:'insertBefore'}).isVisible());
}catch(e){report.failure=e.stack;process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')});}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser?.close();await app.close();}})();
