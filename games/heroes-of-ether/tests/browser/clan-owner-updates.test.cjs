"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events');
const engines=require('playwright'),engine=process.env.SF_BROWSER_ENGINE||'chromium';
const {createGameServer}=require('../../src/server/game-server'),{Arena}=require('../../src/server/arena/arena-simulation');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const profiles=new ProfileStore({journal:false,now:()=>5000}),u=profiles.open(),p=profiles.find(u.token);
p.personal.introPending=false;p.name='Проверка';p.grantedAccessories=['rabbit_ears','star_pilot','solar_ribbon'];
const app=createGameServer({profiles,arena:new Arena({etherCount:0}),autoTick:false,now:()=>5000,rateNow:()=>performance.now(),testBots:{enabled:false}});
const out=process.env.OWNER_BROWSER_OUT||path.resolve(__dirname,'../artifacts/clan-owner-updates',engine);fs.mkdirSync(out,{recursive:true});
let browser,timer,lastPage,failures=[];
(async()=>{try{
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 const context=await browser.newContext({viewport:{width:1336,height:768}});await context.addCookies([{name:'sferorumiya_session',value:u.token,url}]);
 const page=lastPage=await context.newPage(),errors=failures;page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/maintenance'))errors.push(r.status()+' '+r.url());});
 page.on('requestfailed',r=>fs.appendFileSync(path.join(out,'request-failures.txt'),r.url()+' '+r.failure()?.errorText+'\n'));
 await page.addInitScript(()=>{
  document.addEventListener('killex:profile',e=>{if(e.detail?.id&&window.KillexRelease) localStorage.setItem(window.KillexPlatform.storageKey('.releaseNotes.v1.'+e.detail.id),window.KillexRelease.id);},true);
  const original=HTMLDialogElement.prototype.showModal;HTMLDialogElement.prototype.showModal=function(){if(this.id==='eventAnnouncementDialog'||this.classList.contains('daily-login-dialog'))return;return original.call(this);};
 });
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById('playButton').disabled);
 await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
 await page.locator('#wardrobeSection').click();await page.getByRole('button',{name:'Шапки',exact:true}).click();
 assert.equal(await page.locator('[data-accessory-id="star_pilot"]').isVisible(),true);
 assert.equal(await page.locator('[data-accessory-id="rabbit_ears"]').isVisible(),true);
 assert.equal(await page.locator('[data-accessory-id="captain_tricorn"]').isVisible(),false);
 await page.getByRole('button',{name:'Бабочки',exact:true}).click();
 assert.equal(await page.locator('[data-accessory-id="solar_ribbon"]').isVisible(),true);
 assert.equal(await page.locator('[data-accessory-id="carrot_bow"]').isVisible(),false);
 assert.equal(await page.locator('[data-accessory-id="velvet_trick"]').isVisible(),false);
 await page.screenshot({path:path.join(out,'wardrobe.png')});await page.keyboard.press('Escape');
 // Exercise native keyboard activation on the real ArenaChat component.
 await page.evaluate(()=>{window.testChat=new window.KillexChat.ArenaChat(()=>true,()=>{});window.testChat.root.id='testArenaChat';document.body.append(window.testChat.root);Object.assign(window.testChat.root.style,{position:'fixed',right:'10px',bottom:'10px',zIndex:'9999'});window.testChat.connect();});
 const toggle=page.locator('#testArenaChat .arena-chat-toggle');
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await toggle.focus();await page.keyboard.press('Space');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await toggle.click();await toggle.focus();await page.keyboard.press('Space');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 const input=page.locator('#testArenaChat .chat-input');await input.fill('Два');await input.press('End');await input.press('Space');await input.pressSequentially('слова');assert.equal(await input.inputValue(),'Два слова');
 await input.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');await page.keyboard.press('Space');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 const abilityCases=await page.evaluate(()=>{
  const stock=[{accessoryId:'viking_hat',boosterId:'fire_sword',count:1},{accessoryId:'viking_hat',boosterId:'meat',count:3}];
  const me={id:'fixture',spawnSerial:1,accessoryAbilities:stock},sent=[];
  const ui=new window.KillexAccessoryAbilityUI({getMe:()=>me,isArena:()=>true,inputBlocked:()=>false,getAim:()=>({x:1,y:1}),send:m=>(sent.push(m),true),cooldown:()=>({ms:0,duration:500})});
  ui.updateArena();ui.use();ui.receive({requestId:sent[0].requestId,ok:true,accessoryId:'viking_hat',boosterId:'fire_sword',remaining:0});
  if(ui.current.boosterId!=='meat'||ui.button.querySelector('.booster-slot-count').textContent!=='3')throw Error('E did not advance stock');
  ui.use();ui.receive({requestId:sent[1].requestId,ok:true,accessoryId:'viking_hat',boosterId:'meat',remaining:2});
  ui.updateArena();if(ui.button.querySelector('.booster-slot-count').textContent!=='2')throw Error('stale snapshot restored E stock');
  me.spawnSerial++;ui.updateArena();if(ui.current.boosterId!=='fire_sword')throw Error('new life did not reset E stock');ui.button.remove();return 3;
 });assert.equal(abilityCases,3);
 const decoded=await page.evaluate(async()=>{const ids=['fire','fire_sword','cake','warheads','vortex','awl','clan_shield'],ach=['help','five','days','types','seasons'];let count=0;
  for(const size of [64,128,256,512])for(const src of [...ids.map(id=>window.KillexProgressionArt.booster(id,size)),...ach.map(s=>window.KillexProgressionArt.achievement('clan_quest_'+s,size))]){const i=new Image();i.src=src;await i.decode();if(i.naturalWidth!==size||i.naturalHeight!==size)throw Error(src);count++;}return count;});assert.equal(decoded,48);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({engine,wardrobeCases:6,chatCases:6,abilityCases,decoded,errors},null,2));console.log(JSON.stringify({engine,wardrobeCases:6,chatCases:6,abilityCases,decoded,errors}));
}catch(e){if(lastPage)await lastPage.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(JSON.stringify({failures}));throw e;}
finally{clearInterval(timer);if(browser)await browser.close();await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
