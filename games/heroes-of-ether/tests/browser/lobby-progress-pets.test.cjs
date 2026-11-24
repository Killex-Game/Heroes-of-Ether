const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{once}=require('events');
const pw=require(process.env.KILLEX_PLAYWRIGHT || 'playwright');
const game=path.resolve(__dirname,'../..');
const out=process.env.KILLEX_TEST_ARTIFACTS || path.resolve(game,'../../artifacts/lobby-progress-pets-browser');fs.mkdirSync(out,{recursive:true});
const {createGameServer}=require(game+'/src/server/game-server');
const results=[];
(async()=>{
 for(const engine of (process.env.TEST_ENGINES||'chromium,firefox,webkit').split(',')){
  const app=createGameServer({autoTick:false,testBots:{enabled:false}});app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');
  const url='http://127.0.0.1:'+app.httpServer.address().port,browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
  try{for(const [width,height,touch]of [[1336,768,false],[1920,1080,false],[390,844,true],[915,412,true]]){
   const context=await browser.newContext({viewport:{width,height},hasTouch:touch}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const auth=app.profiles.open(),p=app.profiles.find(auth.token);p.name='Проверка';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};
   p.loginReward={date:require(game+'/src/server/accounts/account-benefits').loginRewardDay(Date.now()),day:1};
   p.account=require(game+'/src/server/accounts/account-benefits').fresh();p.account.vipUntil=p.account.premiumUntil=Date.now()+86400000;
   p.purchasedAccessories=require(game+'/public/shared/accessory-catalog').items.filter(i=>i.price).map(i=>i.id);p.wallet={coins:100000,crystals:5000,bucks:5000};
   await context.addCookies([{name:'sferorumiya_session',value:auth.token,url}]);await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#playButton').disabled);
   await page.waitForFunction(()=>!window.KillexBoot?.active);
   await page.waitForTimeout(1200);
   await page.evaluate(async()=>{for(let i=0;i<25;i++){document.querySelector('#achievementNotice[open] .sf-primary')?.click();document.querySelector('#releaseNotesDialog[open] [aria-label="Закрыть новости"]')?.click();document.querySelectorAll('dialog[open]:not(#achievementNotice):not(#releaseNotesDialog)').forEach(d=>d.close());await new Promise(r=>setTimeout(r,40));}});
   await page.screenshot({path:out+'/'+engine+'-lobby-'+width+'.png'});
   const header=await page.locator('#lobby .profile-card').evaluate(n=>({height:n.getBoundingClientRect().height,overflow:n.scrollHeight>n.clientHeight+1}));
   await page.locator('#shopSection').click();await page.locator('#boosterDialog').getByRole('button',{name:'Аксессуары',exact:true}).click();
   for(const tab of ['Шапки','Бабочки']){
    await page.locator('#boosterDialog').getByRole('button',{name:tab,exact:true}).click();
    const cards=await page.locator('#accessoryShop .accessory-card').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.accessoryId,text:n.querySelector('.accessory-shop-note').textContent,hint:n.dataset.boosterHint,expected:KillexAccessories.descriptionFor(KillexAccessories.item(n.dataset.accessoryId)),note:n.querySelector('.accessory-shop-note').getBoundingClientRect().bottom,button:n.querySelector('button').getBoundingClientRect().top})));
    assert(cards.length>0);for(const c of cards){assert.equal(c.text,'Наведи чтобы узнать подробнее');assert.equal(c.hint,c.expected);assert(c.note<=c.button+1,JSON.stringify(c));}
    const card=page.locator('#accessoryShop .accessory-card').first();if(touch)await card.tap({position:{x:20,y:20}});else await card.hover();
    await page.waitForFunction(()=>document.querySelector('#boosterTooltip').matches(':popover-open'));
    assert((await page.locator('#boosterTooltip').textContent()).includes(cards[0].hint));
    if(tab==='Шапки')await page.screenshot({path:out+'/'+engine+'-shop-'+width+'.png'});
   }
   await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.locator('#wardrobeSection').click();await page.locator('#skinsDialog').getByRole('button',{name:'Шапки',exact:true}).click();
   const charges=await page.locator('#skinsDialog .accessory-details').evaluateAll(nodes=>nodes.filter(n=>n.querySelector('.accessory-charge')).map(n=>({keys:n.querySelectorAll('kbd').length,overflow:n.scrollWidth>n.clientWidth+1,charges:n.querySelectorAll('.accessory-charge').length})));
   assert(charges.length>0);assert(charges.every(r=>r.keys===1&&!r.overflow),JSON.stringify(charges));await page.screenshot({path:out+'/'+engine+'-wardrobe-'+width+'.png'});
   await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
   await page.locator('#achievementsButton').click();await page.waitForFunction(()=>{const nodes=[...document.querySelectorAll('#achievementsDialog .achievement-badge')];return nodes.length&&nodes.every(n=>n.dataset.ready==='true');});
   await page.screenshot({path:out+'/'+engine+'-achievements-'+width+'.png'});assert.deepEqual(errors,[]);results.push({engine,width,height,header,charges:charges.length,errors});await context.close();
  }
  // A deliberately delayed illustration must not reveal the frame by itself.
  const context=await browser.newContext(),page=await context.newPage();let release;const held=new Promise(r=>release=r);
  await page.route('**/assets/achievements/illustrated-v2/fashionista.webp*',async r=>{await held;await r.continue();});
  await page.goto(url);await page.waitForFunction(()=>window.KillexAchievementBadge);
  await page.evaluate(()=>{const n=KillexAchievementBadge.create('fashionista');n.id='atomicProbe';document.body.append(n);});
  const hidden=await page.locator('#atomicProbe').evaluate(n=>[getComputedStyle(n,'::before').visibility,getComputedStyle(n,'::after').visibility,getComputedStyle(n.firstChild).visibility]);assert.deepEqual(hidden,['hidden','hidden','hidden']);
  release();await page.waitForFunction(()=>document.querySelector('#atomicProbe').dataset.ready==='true');
  const visible=await page.locator('#atomicProbe').evaluate(n=>[getComputedStyle(n,'::before').visibility,getComputedStyle(n,'::after').visibility,getComputedStyle(n.firstChild).visibility]);assert.deepEqual(visible,['visible','visible','visible']);
  const stable=await page.evaluate(()=>{const n=document.querySelector('#atomicProbe');KillexAchievementBadge.paint(n,'fashionista');return n.dataset.ready;});assert.equal(stable,'true');
  results.push({engine,atomicBadge:{hidden,visible,cachedRepaint:stable}});await context.close();
  }finally{await browser.close();await app.close();}
 }
 console.log(JSON.stringify({contexts:results.length,passed:true}));
})().catch(e=>{results.push({failure:e.stack});console.error(e);process.exitCode=1;}).finally(()=>fs.writeFileSync(out+'/browser.json',JSON.stringify(results,null,2)));
