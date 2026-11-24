"use strict";
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{once}=require('events');
const engines=require('playwright-core'),{createGameServer}=require('../../src/server/game-server');
const output=process.env.STATUS_NATURAL_OUTPUT||path.resolve(__dirname,'../../../../artifacts/status-natural-20261124/browser');
fs.mkdirSync(output,{recursive:true});const report=[];
(async()=>{for(const engine of process.argv[2]?[process.argv[2]]:['chromium','firefox','webkit']){
 const app=createGameServer({testBots:{enabled:false}});let browser;
 try{app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{}),...(process.env['BROWSER_'+engine.toUpperCase()]?{executablePath:process.env['BROWSER_'+engine.toUpperCase()]}:{})});
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1336,height:768},hasTouch:mobile,...(engine!=='firefox'?{isMobile:mobile}:{})});
  const auth=app.profiles.open(),p=app.profiles.find(auth.token);p.name='Проверка';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};
  p.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(Date.now()),day:1};
  p.account=require('../../src/server/accounts/account-benefits').fresh();p.account.vipUntil=p.account.premiumUntil=Date.now()+86400000;p.grantedSkins=['gift-winged-guardian'];p.skinId='gift-winged-guardian';
  await context.addCookies([{name:'sferorumiya_session',value:auth.token,url}]);
  const page=await context.newPage(),errors=[],sent=[],received=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',ws=>{ws.on('framesent',f=>{try{const m=JSON.parse(f.payload);if(m.type==='emote')sent.push(m);}catch{}});ws.on('framereceived',f=>{try{const m=JSON.parse(f.payload);if(m.type==='emote')received.push(m);}catch{}});});
  await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#playButton').disabled);
  const close=page.getByRole('button',{name:'Закрыть новости',exact:true});if(await close.isVisible())await close.click();
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('killex:choose-skin',{detail:'gift-winged-guardian'})));
  await page.waitForFunction(()=>[...document.querySelectorAll('#lobby img')].some(i=>i.src.includes('gift-winged-guardian')&&i.complete&&i.naturalWidth));
  await page.waitForFunction(()=>document.querySelectorAll('#accountMarks img').length===2&&[...document.querySelectorAll('#accountMarks img')].every(i=>i.complete&&i.naturalWidth));
  const icons=await page.evaluate(()=>[...document.querySelectorAll('#accountMarks .status-icon img,#accountButton .status-icon img')].map(i=>{const r=i.getBoundingClientRect();return {kind:i.src.includes('premium')?'premium':'vip',visibleHeight:r.height*(i.src.includes('premium')?201:181)/256};}));
  assert.equal(icons.length,4);assert(Math.max(...icons.map(i=>i.visibleHeight))-Math.min(...icons.map(i=>i.visibleHeight))<.1,JSON.stringify(icons));
  await page.screenshot({path:output+'/'+engine+'-'+(mobile?'mobile':'desktop')+'-lobby.png'});
  await page.locator('#accountButton').click();assert(await page.locator('#accountDialog').innerText().then(s=>s.includes('14 дней')&&!s.includes('×3')));await page.getByRole('button',{name:'Закрыть статусы',exact:true}).click();
  await page.locator('#playButton').click();await page.waitForFunction(()=>document.body.dataset.screen==='arena');
  const key=page.locator('.arena-emote-key').first();await key.waitFor();
  if(mobile){await key.tap();await page.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,300));assert.equal(sent.length,1);assert.equal(received.length,1);await page.locator('.arena-emote-key').nth(1).tap();assert.equal(sent.length,1);}
  else{assert.equal(await key.evaluate(n=>getComputedStyle(n).pointerEvents),'none');const r=await key.boundingBox();const under=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.arena-emote-hotkeys')===null,{x:r.x+r.width/2,y:r.y+r.height/2});assert(under);await page.keyboard.press('Digit1');await new Promise(r=>setTimeout(r,300));assert.equal(received.length,1);}
  await page.screenshot({path:output+'/'+engine+'-'+(mobile?'mobile':'desktop')+'-arena.png'});
  if(mobile){await page.setViewportSize({width:915,height:412});assert.equal(await key.evaluate(n=>getComputedStyle(n).pointerEvents),'auto');await page.screenshot({path:output+'/'+engine+'-landscape-arena.png'});}
  assert.deepEqual(errors,[]);report.push({engine,mobile,icons,sent:sent.length,received:received.length,pageErrors:errors});await context.close();
 }
 }finally{await browser?.close();await app.close();}
}fs.writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));})().catch(e=>{console.error(e);process.exitCode=1;});
