'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const pw=require('playwright');
const game=path.resolve(__dirname,'../..'),req=require('module').createRequire(game+'/package.json');
const artifacts=process.env.KILLEX_TEST_ARTIFACTS||path.join(__dirname,'../artifacts/stable-refresh');fs.mkdirSync(artifacts,{recursive:true});
const {ProfileStore}=req('./src/server/profiles/profile-store'),{createGameServer}=req('./src/server/game-server');
(async()=>{const results=[];for(const engine of process.argv[2]?[process.argv[2]]:['chromium','firefox','webkit']){
 const profiles=new ProfileStore({clanDailyQuests:true}),auth=profiles.open();profiles.claimLoginReward(auth.token);const p=profiles.find(auth.token);
 p.name='Проверка';p.personal={...p.personal,nameSet:true,introPending:false,gender:'male',vkUrl:''};p.account={...req("./src/server/accounts/account-benefits").fresh(),premiumUntil:Date.now()+86400000};p.appearance={...p.appearance,avatarFrame:'canon_premium',arenaFrame:'canon_premium',unlocked:['glass']};p.grantedSkins=['gift-winged-guardian'];
 p.level=79;p.progress.xp=req('./src/server/progression/experience-progression').xpForLevel(79);p.wallet={coins:100000,crystals:10000,bucks:10000};
 const app=createGameServer({profiles,testBots:{enabled:false}});let browser;
 try{
  await new Promise(r=>app.httpServer.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.httpServer.address().port;
  browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Asia/Yekaterinburg'});await context.addCookies([{name:'sferorumiya_session',value:auth.token,url}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()===404)errors.push('404 '+r.url())});
  await page.addInitScript(() => {
    window.qaInstances = {};
    for (const name of ['KillexCosmeticsUI','KillexPetsUI','KillexBoosterUI','KillexPromotionsUI','KillexQuestsUI','KillexEasterPage','KillexHallOfFame','KillexAccountsUI','KillexAchievementUI','KillexClanUI']) {
      let C;
      Object.defineProperty(window, name, { configurable: true, get: () => C, set: v => {
        C = new Proxy(v, { construct(T, args, newTarget) {
          const value = Reflect.construct(T, args, newTarget);
          qaInstances[name] = value; return value;
        } });
      } });
    }
  });
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>document.body.dataset.screen==='lobby'&&!KillexBoot?.active);
  for(let i=0;i<8;i++){await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close()});await page.waitForTimeout(100);}


  const checked=await page.evaluate(async()=>{
    const Q=qaInstances,booster=Q.KillexBoosterUI,base=structuredClone(booster.profile),log=[];
    const ensure=(v,m)=>{if(!v)throw Error(m)};
    const pulse=(patch={})=>{const p=structuredClone(booster.profile);Object.assign(p,patch);p.revision++;booster.updateProfile(p);};
    const stable=(label,selector,fn)=>{const old=document.querySelector(selector);ensure(old,label+' missing '+selector);fn();ensure(document.querySelector(selector)===old,label+' recreated');log.push(label);};
    pulse({title:{id:'novice',degree:1,name:'Новичок'}});
    stable('profile medal','#profileMedal img',()=>pulse());stable('account crown','#accountMarks img',()=>pulse());
    Q.KillexCosmeticsUI.openSkins();
    stable('wardrobe avatar','#skinsDialog .account-avatar img',()=>{for(let i=0;i<8;i++)pulse();});
    stable('wardrobe wallet change','#skinsDialog .account-avatar img',()=>pulse({wallet:{...booster.profile.wallet,coins:12345}}));
    const oldSelection=document.querySelector('#skinsDialog .account-avatar');oldSelection.focus();pulse();ensure(document.activeElement===oldSelection,'wardrobe focus lost');
    Q.KillexCosmeticsUI.skins.close();
    const pets=Q.KillexPetsUI;await pets.open();
    stable('pet portrait','#petsDialog .pet-portrait',()=>pulse());stable('pet gallery','#petsDialog .pet-choice img',()=>pulse());
    stable('pet wallet portrait','#petsDialog .pet-portrait',()=>pulse({wallet:{...booster.profile.wallet,coins:12346}}));stable('pet wallet gallery','#petsDialog .pet-choice img',()=>pulse({wallet:{...booster.profile.wallet,coins:12347}}));
    const prior=document.querySelector('#petsDialog .pet-portrait').getAttribute('src');document.querySelector('#petsDialog [data-pet="manya"]').click();ensure(document.querySelector('#petsDialog .pet-portrait').getAttribute('src')!==prior,'pet selection stale');log.push('pet selection changes');pets.dialog.close();
    const achievement=Q.KillexAchievementUI;achievement.render(booster.profile);const trophy=achievement.sidebar.querySelector('img');achievement.render(structuredClone(booster.profile));ensure(achievement.sidebar.querySelector('img')===trophy,'honor image rebuilt');log.push('achievement shelf');
    const quests=Q.KillexQuestsUI;await quests.open();stable('quest chest','.quest-card img',()=>pulse());quests.dialog.close();
    const easter=Q.KillexEasterPage;easter.open();stable('easter ether','.easter-ether-icon',()=>{for(let i=0;i<8;i++)easter.render()});easter.dialog.close();
    const promotions=Q.KillexPromotionsUI;booster.profile.promotionPreview={cycleMs:60000};promotions.render();stable('promotion image','.promotion-card img',()=>{for(let i=0;i<8;i++)promotions.render()});
    const hall=Q.KillexHallOfFame;hall.data={top:[{id:'qa',skinId:KillexIdentity.skins[0].id,name:'Герой',rank:1,greatness:2000000}],heroes:[],total:1,page:1,pages:1};hall.render();const portrait=hall.slots[0].portrait.firstChild;hall.data.top[0].greatness++;hall.render();ensure(hall.slots[0].portrait.firstChild===portrait,'hall score replaced portrait');log.push('hall score change');const compact=hall.compact.firstChild;hall.render();ensure(hall.compact.firstChild===compact,'hall unchanged compact');log.push('hall compact');
    booster.setShopCategory('boosters');let shopArt=booster.grid.querySelector('img');ensure(shopArt,'shop art missing');pulse();ensure(booster.grid.querySelector('img')===shopArt,'shop rebuilt');log.push('booster shop unchanged');
    booster.accessoryCategory='hat';booster.renderAccessories();let accessoryArt=booster.accessoryShop.querySelector('img');ensure(accessoryArt,'accessory art missing');booster.renderAccessories();ensure(booster.accessoryShop.querySelector('img')===accessoryArt,'accessory shop rebuilt');log.push('accessory shop unchanged');
    booster.chests.render();let chestArt=booster.chests.root.querySelector('img');ensure(chestArt,'title chest missing');booster.chests.render();ensure(booster.chests.root.querySelector('img')===chestArt,'title chest rebuilt');log.push('title chests unchanged');
    pulse({easter:{...booster.profile.easter,chests:[{id:'qa-chest',stored:true}]}});booster.clanChests.render();let treasuryArt=booster.clanChests.root.querySelector('img');ensure(treasuryArt,'treasury chest missing');booster.clanChests.render();ensure(booster.clanChests.root.querySelector('img')===treasuryArt,'treasury rebuilt');log.push('treasury unchanged');
    pulse({wallet:{coins:0,crystals:0,bucks:0}});ensure([...booster.grid.querySelectorAll('.booster-action')].every(b=>b.disabled),'empty wallet left a purchase enabled');log.push('shop affordability updates');
    const originalGetMe=booster.game.getMe,originalSlotCount=booster.slotCount;booster.game.getMe=()=>({boosters:{},effects:{},boosterLimit:50});let count=5;booster.slotCount=()=>count;booster.cooldown=()=>({ms:0,duration:10000});booster.slotBlocked=()=>false;booster.slots[0]='fire';booster.updateQuick();const slot=booster.slotButtons[0],icon=slot.querySelector('img');ensure(icon,'quick slot icon');count=4;booster.updateQuick();ensure(slot.querySelector('img')===icon,'quick count rebuilt image');ensure(slot.querySelector('.booster-slot-count').textContent==='4','quick count stale');log.push('quick count changes without image replacement');booster.game.getMe=originalGetMe;booster.slotCount=originalSlotCount;
    const clanUI=Q.KillexClanUI,preview=clanUI.preview;
    const dto={clan:{id:'preview',prefix:'QA',name:'Проверка',description:'',emblem:'astral',crest:KillexClanCrests.DEFAULT,appearance:{},progress:{level:10},count:30,capacity:40,members:Array.from({length:30},(_,i)=>({...structuredClone(booster.profile),id:'preview-'+i,name:'Участник '+i,role:i?'member':'head',online:false}))},competition:{mode:'quests',medals:{bronze:1},trophies:[]}};
    preview.render(dto);KillexWindows.open(preview.dialog);const roster=preview.content.querySelector('.clan-preview-member-list');roster.scrollTop=roster.scrollHeight;const scrollBefore=roster.scrollTop;ensure(scrollBefore>100,'preview list did not overflow');const avatar=preview.content.querySelector('.clan-member-avatar'),frame=avatar.querySelector('canvas'),medal=preview.content.querySelector('.clan-preview-awards img');
    for(let i=0;i<8;i++){dto.competition.serverNow=Date.now()+i*5000;preview.render(structuredClone(dto));}
    ensure(preview.content.querySelector('.clan-member-avatar')===avatar&&avatar.querySelector('canvas')===frame,'preview replaced avatar/frame');ensure(Math.abs(preview.content.querySelector('.clan-preview-member-list').scrollTop-scrollBefore)<2,'preview scroll reset');ensure(preview.content.querySelector('.clan-preview-awards img')===medal,'preview medal replaced');log.push('public clan portrait, frame, awards and scroll stable');
    dto.clan.members[0].online=true;preview.render(dto);ensure(preview.content.querySelector('.player-online-indicator').dataset.online==='true','preview presence stale');ensure(preview.content.querySelector('.clan-member-avatar')===avatar,'presence replaced portrait');log.push('public clan presence updates');preview.dialog.close();
    return log;
  });
  assert(checked.length>=15);assert.deepEqual(errors,[]);results.push({engine,checked,errors});console.log(engine+' PASS '+checked.length);
 }finally{await browser?.close();await app.close();}}
 fs.writeFileSync(artifacts+'/browser-'+(process.argv[2]||'all')+'.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
