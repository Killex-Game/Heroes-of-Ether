'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{once}=require('events'),{randomUUID}=require('crypto'),pw=require('playwright');
const f=require('../helpers/black-friday-fixture')(),p=f.p();p.name='Арден';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};p.level=30;p.progress.xp=require('../../src/server/progression/experience-progression').xpForLevel(30);p.wallet={coins:123456,bucks:123456,crystals:123456};
p.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(f.now()),day:1};
p.alchemy={version:1,natural:0,ingredients:{},learned:[],queue:['precision'],equipped:'precision'};p.inventory.alchemy_precision=0;
const {GameGrants}=require('../../src/server/admin/game-grants'),grants=new GameGrants({profiles:f.store,access:{isOwner:()=>true},now:f.now});
const preview=grants.preview(p,{title:'Подарок',message:'Зелья для арены',rewards:['fortitude','prosperity'].map(id=>({kind:'booster',id:'alchemy_'+id,amount:1}))});
grants.create(p,{previewId:preview.previewId,requestId:randomUUID(),confirmed:true});grants.deliver();
const out=process.env.KILLEX_TEST_ARTIFACTS||path.resolve(__dirname,'../artifacts/gift-potion-ui'),engine=process.argv[2]||'chromium',report={engine,errors:[],checks:[]};fs.mkdirSync(out,{recursive:true});let browser;
const app=require('../../src/server/game-server').createGameServer({profiles:f.store,events:f.manager,autoTick:true,testBots:{enabled:false},wallNow:f.now});
(async()=>{try{
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1366,height:900}});await context.addCookies([{name:'sferorumiya_session',value:f.user.token,url}]);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById('playButton').disabled);
 for(let i=0;i<25;i++){await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]')){const ok=[...d.querySelectorAll('button')].find(b=>['Отлично','Отлично!','Спасибо!','Понятно'].includes(b.textContent.trim()));if(ok&&!ok.disabled)ok.click();else d.close();}});await page.waitForTimeout(100);}
 if(await page.locator('.effi-lobby-dismiss').isVisible())await page.locator('.effi-lobby-dismiss').click();await page.locator('#inventorySection').click();
 for(const name of ['Зелье стойкости','Зелье изобилия']){const card=page.locator('.booster-card').filter({has:page.getByRole('heading',{name,exact:true})});await card.getByRole('button',{name:'В очередь Z',exact:true}).click();await page.waitForTimeout(200);}
 assert.deepEqual(f.store.find(f.user.token).alchemy.queue,['fortitude','prosperity']);report.checks.push('actual owner gifts equip despite old empty queue');await page.screenshot({path:path.join(out,engine+'-gifted-potions.png')});
 await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
 await page.evaluate(p=>{const host=document.createElement('div');host.id='giftUiFixture';document.body.append(host);KillexSocial.giftButton(host,p);host.querySelector('button').click();},f.store.view(f.store.find(f.user.token)));
 await page.waitForSelector('.social-gift-card');
 for(const width of [1366,390]){await page.setViewportSize({width,height:900});
  for(const name of ['Чары','Заражение','Проклятье']){const card=page.locator('.social-gift-card').filter({has:page.locator('strong',{hasText:name})});await card.scrollIntoViewIfNeeded();
   const geometry=await card.evaluate(e=>({card:e.getBoundingClientRect().toJSON(),children:[...e.children].map(x=>x.getBoundingClientRect().toJSON()),small:e.querySelector('small').textContent}));
   assert.match(geometry.small,/мин\./);for(let i=1;i<geometry.children.length;i++)assert(geometry.children[i].y>=geometry.children[i-1].bottom-1,'card children must not overlap');
   await card.locator('strong').hover();await page.waitForSelector('#boosterTooltip:popover-open');assert.match(await page.locator('#boosterTooltip').innerText(),/опыту.*скорости/s);assert.match(await page.locator('#boosterTooltip').innerText(),/Действует/);
  }
  await page.screenshot({path:path.join(out,engine+'-gift-tooltips-'+width+'.png')});report.checks.push('gift layout and complete hover descriptions '+width);
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{fs.writeFileSync(path.join(out,engine+'-gift-potion-ui.json'),JSON.stringify(report,null,2));await browser?.close();await app.close();}console.log(JSON.stringify({engine,passed:true}));})().catch(e=>{console.error(e);process.exitCode=1});
