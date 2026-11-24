"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{once}=require("node:events");
const engines=require("playwright-core"),{createGameServer}=require("../../src/server/game-server");
const output=process.env.WIRE_BROWSER_OUTPUT||path.resolve(__dirname,"../artifacts/wire-schema");fs.mkdirSync(output,{recursive:true});
(async()=>{const report=[];
for(const engine of ["chromium","firefox","webkit"]){
 const app=createGameServer({testBots:{enabled:false}});let browser;
 try{app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");const url="http://127.0.0.1:"+app.httpServer.address().port;
 browser=await engines[engine].launch({headless:true,...(engine==="chromium"?{channel:"chrome"}:{})});
 for(const mobile of [false,true]){
  const auth=app.profiles.open(),p=app.profiles.find(auth.token);p.name="Проверка сети";p.personal={nameSet:true,introPending:false,gender:"male",vkUrl:""};
  p.loginReward={date:require("../../src/server/accounts/account-benefits").loginRewardDay(Date.now()),day:1};
  p.account=require("../../src/server/accounts/account-benefits").fresh();p.account.vipUntil=p.account.premiumUntil=Date.now()+86400000;
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1336,height:768},hasTouch:mobile,...(engine!=="firefox"?{isMobile:mobile}:{})});
  await context.addCookies([{name:"sferorumiya_session",value:auth.token,url}]);
  await context.addInitScript(()=>{const Native=WebSocket;window.__wire={states:0,rows:0,protocol:null,errors:[]};window.WebSocket=class extends Native{constructor(...args){super(...args);this.addEventListener("open",()=>window.__wire.protocol=this.protocol);this.addEventListener("message",event=>{try{const p=JSON.parse(event.data);if(p.type==="state"){window.__wire.states++;window.__wire.rows+=(p.playersDelta?.upsert||[]).filter(Array.isArray).length;}}catch(e){window.__wire.errors.push(e.message);}});}};});
  const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>!document.querySelector("#playButton").disabled);
  const close=page.getByRole("button",{name:"Закрыть новости",exact:true});if(await close.isVisible())await close.click();
  await page.locator("#playButton").click();await page.waitForFunction(()=>document.body.dataset.screen==="arena"&&window.__wire.states>=30);
  await page.keyboard.press("Space");await page.keyboard.press("KeyW");await page.waitForFunction(()=>window.__wire.states>=50);
  const wire=await page.evaluate(()=>window.__wire);assert.equal(wire.protocol,"sferorumiya-state-v10");assert(wire.rows>0);assert.deepEqual(wire.errors,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:output+"/"+engine+"-"+(mobile?"mobile":"desktop")+".png"});report.push({engine,mobile,...wire,pageErrors:errors});await context.close();
 }
 }finally{await browser?.close();await app.close();}
}
fs.writeFileSync(output+"/report.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
