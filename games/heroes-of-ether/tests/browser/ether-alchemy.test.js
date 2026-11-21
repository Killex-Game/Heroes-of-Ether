'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events');
const output=path.resolve(__dirname,'../../../../artifacts/ether-alchemy-20261116');fs.mkdirSync(output,{recursive:true});
const pw=require('playwright');
const game=path.resolve(__dirname,'../..'),req=require('node:module').createRequire(game+'/package.json');
const f=req('./tests/helpers/black-friday-fixture')();f.command('stop',{runId:f.run.id});f.time(Math.floor(Date.now()/60000)*60000);
const rules=req('./public/shared/alchemy-rules');f.command('start',{eventId:rules.manifest.id});
const p=f.p();p.name='Алхимик';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};
p.loginReward={date:req('./src/server/accounts/account-benefits').loginRewardDay(f.now()),day:1};
p.alchemy={version:1,natural:150000,ingredients:Object.fromEntries(rules.ingredients.map(i=>[i.id,100])),learned:rules.potions.map(p=>p.id),equipped:'strength'};
for(const potion of rules.potions)p.inventory[potion.boosterId]=5;
const app=req('./src/server/game-server').createGameServer({profiles:f.store,events:f.manager,wallNow:f.now,autoTick:false,testBots:{enabled:false}});
const results=[];
(async()=>{try{
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 for(const engine of (process.env.ALCHEMY_ENGINE?[process.env.ALCHEMY_ENGINE]:['chromium','firefox','webkit'])){
  f.p().alchemy.natural=150000;
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
  try{
   const context=await browser.newContext({viewport:{width:1366,height:768}});await context.addCookies([{name:'sferorumiya_session',value:f.user.token,url}]);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url);await page.waitForFunction(()=>!window.KillexBoot?.active);
   for(let i=0;i<8;i++){await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close()});await page.waitForTimeout(100)}
   await page.locator('#alchemyButton').click();await page.locator('#alchemyDialog').waitFor({state:'visible'});
   await page.waitForFunction(()=>[...document.querySelectorAll('#alchemyDialog img')].filter(n=>{const r=n.getBoundingClientRect();return n.checkVisibility()&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}).every(n=>n.complete&&n.naturalWidth>0));
   assert.equal(await page.locator('.alchemy-shelf .alchemy-potion').count(),16);
   assert.equal(await page.locator('.alchemy-ingredient-cell').count(),10);
   for(const [width,height] of [[1366,768],[390,844]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(200);
    await page.screenshot({path:path.join(output,`${engine}-lab-${width}.png`)});
    const boxes=await page.evaluate(()=>{const d=document.getElementById('alchemyDialog'),r=d.getBoundingClientRect();return {width:r.width,scroll:d.scrollWidth,viewport:innerWidth,height:r.height,viewportHeight:innerHeight}});
    assert(boxes.scroll<=boxes.width+1,JSON.stringify(boxes));assert(boxes.height<=height,JSON.stringify(boxes));results.push({engine,width,boxes});
    await page.locator('#alchemyBook').click();await page.waitForTimeout(150);
    await page.screenshot({path:path.join(output,`${engine}-recipe-${width}.png`)});
    await page.locator('.alchemy-recipe-header button').last().click();
   }
   await page.setViewportSize({width:1366,height:768});
   for(const potion of rules.potions){
    await page.locator(`.alchemy-shelf [data-potion="${potion.id}"]`).click();
    const card=page.locator(`.alchemy-recipe[data-potion="${potion.id}"]`);
    await card.locator('.alchemy-recipe-potion').evaluate(n=>n.decode());
    assert.equal(await card.locator('h3').textContent(),potion.name);
    assert.equal(await card.locator('.alchemy-recipe-cost').count(),potion.ingredients.length);
    assert(await page.locator('.alchemy-stage').evaluate(n=>n.inert));
    assert.equal(await page.locator('#alchemyDialog').getAttribute('data-animate'),'false');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.alchemy-stage').evaluate(n=>n.inert),false);
    assert.equal(await page.locator('#alchemyDialog').getAttribute('data-animate'),String(await page.locator('#alchemyDialog').getAttribute('data-motion-limited') !== 'true'));
   }
   await page.locator('#alchemyBook').click();
   await page.locator('.alchemy-recipes').hover();await page.mouse.wheel(0,600);await page.waitForTimeout(600);
   const left=await page.locator('.alchemy-recipes').evaluate(n=>n.scrollLeft);assert(left>100,'wheel must navigate horizontally');
   await page.locator('.alchemy-recipe-header button').last().click();
   await page.locator('.alchemy-shelf [data-potion="strength"]').click();
   const before=f.p().inventory.alchemy_strength;
   await page.locator('.alchemy-recipe[data-potion="strength"] [data-action="brew"]').click();
   await page.locator('.alchemy-result:not([hidden])').waitFor();assert.equal(f.p().inventory.alchemy_strength,before+5);
   assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.alchemy-result button')),true);
   await page.locator('.alchemy-result button').click();
   await page.locator('#alchemyExchange').click();await page.locator('.alchemy-result:not([hidden])').waitFor();
   assert.equal(f.p().alchemy.natural,50000);assert.match(await page.locator('.alchemy-natural').textContent(),/50\s000/);
   // Closing from a result must not leave the next visit inert.
   await page.evaluate(()=>document.getElementById('alchemyDialog').close());
   await page.locator('#alchemyButton').click();
   assert.equal(await page.locator('.alchemy-stage').evaluate(n=>n.inert),false);
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.alchemy-book img').evaluate(n=>getComputedStyle(n).animationName),'none');
   await page.waitForFunction(()=>window.KillexAlchemyRules.ingredients.every(i=>window.KillexAlchemyArt.sprite(i.id)));
   const reduced=await page.evaluate(()=>{const sizes=[],ctx={drawImage:(...args)=>sizes.push(args[3])},a=window.KillexAlchemyArt,item={alchemyIngredient:'leaf'};a.draw(ctx,item,0,0,14,0);a.draw(ctx,item,0,0,14,750);return sizes});
   assert.equal(reduced[0],reduced[1]);
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.waitForFunction(()=>{const sizes=[],ctx={drawImage:(...a)=>sizes.push(a[3])},item={alchemyIngredient:'leaf'};window.KillexAlchemyArt.draw(ctx,item,0,0,14,0);window.KillexAlchemyArt.draw(ctx,item,0,0,14,750);return sizes[1]>sizes[0]});
   const breathing=await page.evaluate(()=>{const sizes=[],ctx={drawImage:(...args)=>sizes.push(args[3])},a=window.KillexAlchemyArt,item={alchemyIngredient:'leaf'};a.draw(ctx,item,0,0,14,0);a.draw(ctx,item,0,0,14,750);return {sizes,cached:a.sprite('leaf')===a.sprite('leaf'),radius:item.radius}});
   assert(breathing.sizes[1]>breathing.sizes[0]);assert(breathing.cached);
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
   assert.equal(await page.locator('#alchemyDialog').getAttribute('data-animate'),'false');
   await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
   assert.equal(await page.locator('#alchemyDialog').getAttribute('data-animate'),String(await page.locator('#alchemyDialog').getAttribute('data-motion-limited') !== 'true'));
   assert.deepEqual(errors,[]);results.push({engine,brew:true,exchange:true,errors});await context.close();
  }finally{await browser.close()}
 }
 fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,cases:results.length}));
}finally{await app.close()}})().catch(e=>{fs.writeFileSync(path.join(output,'browser-failure.json'),JSON.stringify({message:e.stack,results},null,2));console.error(e);process.exitCode=1});

