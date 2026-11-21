"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { once } = require("node:events");
const engines = require("playwright"), fixture = require("../helpers/black-friday-fixture");
const { createGameServer } = require("../../src/server/game-server"), { Arena } = require("../../src/server/arena/arena-simulation");
const rules = require("../../public/shared/alchemy-rules");
const output = path.resolve(__dirname, "../../../../artifacts/ether-alchemy-20261116");
const results = [];
async function until(check) { for (let i=0;i<160;i++) { if (check()) return; await new Promise(r=>setTimeout(r,25)); } assert.fail("Server action did not complete"); }
(async()=>{
 for (const engine of process.env.ALCHEMY_ENGINE ? [process.env.ALCHEMY_ENGINE] : ["chromium","firefox","webkit"]) {
  const f=fixture(); f.command("stop",{runId:f.run.id}); f.time(Math.floor(Date.now()/60000)*60000); f.command("start",{eventId:rules.manifest.id});
  const p=f.p(); p.name="Алхимик"; p.personal={nameSet:true,introPending:false,gender:"male",vkUrl:""};
  p.loginReward={date:require("../../src/server/accounts/account-benefits").loginRewardDay(f.now()),day:1};
  p.alchemy={version:1,natural:150000,ingredients:Object.fromEntries(rules.ingredients.map(i=>[i.id,100])),learned:["strength"],equipped:"strength"};
  p.inventory.alchemy_strength=5;
  p.inventory.alchemy_swiftness=p.inventory.alchemy_knowledge=3;
  const app=createGameServer({profiles:f.store,events:f.manager,arena:new Arena({etherCount:0}),wallNow:f.now,testBots:{enabled:false}});
  let browser;
  try {
   app.httpServer.listen(0,"127.0.0.1"); await once(app.httpServer,"listening"); const url="http://127.0.0.1:"+app.httpServer.address().port;
   browser=await engines[engine].launch({headless:true,...(engine==="chromium"?{channel:"chrome"}:{})});
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
   await require('../helpers/browser-established-profile').prepareContext(context);
   await context.addCookies([{name:"sferorumiya_session",value:f.user.token,url}]);
   const page=await context.newPage(), errors=[], earlyArt=new Set(); page.on("pageerror",e=>errors.push(e.message));
   page.on("request",request=>{if(request.url().includes('/assets/events/ether-alchemy/'))earlyArt.add(request.url().split('/').at(-1))});
   await page.goto(url); await page.waitForFunction(()=>!window.KillexBoot?.active);
   for(let i=0;i<8;i++){await page.evaluate(()=>{for(const d of document.querySelectorAll("dialog[open]"))d.close()});await page.waitForTimeout(100)}
   const beforeOpen=[...earlyArt]; assert(beforeOpen.length<=5,'Hidden laboratory eagerly loaded '+beforeOpen.length+' assets');
   await page.locator("#alchemyButton").tap(); await page.locator("#alchemyBook").tap();
   // The first response is deliberately lost AFTER the server has committed.
   const requests=[]; let drop=true;
   await page.route("**/api/alchemy/action",async route=>{
    const body=route.request().postDataJSON(); requests.push(body);
    if(drop && body.action==="brew") { drop=false; const response=await route.fetch(); assert.equal(response.status(),200); await route.abort(); }
    else await route.continue();
   });
   const brew=page.locator('.alchemy-recipe[data-potion="strength"] [data-action="brew"]');
   const stock=f.p().inventory.alchemy_strength;
   await brew.tap(); await until(()=>f.p().inventory.alchemy_strength===stock+5);
   await page.waitForFunction(()=>!document.querySelector('.alchemy-recipe[data-potion="strength"] [data-action="brew"]').disabled);
   await brew.tap(); await page.locator(".alchemy-result:not([hidden])").waitFor();
   assert.equal(f.p().inventory.alchemy_strength,stock+5); assert.equal(requests[0].requestId,requests[1].requestId);
   await page.screenshot({path:path.join(output,engine+"-mobile-brew-result.png")});
   await page.locator(".alchemy-result button").tap(); await page.evaluate(()=>document.getElementById("alchemyDialog").close());
   // End the event in the fixture. Existing potions and the permanent generator remain usable.
   f.command("stop",{runId:f.manager.active().id}); await page.reload();
   await page.waitForFunction(()=>!window.KillexBoot?.active);
   for(let i=0;i<5;i++){await page.evaluate(()=>{for(const d of document.querySelectorAll("dialog[open]"))d.close()});await page.waitForTimeout(100)}
   for(const [width,height] of [[390,844],[1366,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    const button=page.locator('#etherGeneratorButton'); await button.scrollIntoViewIfNeeded();
    const layout=await button.evaluate(n=>{const r=n.getBoundingClientRect(),label=n.querySelector('strong').getBoundingClientRect();return{width:r.width,scroll:n.scrollWidth,labelLeft:label.left-r.left,labelRight:r.right-label.right,labelTop:label.top-r.top,labelBottom:r.bottom-label.bottom}});
    assert(layout.scroll<=layout.width+1&&layout.labelLeft>=0&&layout.labelRight>=0&&layout.labelTop>=0&&layout.labelBottom>=0,JSON.stringify(layout));
    await page.screenshot({path:path.join(output,engine+'-permanent-lobby-'+width+'.png')});
   }
   await page.setViewportSize({width:390,height:844});
   await page.locator('#inventorySection').tap();
   for(const id of ['swiftness','knowledge']) {
    const choose=page.locator(`[data-booster-id="alchemy_${id}"] .potion-order-controls .booster-action`);
    await choose.tap(); await until(()=>f.p().alchemy.queue?.includes(id));
   }
   const knowledge=page.locator('[data-booster-id="alchemy_knowledge"] .potion-order-controls');
   await knowledge.getByRole('button',{name:/Раньше/}).tap();
   await until(()=>f.p().alchemy.queue?.join(',')==='strength,knowledge,swiftness');
   await page.screenshot({path:path.join(output,engine+'-potion-queue.png')});
   await page.evaluate(()=>document.querySelector('dialog[data-mode="inventory"]').close());
   await page.locator("#etherGeneratorButton").tap(); await page.locator("#alchemyBook").tap();
   assert.equal(await brew.isDisabled(),true);
   await page.evaluate(()=>document.getElementById("alchemyDialog").close());
   await page.locator('#arenaPickerButton').tap();
   await page.locator('#arenaPickerDialog .arena-auto').tap();
   await page.locator("#arena").waitFor({state:"visible"});
   const player=[...app.arena.players.values()].find(row=>row.profileId===f.p().id); assert(player); player.protectedUntil=0;
   const z=page.locator("#potionSlotZ"); await z.waitFor({state:"visible"});
   assert.match(await page.locator("#boosterBudget").textContent(),/Z: до 3 разных зелий/);
   await page.waitForFunction(()=>!document.getElementById("potionSlotZ").disabled);
   const before=f.p().inventory.alchemy_strength; await z.tap(); await until(()=>player.potion?.id==="strength");
   assert.equal(f.p().inventory.alchemy_strength,before-1);
   for(const id of ['knowledge','swiftness']) {
    await page.waitForFunction(()=>!document.getElementById('potionSlotZ').disabled);
    await z.tap(); await until(()=>player.potion?.ids?.includes(id));
    assert.equal(f.p().inventory['alchemy_'+id],2);
   }
   assert.deepEqual(player.potion.ids,['strength','knowledge','swiftness']);
   await page.waitForFunction(()=>document.getElementById("potionSlotZ").disabled);
   await page.keyboard.press("KeyZ"); await page.waitForTimeout(150); assert.equal(f.p().inventory.alchemy_strength,before-1);
   assert.equal(await page.locator("#alchemyDialog").getAttribute("data-animate"),"false");
   await page.screenshot({path:path.join(output,engine+"-mobile-arena-z.png")});
   await page.locator("#leaveButton").tap(); await page.locator("#leaveYes").tap();
   await page.locator("#lifeResultDialog").waitFor({state:"visible"}); await page.locator("#lifeLobby").tap();
   await page.locator("#lobby").waitFor({state:"visible"});
   await page.waitForFunction(()=>!document.getElementById("playButton").disabled);
   await page.setViewportSize({width:1366,height:768});
   await page.locator("#playButton").click(); await page.locator("#arena").waitFor({state:"visible"});
   await page.waitForFunction(()=>!window.KillexArenaTransition.active);
   const next=[...app.arena.players.values()].find(row=>row.profileId===f.p().id && !row.isRemnant); assert(next); next.protectedUntil=0;
   await page.waitForFunction(()=>!document.getElementById("potionSlotZ").disabled);
   await page.keyboard.press("KeyZ"); await until(()=>next.potion?.id==="strength");
   assert.equal(f.p().inventory.alchemy_strength,before-2);
   assert.deepEqual(errors,[]); results.push({engine,mobileBrewRetry:true,offEvent:true,touchZ:true,threeEffects:true,inventoryOrder:true,autoArenaEntry:true,keyboardZNextLife:true,beforeOpen,errors});
   await context.close();
  } finally { await browser?.close(); await app.close(); }
 }
 fs.writeFileSync(path.join(output,"browser-lifecycle-results.json"),JSON.stringify(results,null,2)); console.log(JSON.stringify({ok:true,results}));
})().catch(e=>{fs.writeFileSync(path.join(output,"browser-lifecycle-failure.json"),JSON.stringify({message:e.stack,results},null,2));console.error(e);process.exitCode=1});
