"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert/strict"),{once}=require("events"),pw=require("playwright");
const {randomUUID}=require("crypto"),f=require("../helpers/black-friday-fixture")();
const p=f.p();p.name="Арден";p.personal={nameSet:true,introPending:false,gender:"male",vkUrl:""};p.level=30;p.progress.xp=require("../../src/server/progression/experience-progression").xpForLevel(30);p.wallet={coins:1234567,crystals:1234567,bucks:1234567};
p.loginReward={date:require("../../src/server/accounts/account-benefits").loginRewardDay(f.now()),day:1};
const out=process.env.KILLEX_TEST_ARTIFACTS||path.resolve(__dirname,"../artifacts/gift-sets-lobby");fs.mkdirSync(out,{recursive:true});
const engine=process.argv[2]||"chromium",report={engine,errors:[],missing:[],checks:[]};let browser;
const app=require("../../src/server/game-server").createGameServer({profiles:f.store,events:f.manager,autoTick:true,testBots:{enabled:false},wallNow:f.now});
(async()=>{try{
 app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");const url="http://127.0.0.1:"+app.httpServer.address().port;
 browser=await pw[engine].launch({headless:true,...(engine==="chromium"?{channel:"chrome"}:{})});const context=await browser.newContext({viewport:{width:1366,height:900}});await context.addCookies([{name:"sferorumiya_session",value:f.user.token,url}]);await context.addInitScript(epoch=>{Date.now=()=>epoch+performance.now();},f.now());const page=await context.newPage();
 page.on("pageerror",e=>report.errors.push(e.message));page.on("response",r=>{if(r.status()===404)report.missing.push(r.url())});
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById("playButton").disabled);
 const dismiss=async()=>{for(let i=0;i<35;i++){await page.evaluate(()=>{for(const d of document.querySelectorAll("dialog[open]")){const b=[...d.querySelectorAll("button")].find(b=>b.textContent.trim()==="Отлично")||[...d.querySelectorAll("button")].find(b=>b.textContent.trim()==="×");if(b&&!b.disabled)b.click();else d.close();}});await page.waitForTimeout(100)}};await dismiss();
 for(const width of [1366,1920,390]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(150);
  const g=await page.evaluate(()=>{const generator=document.getElementById("etherGeneratorButton"),promo=document.getElementById("promoCodeSection"),effi=document.querySelector(".effi-lobby"),head=document.querySelector(".lobby-header");const before=head.getBoundingClientRect().toJSON();effi.style.display="none";const after=head.getBoundingClientRect().toJSON();effi.style.display="";return {before,after,position:getComputedStyle(effi).position,above:generator.nextElementSibling===promo,generator:generator.getBoundingClientRect().toJSON(),promo:promo.getBoundingClientRect().toJSON()};});
  assert.equal(g.position,"fixed");assert.deepEqual(g.before,g.after);assert(g.above);assert(g.generator.y<=g.promo.y);report.checks.push({width,...g});await page.screenshot({path:path.join(out,engine+"-lobby-"+width+".png")});
 }
 await page.setViewportSize({width:1366,height:900});await page.locator(".effi-lobby-dismiss").click();
 await page.locator("#etherGeneratorButton").click();assert(await page.locator("#etherGeneratorDialog").isVisible());await dismiss();await page.locator("#promoCodeSection").click();assert(await page.locator("#promoCodeDialog").isVisible());await dismiss();
 const set=async ends=>{f.store.transact(f.user.token,randomUUID(),"fixture-effects",p=>{p.social||={marriage:null,invitations:[],gifts:[],inviteReadyAt:0};p.social.giftEffects=ends;});const profile=f.store.view(f.store.find(f.user.token));await page.evaluate(profile=>document.dispatchEvent(new CustomEvent("killex:profile",{detail:profile})),profile);};
 const original=await page.locator("#lobbySkin").getAttribute("src");
 for(const id of ["hex","infection","curse"]){await set({[id]:f.now()+3600000});await page.waitForFunction(id=>document.querySelector("#lobbySkin").parentElement.dataset.giftVisual===id,id);await page.locator("#lobbySkin").evaluate(async e=>{const img=e.parentElement.querySelector(".gift-avatar-overlay");await img.decode();});assert.equal(await page.locator("#lobbySkin").getAttribute("src"),original);const bounds=await page.locator("#lobbySkin").evaluate(e=>({host:e.parentElement.getBoundingClientRect().toJSON(),stage:document.getElementById("skinPreview").getBoundingClientRect().toJSON()}));assert(bounds.host.width>100&&bounds.host.height>100);assert(Math.abs(bounds.host.x-bounds.stage.x)<5);assert(Math.abs(bounds.host.y-bounds.stage.y)<5);await page.locator("#skinPreview").screenshot({path:path.join(out,engine+"-avatar-"+id+".png")});}
 assert.equal(await page.locator("#lobbySkin").evaluate(e=>getComputedStyle(e).visibility),"hidden");
 assert.match(await page.locator("#lobbySkin").evaluate(e=>e.parentElement.querySelector(".gift-avatar-overlay").src),/skins\/negative-sets-v1\/1024\/curse-pig.webp/);
 await page.evaluate(()=>{const host=document.getElementById("lobbySkin").parentElement;KillexGiftAppearance.bind(host,{giftAppearance:{curse:Date.now()+1200,hex:Date.now()+3500}});});await page.waitForFunction(()=>document.getElementById("lobbySkin").parentElement.dataset.giftVisual==="hex");await page.waitForFunction(()=>!document.getElementById("lobbySkin").parentElement.querySelector(".gift-avatar-overlay"));
 assert.equal(await page.locator("#lobbySkin").evaluate(e=>getComputedStyle(e).visibility),"visible");
 const publicAvatar=await page.evaluate(async profile=>{const box=KillexPlayerProfile.avatar(profile,"public-player-avatar");document.body.append(box);const img=box.querySelector(".gift-avatar-overlay");await img.decode();const result={visual:box.querySelector(".avatar-disc").dataset.giftVisual,source:img.src,base:getComputedStyle(box.querySelector(".avatar-disc > img:not(.gift-avatar-overlay)")).visibility};box.remove();return result;},f.store.view(f.store.find(f.user.token)));
 assert.equal(publicAvatar.visual,"curse");assert.equal(publicAvatar.base,"hidden");assert.match(publicAvatar.source,/curse-pig.webp/);
 await set({curse:f.now()+3600000});await page.evaluate(()=>{window.giftPaints=[];const old=KillexGiftAppearance;window.KillexGiftAppearance={...old,draw(...args){if(args[2]&&!giftPaints.includes(args[1]))giftPaints.push(args[1]);return old.draw(...args);}};});
 await page.locator("#playButton").click();await page.waitForFunction(()=>document.body.dataset.screen==="arena");await page.waitForFunction(()=>giftPaints.includes("curse"));await page.screenshot({path:path.join(out,engine+"-arena-curse.png")});
 await set({hex:f.now()+3600000});await page.waitForFunction(()=>giftPaints.includes("hex"));await set({});
 assert.equal(f.store.find(f.user.token).skinId,p.skinId);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);report.passed=true;
}finally{fs.writeFileSync(path.join(out,engine+"-gift-lobby.json"),JSON.stringify(report,null,2));await browser?.close();await app.close();}console.log(JSON.stringify({engine,passed:true}));})().catch(e=>{console.error(e);process.exitCode=1});
