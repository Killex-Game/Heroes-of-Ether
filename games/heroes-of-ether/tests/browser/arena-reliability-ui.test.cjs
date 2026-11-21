'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events');
const engines=require('playwright'),{ProfileStore}=require('../../src/server/profiles/profile-store');
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation'),{createGameServer}=require('../../src/server/game-server');
const established=require('../helpers/browser-established-profile');
const out=path.resolve(__dirname,'../../../../artifacts/arena-reliability-ui');fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const engine of ['chromium','firefox','webkit']){
 const store=new ProfileStore(),auth=store.open(),other=store.open();
 for(const u of [auth,other]){const p=established.prepareProfile(store,u);p.name=u===auth?'Проверка':'Соперник';p.account={...require('../../src/server/accounts/account-benefits').fresh(),vipUntil:Date.now()+86400000,premiumUntil:Date.now()+86400000};}
 const app=createGameServer({profiles:store,arena:new Arena({etherCount:0}),testBots:{enabled:false}});let browser;
 try{
  app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
  browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
  const context=await browser.newContext({viewport:{width:1366,height:768}});await established.prepareContext(context);
  await context.addCookies([{name:'sferorumiya_session',value:auth.token,url}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>!window.KillexBoot?.active);await established.clearInitialDialogs(page);
  await page.locator('.effi-lobby-dismiss').click();assert.equal(await page.locator('.effi-lobby').getAttribute('data-active'),'false');
  await page.locator('#arenaPickerButton').click();await page.locator('#arenaPickerDialog .arena-choice').first().click();
  await page.locator('#arena').waitFor({state:'visible'});await page.waitForFunction(()=>!window.KillexArenaTransition.active);
  await page.screenshot({path:path.join(out,engine+'-desktop-hud.png')});
  await page.keyboard.press('Enter');const draft=page.locator('#arenaChat .chat-input');await draft.fill('Сообщение осталось недописанным');
  const ctx2=await browser.newContext();await established.prepareContext(ctx2);await ctx2.addCookies([{name:'sferorumiya_session',value:other.token,url}]);
  const page2=await ctx2.newPage();await page2.goto(url);await page2.waitForFunction(()=>!window.KillexBoot?.active);await established.clearInitialDialogs(page2);
  await page2.locator('#playButton').click();await page2.locator('#arena').waitFor({state:'visible'});
  const p=[...app.arena.players.values()].find(p=>p.profileId===store.find(auth.token).id),q=[...app.arena.players.values()].find(p=>p.profileId===store.find(other.token).id);
  for(const [row,mass] of [[p,20],[q,400]])Object.assign(row,{mass,radius:radiusForMass(mass),x:800,y:800,targetX:800,targetY:800,protectedUntil:0,stopped:true});
  await page.locator('#lifeResultDialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#lifeResultTitle').textContent(),'Вас съели');assert.equal(await draft.inputValue(),'Сообщение осталось недописанным');
  await page.locator('.life-killer-profile').click();await page.locator('#playerProfileDialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('publicPlayerTitle')?.textContent.includes('Соперник')).catch(async error=>{console.error(JSON.stringify({title:await page.locator('#publicPlayerTitle').textContent(),body:await page.locator('.public-player-content').textContent(),killer:store.find(auth.token).progress.lastLife?.killer,expected:store.find(other.token).id}));throw error;});
  await page.evaluate(()=>document.getElementById('playerProfileDialog').close());
  await page.evaluate(()=>{const original=Date.now;window.__arenaTestNow=original;Date.now=()=>original()+121000;document.dispatchEvent(new Event('visibilitychange'))});
  await page.locator('#lobby').waitFor({state:'visible'});assert.equal(await page.locator('#lifeResultDialog').isVisible(),false);
  await page.evaluate(()=>{Date.now=window.__arenaTestNow});
  await page.waitForFunction(()=>!document.getElementById('playButton').disabled);await page.locator('#playButton').click();
  await page.locator('#arena').waitFor({state:'visible'});await page.waitForFunction(()=>!window.KillexArenaTransition.active);
  await page.keyboard.press('Enter');assert.equal(await draft.inputValue(),'Сообщение осталось недописанным');
  await page.evaluate(()=>{Date.now=()=>window.__arenaTestNow()+122000;document.dispatchEvent(new Event('visibilitychange'))});
  assert.equal(await page.locator('#arena').isVisible(),true,'Old life deadline must not evict the new life');
  assert.deepEqual(errors,[]);results.push({engine,roomCardEntry:true,effiDismiss:true,killerProfile:true,draftAcrossDeath:true,autoLobby120:true,staleDeadlineCancelled:true,errors});
 }finally{await browser?.close();await app.close();}
}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,results}));})().catch(e=>{console.error(e);process.exitCode=1});
