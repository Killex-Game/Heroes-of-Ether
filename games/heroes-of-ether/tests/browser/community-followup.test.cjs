"use strict";
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{once}=require('events'),{randomUUID}=require('crypto'),pw=require('playwright');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{createGameServer}=require('../../src/server/game-server'),{ClanService}=require('../../src/server/clans/clan-service'),battles=require('../../src/server/clans/battle-history');
const engine=process.argv[2]||'chromium',out=process.env.KILLEX_TEST_ARTIFACTS||path.resolve(__dirname,'../../../../artifacts/news-delete-20261114/followup-'+engine);fs.mkdirSync(out,{recursive:true});
const store=new ProfileStore(),clans=new ClanService(store),users=[];
for(let i=0;i<7;i++){const u=store.open(),p=store.find(u.token);p.name='Герой '+i;p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};p.level=12;p.progress.xp=require('../../src/server/progression/experience-progression').xpForLevel(12);p.wallet.coins=100000;p.greatness=2000000+i;require('../../src/server/progression/title-chest-rewards').awardTitles(p,Date.now());p.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(Date.now()),day:1};users.push(u);}
for(const [i,name,prefix]of[[0,'Стражи Эфира','ETHR'],[1,'Лунный дозор','MOON']])clans.mutate(users[i].token,{action:'create',requestId:randomUUID(),name,prefix,emblem:'astral',privacy:'open'});
const own=()=>store.data.clans[store.find(users[0].token).clanId],rival=()=>store.data.clans[store.find(users[1].token).clanId];battles.append(own(),rival(),122,45,Date.now()-1000);
const app=createGameServer({profiles:store,autoTick:false,testBots:{enabled:false}}),report={engine,checks:[],errors:[]};let browser;
async function closeAll(page){for(let i=0;i<6;i++){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.waitForTimeout(40);}}
(async()=>{
app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
const pages=[];
for(const u of users.slice(0,2)){
 const context=await browser.newContext({viewport:{width:1366,height:900}});await context.addCookies([{name:'sferorumiya_session',value:u.token,url}]);
 await context.addInitScript(()=>document.addEventListener('killex:profile',e=>{window.testProfile=e.detail;localStorage.setItem(window.KillexPlatform.storageKey('.achievement-notices.v1.')+e.detail.id,JSON.stringify(Object.fromEntries((e.detail.progress?.achievements||[]).map(a=>[a.id,10]))));}));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>!window.KillexBoot?.active&&!document.getElementById('playButton').disabled);await closeAll(page);pages.push(page);
 const notices=page.getByRole('button',{name:'Закрыть уведомления о наградах',exact:true});await page.addLocatorHandler(notices,()=>notices.click());
 await page.locator('#clanSection').click();await page.locator('#clanDialog .clan-nav').getByRole('button',{name:'Чат',exact:true}).click();
 await page.locator('.clan-chat .chat-system-result').waitFor();assert.match(await page.locator('.clan-chat .chat-system-result').innerText(),/победил.*122:45/);
}
const page=pages[0];await page.locator('.clan-chat .chat-input').fill('Хорошая игра!');await page.locator('.clan-chat .chat-input').press('Enter');await page.locator('.clan-chat .chat-text').getByText('Хорошая игра!',{exact:true}).waitFor();
battles.append(own(),rival(),7,7,Date.now()-500);
await page.waitForFunction(()=>document.querySelectorAll('.clan-chat .chat-system-result').length===2);
assert.match(await page.locator('.clan-chat .chat-system-result').last().innerText(),/вничью: 7:7/);await page.waitForTimeout(2300);assert.equal(await page.locator('.clan-chat .chat-system-result').count(),2);
for(const size of [{width:1366,height:900},{width:390,height:844}]){await page.setViewportSize(size);await page.locator('#clanDialog').screenshot({path:path.join(out,'clan-results-'+size.width+'.png')});}
report.checks.push('Both clans receive one result; late durable result merges without duplicate chat credit or cursor reset');
await closeAll(page);await page.setViewportSize({width:1366,height:900});
for(const theme of ['default','heroic','visual','prism','glass']){
 await page.locator('#hallOfFameSection').click();await page.waitForFunction(()=>document.querySelectorAll('.hall-light[data-occupied="true"]').length===7);
 await page.evaluate(theme=>{const p=structuredClone(window.testProfile);p.appearance={...p.appearance,uiTheme:theme};document.dispatchEvent(new CustomEvent('killex:profile',{detail:p}));},theme);
 await page.waitForFunction(t=>document.getElementById('hallOfFameDialog').dataset.hallTheme===t,theme);
 assert.equal(await page.locator('#hallOfFameDialog').getAttribute('data-animate'),'true');assert.equal(await page.locator('.hall-mote').count(),49);
 const before=await page.locator('.hall-volume').first().evaluate(n=>({time:n.getAnimations()[0].currentTime,transform:getComputedStyle(n).transform}));await page.waitForTimeout(650);
 const after=await page.locator('.hall-volume').first().evaluate(n=>({time:n.getAnimations()[0].currentTime,transform:getComputedStyle(n).transform}));assert.ok(after.time-before.time>300);assert.notEqual(after.transform,before.transform);
 await page.screenshot({path:path.join(out,'hall-'+theme+'.png')});
 await page.evaluate(()=>document.body.dataset.screen='arena');await page.waitForFunction(()=>document.getElementById('hallOfFameDialog').dataset.animate==='false');
 await page.evaluate(()=>document.body.dataset.screen='lobby');await page.waitForFunction(()=>document.getElementById('hallOfFameDialog').dataset.animate==='true');
 await page.locator('#hallOfFameDialog').getByRole('button',{name:'В лобби',exact:true}).click();
 assert.equal(await page.locator('#hallOfFameDialog').getAttribute('data-animate'),'false');assert.ok(await page.locator('.hall-volume').evaluateAll(nodes=>nodes.every(n=>n.getAnimations().every(a=>a.playState==='paused'))));
 report.checks.push('Hall '+theme+': moving light, seven particles per platform, pause on close');
}
await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#hallOfFameSection').click();assert.equal(await page.locator('#hallOfFameDialog').getAttribute('data-animate'),'false');assert.equal(await page.locator('.hall-volume').first().evaluate(n=>n.getAnimations().length),0);report.checks.push('Reduced motion keeps static hall');
assert.deepEqual(report.errors,[]);console.log(JSON.stringify({engine,checks:report.checks.length}));
})().catch(e=>{report.failure=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await app.close();});
