'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),pw=require('playwright');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{createGameServer}=require('../../src/server/game-server');
const config=require('../../config/promotions.json'),catalog=require('../../public/shared/weekend-promotion-catalog');
const START=Date.parse('2026-11-20T12:00:00+03:00'),WEEK=7*86400000;
let at=START-10*86400000;
const store=new ProfileStore({now:()=>at,promotionConfig:config}),auth=store.open();
store.setPersonal(auth.token,{name:'Участник ярмарки',expectedName:auth.profile.name,gender:'unspecified',requestId:randomUUID()});
const p=()=>store.find(auth.token);p().personal.introPending=false;p().skinId=require('../../public/shared/player-identity').skins[0].id;
const app=createGameServer({profiles:store,autoTick:false,testBots:{enabled:false}}),engine=process.argv[2]||'chromium';
const out=path.resolve(process.env.PROMOTIONS_OUTPUT_ROOT || path.resolve(__dirname,'../../../../artifacts/weekend-promotions-20261114'),(process.env.PROMOTIONS_AUTO_ONLY?'auto-':'browser-')+engine);fs.mkdirSync(out,{recursive:true});
const report={engine,offers:[],overlaps:[],errors:[],missing:[]};let browser;
async function close(page){for(let i=0;i<5;i++){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.waitForTimeout(30);}}
async function dimensions(page){return page.locator('#promotionsDialog').evaluate(d=>{const r=d.getBoundingClientRect(),c=d.querySelector('.promotion-card').getBoundingClientRect(),b=d.querySelector('.promotion-buy')?.getBoundingClientRect(),h=d.querySelector('.clan-heading'),t=h.querySelector('h2').getBoundingClientRect(),x=h.querySelector('button').getBoundingClientRect(),s=getComputedStyle(d),p=d.querySelector('.promotion-purchase').getBoundingClientRect(),old=d.querySelector('.promotion-old-price'),o=old?.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,cardCenter:c.x+c.width/2,viewport:[innerWidth,innerHeight],overflowX:d.scrollWidth-d.clientWidth,button:b?{x:b.x,right:b.right,center:b.x+b.width/2,centerY:b.y+b.height/2}:null,purchase:{x:p.x,right:p.right,center:p.x+p.width/2},oldPrice:o?{x:o.x,right:o.right,centerY:o.y+o.height/2,fontSize:parseFloat(getComputedStyle(old).fontSize)}:null,serviceLabels:d.querySelectorAll('.promotion-kind,.promotion-limit').length,heading:{center:t.x+t.width/2,overlap:t.right>x.x,border:getComputedStyle(h).borderTopWidth,shadow:getComputedStyle(h).boxShadow},close:{width:x.width,height:x.height,rightGap:r.right-x.right},border:s.borderTopWidth,shadow:s.boxShadow,images:[...d.querySelectorAll('img')].map(i=>i.complete&&i.naturalWidth>0)};});}
async function capture(page,file){await page.waitForFunction(()=>[...document.querySelectorAll('#promotionsDialog img')].every(i=>i.complete&&i.naturalWidth));const b=await dimensions(page);assert(b.x>=0&&b.y>=0&&b.right<=b.viewport[0]+1&&b.bottom<=b.viewport[1]+1&&b.overflowX<=1,JSON.stringify(b));const purchaseCenter=b.oldPrice&&b.purchase.right-b.purchase.x<=520?b.purchase.center:b.button.center;assert(Math.abs(purchaseCenter-b.cardCenter)<=2,JSON.stringify(b));if(b.oldPrice){assert(b.oldPrice.x>=b.button.right+8&&b.oldPrice.right<=b.purchase.right+1,JSON.stringify(b));assert(Math.abs(b.oldPrice.centerY-b.button.centerY)<=2&&b.oldPrice.fontSize>=20,JSON.stringify(b));}assert.equal(b.serviceLabels,0);assert(Math.abs(b.heading.center-b.cardCenter)<=2,JSON.stringify(b));assert.equal(b.heading.overlap,false);assert.equal(b.border,'0px');assert.equal(b.heading.border,'0px');assert.equal(b.heading.shadow,'none');assert(!b.shadow.includes('inset'));assert(b.close.width>=40&&b.close.height>=40&&b.close.rightGap>=8&&b.close.rightGap<=16,JSON.stringify(b));await page.locator('#promotionsDialog').screenshot({path:path.join(out,file)});return b;}
(async()=>{try{
 at=START;store.open(auth.token);p().loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(at),day:1};
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1366,height:900}});
 await context.addCookies([{name:'sferorumiya_session',value:auth.token,url,httpOnly:true}]);
 await context.addInitScript(()=>{document.addEventListener('killex:arena-profile',e=>window.__arenaProfile=e.detail);document.addEventListener('killex:profile',e=>{window.__profile=e.detail;localStorage.setItem(KillexPlatform.storageKey('.releaseNotes.v1.'+e.detail.id),KillexRelease.id);localStorage.setItem(KillexPlatform.storageKey('.achievement-notices.v1.')+e.detail.id,JSON.stringify(Object.fromEntries((e.detail.progress?.achievements||[]).map(a=>[a.eventRunId?a.id+':'+a.eventRunId:a.id,10]))));});});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()===404)report.missing.push(r.url());});
 await page.goto(url);await page.waitForFunction(()=>window.__profile&&document.body.dataset.screen==='lobby'&&!document.getElementById('playButton').disabled);await close(page);
 for(let i=0;i<(process.env.PROMOTIONS_AUTO_ONLY?1:26);i++){
  at=START+i*WEEK;store.open(auth.token);p().loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(at),day:1};
  const notices=store.view(p()).dailyRankingRewards||[];
  if(notices.length)store.dismissDailyRankingRewards(auth.token,{requestId:randomUUID(),ids:notices.map(n=>n.id)});
  const id=catalog.products[i].id+':2026-11-20:'+i;
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('killex:events-changed')));
  await page.waitForFunction(id=>window.__profile.promotions.includes(id),id);
  await close(page);await page.bringToFront();await page.setViewportSize({width:1366,height:900});await page.locator('#promotionsButton').click();
  await page.locator('.promotion-card[data-product-id="'+id+'"]').waitFor();
  assert.equal(await page.locator('#promotionsTitle').innerText(),catalog.products[i].name);
  const expected=catalog.products[i].rewards.map(r=>[r.id,r.amount]);
  if(i===22){assert.equal(expected.length,7);assert(expected.every(([,amount])=>amount===200));assert.equal(await page.locator('.promotion-rewards li').count(),1);assert.equal(await page.locator('.promotion-reward-name').innerText(),'Клановые бустеры*');assert.equal(await page.locator('.promotion-bundle-note').innerText(),'*По 200 штук каждого кланового бустера');assert.equal(await page.locator('.promotion-buy').innerText(),'Купить за 30 голосов');}
  else{const actual=await page.locator('.promotion-rewards li').evaluateAll(nodes=>nodes.map(n=>[n.dataset.rewardId,Number(n.querySelector('.promotion-amount').textContent.replace(/\s/g,''))]));assert.deepEqual(actual,expected);}
  const name=String(i+1).padStart(2,'0');const desktop=await capture(page,name+'-desktop.png');
  await page.setViewportSize({width:390,height:844});const mobile=await capture(page,name+'-mobile.png');
  for(const viewport of [{width:320,height:568},{width:844,height:390}]){await page.setViewportSize(viewport);await capture(page,name+'-'+viewport.width+'.png');}
  report.offers.push({number:i+1,name:catalog.products[i].name,desktop,mobile});console.log('offer '+(i+1)+' passed');
  if(i===22){const inventory=structuredClone(p().inventory);await page.locator('.promotion-buy').click();await page.locator('#mockPaymentDialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mockPaymentDialog').dataset.state==='success');for(const [booster,amount]of expected)assert.equal((p().inventory[booster]||0)-(inventory[booster]||0),amount);assert(!store.view(p()).promotions.includes(id));report.clanBundlePurchase={kinds:7,amountEach:200,votes:30};await page.locator('#mockPaymentDialog').getByRole('button',{name:'Готово',exact:true}).click();}
 }
 // All simultaneous offers use real server eligibility. Each gets an independent selected view.
 at=START+3600000;store.open(auth.token);p().personal.firstNameSetAt=START;p().level=100;p().progress.xp=require('../../src/server/progression/experience-progression').xpForLevel(100);p().progress.levelOffers={100:START};p().revision++;
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('killex:events-changed')));await page.waitForFunction(()=>window.__profile.promotions.length===4);await close(page);
 await page.setViewportSize({width:1366,height:900});await page.locator('#promotionsButton').click();
 const overlap=['promotion:starter','promotion:advanced','promotion:weekend:01:2026-11-20:0','promotion:century:100'];
 for(let i=0;i<overlap.length;i++){
  await page.locator('.promotion-tab[data-product-id="'+overlap[i]+'"]').click();
  const desktop=await capture(page,'overlap-'+i+'-desktop.png');await page.setViewportSize({width:390,height:844});const mobile=await capture(page,'overlap-'+i+'-mobile.png');for(const viewport of [{width:320,height:568},{width:621,height:900},{width:844,height:390}]){await page.setViewportSize(viewport);await capture(page,'overlap-'+i+'-'+viewport.width+'.png');}await page.setViewportSize({width:1366,height:900});report.overlaps.push({id:overlap[i],desktop,mobile});
 }
 // A real UI confirmation consumes only the selected weekly offer.
 await page.locator('.promotion-tab[data-product-id="'+overlap[2]+'"]').click();const before=structuredClone(p());await page.locator('.promotion-buy').click();await page.locator('#mockPaymentDialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mockPaymentDialog').dataset.state==='success');
 assert.equal(p().wallet.coins-before.wallet.coins,1500);assert.equal(p().wallet.crystals-before.wallet.crystals,100);assert.equal(store.view(p()).promotions.length,3);
 await page.locator('#mockPaymentDialog').getByRole('button',{name:'Готово',exact:true}).click();assert.equal(await page.locator('.promotion-tab').count(),3);
 // The existing presence heartbeat notices a weekly boundary; no new polling loop.
 at=START+60*3600000;const response=await page.request.get(url+'/api/presence');assert.equal((await response.json()).promotionVersion,'');
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForFunction(()=>window.__profile.promotionVersion==='');
 // New occurrence auto-opens once, deferred behind other windows and the arena screen.
 await close(page);await page.evaluate(()=>{document.body.dataset.screen='arena';});
 at=START+26*WEEK;store.open(auth.token);p().loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(at),day:1};
 const notices=store.view(p()).dailyRankingRewards||[];if(notices.length)store.dismissDailyRankingRewards(auth.token,{requestId:randomUUID(),ids:notices.map(n=>n.id)});
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('killex:events-changed')));
 await page.waitForFunction(()=>window.__arenaProfile?.promotionVersion.endsWith(':26'));await page.waitForTimeout(100);assert.equal(await page.locator('#promotionsDialog').evaluate(d=>d.open),false);
 await page.evaluate(()=>{const d=document.createElement('dialog');d.id='testBusyDialog';document.body.append(d);d.showModal();document.body.dataset.screen='lobby';});await page.waitForTimeout(100);assert.equal(await page.locator('#promotionsDialog').evaluate(d=>d.open),false);
 await page.evaluate(()=>document.querySelector('#testBusyDialog').close());await page.locator('#promotionsDialog[open]').waitFor();
 const repeated='promotion:weekend:01:2026-11-20:26';await page.waitForFunction(id=>window.__profile.seenPromotionIds.includes(id),repeated);
 await close(page);await page.reload();await page.waitForFunction(()=>window.__profile&&document.body.dataset.screen==='lobby'&&!KillexBoot.active);await page.waitForTimeout(400);assert.equal(await page.locator('#promotionsDialog').evaluate(d=>d.open),false);
 report.autoOpen='once per occurrence, deferred during arena/other dialog, persists after reload';
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);console.log(report.offers.length+' offers × 4 viewports, overlaps, purchase, boundary and auto-open passed: '+engine);
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
