'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{randomUUID}=require('crypto');
const out=path.resolve(__dirname,'../artifacts/individual-gift-shelf');fs.mkdirSync(out,{recursive:true});
const pw=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const game=path.resolve(__dirname,'../..'),req=require('module').createRequire(game+'/package.json');
const {ProfileStore}=req('./src/server/profiles/profile-store'),{createGameServer}=req('./src/server/game-server'),established=req('./tests/helpers/browser-established-profile');
(async()=>{const report=[];for(const engine of (process.argv[2]?[process.argv[2]]:['chromium','firefox','webkit'])){
  const profiles=new ProfileStore(),auth=profiles.open(),profile=established.prepareProfile(profiles,auth),now=profiles.now();
  profile.name='Проверка';
  const seed=(counts)=>{profile.social={marriage:null,invitations:[],inviteReadyAt:0,gifts:counts.map(([id,count,offset])=>({id,count,noticeThrough:count,history:Array.from({length:count},(_,i)=>({id:randomUUID(),ordinal:count-i,readAt:now,fromId:auth.profile.id,fromName:'Даритель',at:now-offset-i*1000,...(i%2?{anonymous:true}:{})}))}))};};
  seed([['swift_boot',35,100000],['ward_shield',15,0],['booster_crystal',16,20000]]);
  const app=createGameServer({profiles,autoTick:false,testBots:{enabled:false}});let browser;
  try {
    await new Promise(r=>app.httpServer.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.httpServer.address().port;
    browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1366,height:900},reducedMotion:'reduce'});await established.prepareContext(context);await context.addCookies([{name:'sferorumiya_session',value:auth.token,url}]);
    const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/social/gifts?'))requests.push(r.url());});
    await page.goto(url);await page.waitForFunction(()=>!window.KillexBoot?.active&&!document.getElementById('playButton').disabled);await established.clearInitialDialogs(page);
    await page.evaluate(id=>KillexPlayerProfile.open(id),profile.id);await page.waitForFunction(()=>document.querySelectorAll('#playerProfileDialog .public-gift').length>1);
    const track=page.locator('#playerProfileDialog .public-shelf-track');
    assert.equal(await page.locator('.public-gift .regalia-count').count(),0);
    assert.equal(await page.locator('.public-gift img[alt="Щит"]').count(),15);
    const total=Number(await track.getAttribute('data-total'));assert(total>=66);assert((await page.locator('.public-gift').count())<=40);assert.equal(requests.length,0);
    await page.locator('#playerProfileDialog .public-player-shelf').screenshot({path:out+'/'+engine+'-separate.png'});
    const seen=new Set();for(let x=0;x<total;x+=25){await track.evaluate((n,x)=>n.scrollLeft=x*80,x);await page.waitForFunction(()=>{const n=document.querySelector("#playerProfileDialog .public-shelf-track");return Number(n.querySelector(".public-gift").dataset.awardIndex)>=Math.max(0,Math.floor(n.scrollLeft/80)-11);});for(const i of await track.locator('.public-gift').evaluateAll(ns=>ns.map(n=>n.dataset.awardIndex)))seen.add(i);assert((await track.locator('.public-trophy').count())<=40);}
    assert.equal(seen.size,66,'Every received gift must have a distinct reachable slot');
    await track.evaluate(n=>n.scrollLeft=0);await page.waitForTimeout(50);await page.locator('.public-gift').first().click();await page.waitForFunction(()=>document.querySelectorAll('.gift-history-row').length===15);assert.equal(requests.length,1);assert((await page.locator('.gift-history-list').innerText()).includes('Анонимно'));
    await page.locator('.gift-history-dialog .personal-close').click();await page.locator('#playerProfileDialog .personal-close').click();
    seed([['teddy',10000,0]]);await page.evaluate(id=>KillexPlayerProfile.open(id),profile.id);await page.waitForFunction(()=>Number(document.querySelector('#playerProfileDialog .public-shelf-track')?.dataset.total)>=10000);
    assert((await track.locator('.public-trophy').count())<=40);
    await track.evaluate(n=>n.scrollLeft=5000*80);await page.waitForFunction(()=>Number(document.querySelector('#playerProfileDialog .public-gift')?.dataset.awardIndex)>=4988);assert((await track.locator('.public-gift').count())<=40);assert(Math.abs(Number(await track.locator('.public-gift').first().getAttribute('data-award-index'))-4990)<=2);
    await track.locator('.public-gift').first().focus();await page.keyboard.press('End');await page.waitForTimeout(60);assert.equal(await track.evaluate(n=>Number(document.activeElement.dataset.awardIndex)),Number(await track.getAttribute('data-total'))-1);
    await page.keyboard.press('Home');await page.waitForTimeout(60);assert.equal(await track.evaluate(n=>document.activeElement.dataset.awardIndex),'0');assert((await track.locator('.public-trophy').count())<=40);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(60);await page.locator('#playerProfileDialog .public-player-shelf').screenshot({path:out+'/'+engine+'-mobile.png'});
    const bounds=await page.locator('#playerProfileDialog').evaluate(n=>({width:n.getBoundingClientRect().width,scroll:n.scrollWidth,client:n.clientWidth}));assert(bounds.width<=390&&bounds.scroll<=bounds.client+1);
    await page.locator('#playerProfileDialog .personal-close').click();await page.evaluate(id=>KillexPlayerProfile.open(id),profile.id);await page.waitForFunction(()=>document.querySelector('#playerProfileDialog .public-shelf-track')?.scrollLeft===0);assert.equal(await page.locator('.public-gift .regalia-count').count(),0);assert.equal(requests.length,1);
    assert.deepEqual(errors,[]);report.push({engine,separateGifts:66,largeShelf:10000,maxMounted:40,historyRequests:requests.length,pageErrors:0});console.log(JSON.stringify(report.at(-1)));
  } finally {await browser?.close();await app.close();}
}fs.writeFileSync(out+'/browser-results.json',JSON.stringify(report,null,2));})().catch(e=>{console.error(e.stack);process.exitCode=1});
