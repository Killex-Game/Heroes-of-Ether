"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert/strict"),{once}=require("events"),pw=require("playwright");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),{createGameServer}=require("../../src/server/game-server");
const engine=process.argv[2]||"chromium",out=process.env.KILLEX_TEST_ARTIFACTS||path.resolve(__dirname,"../../../../artifacts/news-medals-admin-20261114/achievements-"+engine);
fs.mkdirSync(out,{recursive:true});
const store=new ProfileStore(),auth=store.open(),p=store.find(auth.token);p.name="Проверка";p.personal={nameSet:true,introPending:false,gender:"male",vkUrl:""};p.loginReward={date:require("../../src/server/accounts/account-benefits").loginRewardDay(store.now()),day:1};
const app=createGameServer({profiles:store,autoTick:false,testBots:{enabled:false}}),report={engine,checks:[],errors:[]};let browser;
(async()=>{
 app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");const url="http://127.0.0.1:"+app.httpServer.address().port;
 browser=await pw[engine].launch({headless:true,...(engine==="chromium"?{channel:"chrome"}:{})});const context=await browser.newContext({viewport:{width:1366,height:900}});
 await context.addCookies([{name:"sferorumiya_session",value:auth.token,url}]);const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>!window.KillexBoot?.active);await page.route("**/api/**",r=>r.abort());
 await page.evaluate(()=>document.querySelectorAll("dialog[open]").forEach(d=>d.close()));
 const ids=fs.readdirSync(path.resolve(__dirname,"../../public/assets/achievements/illustrated-v2")).filter(s=>s.endsWith(".webp")).map(s=>s.slice(0,-5));
 await page.evaluate(ids=>{const gallery=document.createElement("dialog");gallery.id="canonGallery";gallery.style.cssText="width:1100px;max-width:95vw;max-height:95vh;background:#f7f0df;color:#253943;padding:16px;overflow:auto";const grid=document.createElement("div");grid.style.cssText="display:grid;grid-template-columns:repeat(10,1fr);gap:12px";for(const id of ids){const box=document.createElement("div");box.style.cssText="text-align:center;font:10px Arial;min-width:0";const badge=window.KillexAchievementBadge.create(id);box.append(badge,document.createElement("br"),id);grid.append(box);}gallery.append(grid);document.body.append(gallery);gallery.showModal();},ids);
 await page.locator("#canonGallery img").evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
 assert.equal(await page.locator("#canonGallery .achievement-badge").evaluateAll(nodes=>new Set(nodes.map(n=>getComputedStyle(n,"::after").backgroundImage)).size),1);
 const enamel=await page.locator('#canonGallery [data-badge="fashionista"]').evaluate(n=>getComputedStyle(n,"::before").backgroundImage);assert.match(enamel,/radial-gradient/);
 await page.locator("#canonGallery").screenshot({path:path.join(out,"all-70-common-frames.png")});await page.evaluate(()=>document.getElementById("canonGallery").remove());
 const profile=store.view(p),definitions=profile.progress.achievements.filter(a=>a.id!=="career");
 for(const size of [{width:1366,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
  await page.setViewportSize(size);let reference;
  for(const a of definitions){
   await page.evaluate(({profile,a})=>{const p=structuredClone(profile);p.id+="-"+a.id+"-"+innerWidth; p.progress.achievements=[{...a,claimed:Math.max(1,a.thresholds?.length||1)}];window.KillexAchievementNoticeUI.update(p);},{profile,a});
   const notice=page.locator('#achievementNotice[open][data-achievement-notice="'+a.id+'"]');await notice.waitFor();await notice.locator(".achievement-symbol").evaluate(i=>i.decode());
   const box=await notice.evaluate(d=>{const b=d.getBoundingClientRect(),i=d.querySelector(".achievement-earned-icon").getBoundingClientRect(),desc=d.querySelector(".achievement-earned-description"),text=desc.getBoundingClientRect(),reward=d.querySelector(".achievement-earned-reward").getBoundingClientRect(),name=d.querySelector(".achievement-earned-name");return{x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom,iw:i.width,ih:i.height,descriptionBottom:text.bottom,rewardTop:reward.top,descriptionTop:text.top,nameBottom:name.getBoundingClientRect().bottom,nameClipped:name.scrollHeight>name.clientHeight+1,overflow:d.scrollHeight>d.clientHeight+1};});
   reference ||= {w:box.w,h:box.h};assert.deepEqual({w:box.w,h:box.h},reference,a.id);assert.equal(box.iw,112);assert.equal(box.ih,112);assert.ok(!box.overflow&&!box.nameClipped&&box.x>=0&&box.y>=0&&box.right<=size.width+1&&box.bottom<=size.height+1,a.id+JSON.stringify(box));assert.ok(box.descriptionBottom<=box.rewardTop+1&&box.descriptionTop>=box.nameBottom-1,a.id+JSON.stringify(box));
   if(["for_clan","fashionista","pet_level_zaya","banker"].includes(a.id))await notice.screenshot({path:path.join(out,a.id+"-"+size.width+".png")});
   report.checks.push({id:a.id,size:size.width,...box});
  }
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify({engine,frames:ids.length,notices:report.checks.length}));
})().catch(e=>{report.failure=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));await browser?.close();await app.close();});
