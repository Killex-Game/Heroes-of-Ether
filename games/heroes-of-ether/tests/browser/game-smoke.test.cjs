const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{once}=require('events');
const root=path.resolve(__dirname,"../.."),req=require('module').createRequire(root+'/package.json');
const pw=require("playwright");
const artifacts=process.env.KILLEX_TEST_ARTIFACTS||path.join(__dirname,"../artifacts/game-smoke");fs.mkdirSync(artifacts,{recursive:true});
const fixture=req('./tests/helpers/black-friday-fixture')();fixture.command('stop',{runId:fixture.run.id});
const p=fixture.store.find(fixture.user.token);p.name='Арден';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};p.greatness=2000000;p.level=30;p.progress.xp=req('./src/server/progression/experience-progression').xpForLevel(30);p.wallet.crystals=10000;
req('./src/server/progression/title-chest-rewards').awardTitles(p,fixture.now());p.honors.notified=p.honors.claimed;p.loginReward={date:req('./src/server/accounts/account-benefits').loginRewardDay(fixture.now()),day:1};
(async()=>{const engine=process.argv[2]||'chromium',report={engine,errors:[],missing:[],checks:[]};let browser;
const app=req('./src/server/game-server').createGameServer({profiles:fixture.store,events:fixture.manager,autoTick:true,testBots:{enabled:false},wallNow:fixture.now});
try{app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
browser=await pw[engine].launch({headless:true,...(engine==="chromium"?{channel:process.env.KILLEX_BROWSER_CHANNEL||"chrome"}:{}),...(process.env.KILLEX_BROWSER_EXECUTABLE?{executablePath:process.env.KILLEX_BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1366,height:900}});await context.addCookies([{name:'sferorumiya_session',value:fixture.user.token,url}]);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()===404)report.missing.push(r.url())});
await page.goto(url);await page.waitForFunction(()=>!document.getElementById('playButton').disabled);
for(let i=0;i<30;i++){await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]')){const done=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='Отлично');if(done)done.click();else d.close();}});await page.waitForTimeout(80)}
const brand=await page.evaluate(()=>({globals:Object.keys(window).filter(k=>k.startsWith('Sferorumiya')),project:window.KillexPlatform.project,controls:!!window.KillexControls}));assert.deepEqual(brand,{globals:[],project:'Killex',controls:true});
assert.equal(Object.keys(fixture.store.data.profiles).length,1);
const style=async selector=>page.locator(selector).evaluate(e=>{const s=getComputedStyle(e);return {color:s.color,background:s.backgroundImage,border:s.borderImageSource,filter:s.filter,opacity:s.opacity,disabled:e.disabled,pending:e.hasAttribute('data-pending')}});
await page.locator('#petsSection').click();await page.locator('#petsDialog[open]').waitFor();
const target='#petsDialog [data-action="food"]';const before=await style(target);assert.equal(before.disabled,false);
let release;const gate=new Promise(resolve=>release=resolve);let requests=0;
await page.route('**/api/pets/action',async route=>{requests++;await gate;await route.continue()});
await page.locator(target).click();await page.locator('dialog[open]').last().getByRole('button',{name:'Купить',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#petsDialog [data-action="food"][data-pending]'));
const during=await style(target);assert.equal(during.disabled,true);assert.equal(during.pending,true);for(const key of ['color','background','border','filter','opacity'])assert.equal(during[key],before[key],key);
const locked=await style('#petsDialog [data-action="feed"]');assert.equal(locked.disabled,true);assert.equal(locked.pending,false);
await page.locator(target).evaluate(e=>{for(let i=0;i<10;i++)e.click()});await page.waitForTimeout(80);assert.equal(requests,1);
await page.locator('#petsDialog').screenshot({path:path.join(artifacts,engine+'-pending-pets.png')});release();await page.waitForFunction(()=>!document.querySelector('#petsDialog [data-action="food"]').disabled);assert.equal(requests,1);
report.checks.push({case:'delayed food purchase',before,during,locked,requests});
await page.evaluate(()=>document.getElementById('petsDialog').close());await page.locator('#wardrobeSection').click();await page.locator('#skinsDialog[open]').waitFor();await page.locator('#skinsDialog').getByRole('button',{name:'Шапки',exact:true}).click();
const hat='#skinsDialog [data-accessory-id="title_prince_hat"] button';const hbefore=await style(hat);assert.equal(hbefore.disabled,false);
let releaseHat;const hatGate=new Promise(resolve=>releaseHat=resolve);await page.route('**/api/profile/accessory',async route=>{await hatGate;await route.continue()});await page.locator(hat).evaluate(e=>e.click());await page.waitForFunction(()=>document.querySelector('[data-accessory-id="title_prince_hat"] button[data-pending]'));
const hduring=await style(hat);for(const key of ['color','background','border','filter','opacity'])assert.equal(hduring[key],hbefore[key],key);releaseHat();await page.waitForFunction(()=>!document.querySelector('[data-accessory-id="title_prince_hat"] button').disabled);report.checks.push({case:'delayed wardrobe selection',before:hbefore,during:hduring});
await page.setViewportSize({width:390,height:844});await page.locator('#skinsDialog').screenshot({path:path.join(artifacts,engine+'-killex-wardrobe-mobile.png')});
await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close()});await page.setViewportSize({width:1366,height:900});
const entries=await page.locator('.menu-tile').evaluateAll(nodes=>nodes.map(n=>n.id));
for(const width of [1366,1920,390]){
 await page.setViewportSize({width,height:900});await page.waitForTimeout(150);
 const placement=await page.evaluate(()=>{const b=document.getElementById('etherGeneratorButton'),r=b.getBoundingClientRect(),e=document.querySelector('.effi-lobby-bubble').getBoundingClientRect();return {clickable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b,overlap:Math.min(r.right,e.right)>Math.max(r.left,e.left)&&Math.min(r.bottom,e.bottom)>Math.max(r.top,e.top)};});
 assert(placement.clickable,'Generator remains clickable at '+width);assert(!placement.overlap,'Effi stays outside generator at '+width);
 await page.screenshot({path:path.join(artifacts,engine+'-generator-'+width+'.png')});
}
await page.setViewportSize({width:1366,height:900});report.checks.push({case:'Effi and generator do not overlap',widths:[1366,1920,390]});
for(const id of entries){const target=page.locator('#'+id);if(await target.isDisabled())continue;await target.click();await page.waitForTimeout(120);await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();document.querySelector('#petsDialog .pet-back')?.click()});}
await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close()});
await page.locator('#playButton').click();await page.waitForFunction(()=>document.body.dataset.screen==='arena');
const findPlayer=()=>[...app.rooms.values()].flatMap(room=>[...room.arena.players.values()]).find(player=>player.profileId===p.id);
let player;for(let i=0;i<100&&!player;i++){player=findPlayer();if(!player)await page.waitForTimeout(50)}assert(player,'Arena entry');const beforeMove={x:player.x,y:player.y};
await page.waitForTimeout(600);await page.mouse.move(800,450);await page.mouse.move(1150,450,{steps:10});await page.waitForTimeout(900);player=findPlayer();report.motion={before:beforeMove,after:{x:player.x,y:player.y,targetX:player.targetX,targetY:player.targetY,dead:player.dead,parts:player.parts?.length},ui:await page.evaluate(()=>({dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),screen:document.body.dataset.screen,transition:window.KillexArenaTransition?.active,settingsHidden:document.getElementById('settingsMenu').hidden,pointerTarget:document.elementFromPoint(1150,450)?.outerHTML.slice(0,200),canvas:document.getElementById('game').getBoundingClientRect().toJSON()}))};assert(Math.hypot(player.x-beforeMove.x,player.y-beforeMove.y)>1,'Authoritative movement');
await page.evaluate(()=>{const original=KillexArenaView.dizzyStrength;window.__stoneCheck={frames:0,rotationMax:0,strengthMax:0};KillexArenaView.dizzyStrength=(remaining,reduced,state)=>{const strength=original(remaining,reduced,state);if(remaining>0){window.__stoneCheck.frames++;window.__stoneCheck.rotationMax=Math.max(window.__stoneCheck.rotationMax,Math.abs(state.rotation));window.__stoneCheck.strengthMax=Math.max(window.__stoneCheck.strengthMax,strength);}return strength;};});
player.effects.stone=performance.now()+5000;
await page.waitForFunction(()=>document.body.hasAttribute('data-stone-chaos'));
await page.waitForFunction(()=>window.__stoneCheck.strengthMax===1);
await page.screenshot({path:path.join(artifacts,engine+'-stone-no-spin.png')});
await page.waitForFunction(()=>!document.body.hasAttribute('data-stone-chaos'),{},{timeout:7000});
const stone=await page.evaluate(()=>window.__stoneCheck);assert(stone.frames>10);assert.equal(stone.rotationMax,0);report.checks.push({case:'Stone retains chaos for five seconds with no scene spin',...stone});
await page.locator('#leaveButton').click();await page.locator('#leaveYes').click();await page.locator('#lifeLobby').click();try{await page.waitForFunction(()=>document.body.dataset.screen==='lobby'&&!document.getElementById('playButton').disabled)}catch(error){report.exit=await page.evaluate(()=>({screen:document.body.dataset.screen,play:document.getElementById('playButton').outerHTML,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>({id:d.id,text:d.textContent.slice(0,250)})),text:document.getElementById('lobbyStatus')?.textContent}));throw error;}
assert.equal(fixture.store.find(fixture.user.token).id,p.id);report.checks.push({case:'menu navigation and arena round trip',menus:entries.length});
assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);report.passed=true;
}finally{fs.writeFileSync(path.join(artifacts,engine+'-pending-brand.json'),JSON.stringify(report,null,2));await browser?.close();await app.close();}console.log(JSON.stringify({engine,passed:true,checks:report.checks.length}));
})().catch(e=>{console.error(e);process.exitCode=1});
