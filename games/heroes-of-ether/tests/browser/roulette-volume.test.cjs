'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),pw=require('playwright');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{createGameServer}=require('../../src/server/game-server'),{EventManager}=require('../../src/server/events/event-manager');
const engine=process.argv[2]||'chromium',out=path.resolve(__dirname,'../../../../artifacts/promotion-window-polish-20261114/audio-'+engine);fs.mkdirSync(out,{recursive:true});
const store=new ProfileStore(),auth=store.open(),p=store.find(auth.token),at=Math.floor(Date.now()/60000)*60000,events=new EventManager({now:()=>at});
p.name='Проверка рулетки';p.personal={nameSet:true,introPending:false,gender:'unspecified',vkUrl:''};p.skinId=require('../../public/shared/player-identity').skins[0].id;
p.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(at),day:1};
events.apply('test','upload',{revision:events.data.revision,requestId:randomUUID(),manifest:{schemaVersion:1,id:'sound-test',title:'Проверка звука',description:'Тестовое событие',durationMinutes:60,contentPack:'core-v1',features:{roulette:true,lite:true}}});
events.apply('test','start',{revision:events.data.revision,requestId:randomUUID(),eventId:'sound-test'});
const app=createGameServer({profiles:store,events,autoTick:false,testBots:{enabled:false}}),report={engine,checks:[],errors:[]};let browser;
const lite=require('../../src/server/accounts/lite-account');lite.activate(p,store.rouletteConfig,at,events.active().id);lite.grantTickets(p,100);store.save(store.data);
async function close(page){for(let i=0;i<6;i++){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.waitForTimeout(40);}}
async function settled(page,prefix='Поздравляем!'){await page.waitForFunction(prefix=>!document.querySelector('.roulette-spin:not(.roulette-spin-five)').disabled&&document.querySelector('.roulette-status').textContent.startsWith(prefix),prefix);}
(async()=>{try{
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1366,height:900},reducedMotion:'no-preference'});
 await context.addCookies([{name:'sferorumiya_session',value:auth.token,url,httpOnly:true}]);
 await context.addInitScript(()=>{
  document.addEventListener('killex:profile',e=>{window.__profile=e.detail;localStorage.setItem(KillexPlatform.storageKey('.releaseNotes.v1.'+e.detail.id),KillexRelease.id);localStorage.setItem(KillexPlatform.storageKey('.achievement-notices.v1.')+e.detail.id,JSON.stringify(Object.fromEntries((e.detail.progress?.achievements||[]).map(a=>[a.eventRunId?a.id+':'+a.eventRunId:a.id,10]))));});
  window.__sounds=[];window.__audio=[];const Native=window.Audio;
  window.Audio=function(...args){const a=new Native(...args);window.__audio.push(a);const play=a.play.bind(a);a.play=()=>{const row={src:a.src,muted:a.muted,volume:a.volume,rate:a.playbackRate};window.__sounds.push(row);return play().then(()=>row.ok=true,e=>{row.error=e.name;throw e;});};return a;};
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>!KillexBoot.active&&!document.getElementById('playButton').disabled);await close(page);
 await page.bringToFront();
 await page.evaluate(()=>{window.__ticks=[];window.__motions=[];const play=KillexAudio.play;KillexAudio.play=(...args)=>{__ticks.push({args,hidden:document.hidden});return play(...args);};const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.classList.contains('roulette-wheel'))__motions.push(options);return animate.call(this,frames,options);};});
 await page.locator('#rouletteButton').click();
 const spin=page.locator('.roulette-spin:not(.roulette-spin-five)');
 const sounds=()=>page.evaluate(()=>__sounds.filter(a=>!a.muted&&a.src.includes('roulette-tick')));
 for(const fast of [false,true]){
  await page.locator('#rouletteFastSpin').setChecked(fast);await page.evaluate(()=>__sounds=[]);
  const before=store.find(auth.token).roulette.tickets;await spin.click();await settled(page);
  const rows=await sounds();assert(rows.length>0,JSON.stringify(await page.evaluate(()=>({ticks:__ticks,motions:__motions,hidden:document.hidden,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),status:document.querySelector('.roulette-status').textContent}))));assert(rows.some(a=>a.ok));assert(rows.every(a=>a.volume===.55&&a.rate===(fast?2.8:1)&&!a.error),JSON.stringify(rows));
  assert.equal(store.find(auth.token).roulette.tickets,before-1);
  assert(await page.evaluate(()=>__audio.filter(a=>a.src.includes('roulette-tick')).every(a=>a.paused)));
  report.checks.push({mode:fast?'fast':'normal',volume:rows[0].volume,rate:rows[0].rate,plays:rows.length,nativePlayback:true});
 }
 // A batch uses the same audible fast animation and exactly five tickets.
 const beforeBatch=store.find(auth.token).roulette.tickets;await page.evaluate(()=>__sounds=[]);await page.locator('.roulette-spin-five').click();await settled(page,'Все 5 призов');
 assert.equal(store.find(auth.token).roulette.tickets,beforeBatch-5);assert((await sounds()).some(a=>a.ok&&a.volume===.55&&a.rate===2.8));
 for(const reason of ['close','hidden']){
  await spin.click();await page.locator('.roulette-wheel-frame.is-spinning').waitFor();
  if(reason==='close')await page.locator('#rouletteDialog .booster-close').click();
  else await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>!document.querySelector('.roulette-wheel-frame.is-spinning'));
  const count=(await sounds()).length;await page.waitForTimeout(150);assert.equal((await sounds()).length,count);assert(await page.evaluate(()=>__audio.filter(a=>a.src.includes('roulette-tick')).every(a=>a.paused)));
  if(reason==='close')await page.locator('#rouletteButton').click();
  else await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  report.checks.push(reason+' stops audio and animation');
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>__sounds=[]);await spin.click();await settled(page);assert.equal((await sounds()).length,0);
 await close(page);await page.locator('#settingsButton').click();await page.locator('#soundVolume').press('Home');await page.locator('#settingsButton').click();await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#rouletteButton').click();await page.evaluate(()=>__sounds=[]);await spin.click();await settled(page);assert.equal((await sounds()).length,0);
 report.checks.push('batch, reduced-motion and muted preference preserved');assert.deepEqual(report.errors,[]);console.log('Normal/fast native volume parity and cleanup passed: '+engine);
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
