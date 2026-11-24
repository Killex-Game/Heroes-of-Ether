const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),{once}=require('events');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const game=path.resolve(__dirname,'../..');
let repo=game;while(!fs.existsSync(path.join(repo,'.git'))&&path.dirname(repo)!==repo)repo=path.dirname(repo);
const out=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Usage: node premium-emote-browser.cjs OUTPUT_DIRECTORY');fs.mkdirSync(out,{recursive:true});
const old=cp.execFileSync('git',['show','9b045f1:games/heroes-of-ether/public/arena/emote-renderer.js'],{cwd:repo,encoding:'utf8'});
const {createGameServer}=require(game+'/src/server/game-server');
(async()=>{const results=[];
 for(const engine of (process.env.FRAME_ENGINES||'chromium,firefox,webkit').split(',')){
  const app=createGameServer({autoTick:false,testBots:{enabled:false},arenaPolicy:{...require(game+'/config/arena-rooms.json'),levelGroups:false}});
  app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');const url='http://127.0.0.1:'+app.httpServer.address().port;
  const browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});let interval;
  try{
   const context=await browser.newContext({viewport:{width:1336,height:768}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{const raf=requestAnimationFrame;window.frameProbe={enabled:false,cpu:[],gaps:[],last:null};window.requestAnimationFrame=function(cb){return raf.call(window,function(t){const start=performance.now();cb(t);if(cb.name==='frame'&&frameProbe.enabled){frameProbe.cpu.push(performance.now()-start);if(frameProbe.last!==null)frameProbe.gaps.push(t-frameProbe.last);frameProbe.last=t;}});};});
   const auth=app.profiles.open(),p=app.profiles.find(auth.token);p.name='Проверка кадров';p.personal={nameSet:true,introPending:false,gender:'male',vkUrl:''};
   p.loginReward={date:require(game+'/src/server/accounts/account-benefits').loginRewardDay(Date.now()),day:1};p.account=require(game+'/src/server/accounts/account-benefits').fresh();p.account.premiumUntil=Date.now()+86400000;
   await context.addCookies([{name:'sferorumiya_session',value:auth.token,url}]);await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#playButton').disabled);
   const close=page.getByRole('button',{name:'Закрыть новости',exact:true});if(await close.isVisible())await close.click();
   await page.evaluate(()=>{window.LiveEmoteView=KillexEmoteView;});await page.addScriptTag({content:old+'\nwindow.LegacyEmoteView=KillexEmoteView;window.KillexEmoteView=LiveEmoteView;'});
   await page.evaluate(()=>{const current=LiveEmoteView.Renderer.prototype.draw,legacy=LegacyEmoteView.Renderer.prototype.draw;window.sceneProbe={mode:'new',seen:new Set(),indices:new Map(),positions:{},draws:0};
    LiveEmoteView.Renderer.prototype.draw=function(ctx,p,body,scale,at,bounds){sceneProbe.seen.add(p.id);if(!sceneProbe.indices.has(p.id))sceneProbe.indices.set(p.id,(sceneProbe.indices.size%9)+1);sceneProbe.positions[p.id]={x:body.x,y:body.y,radius:body.radius,scale,skinId:p.skinId};const item=this.active.get(p.id);if(!item||at-item.start>5300)this.receive({playerId:p.id,spawnSerial:p.spawnSerial,index:sceneProbe.indices.get(p.id),variant:'pets'},at);if(this.active.get(p.id)?.until>at)sceneProbe.draws++;return (sceneProbe.mode==='old'?legacy:current).call(this,ctx,p,body,scale,at,bounds);};
   });
   await page.locator('#playButton').click();await page.waitForFunction(()=>document.querySelector('#arena')?.hidden===false);
   const arena=app.arena,own=[...arena.players.values()][0];assert(own);const skins=['moon-dragon','gift-winged-guardian','grove-faun','premium-2'];
   for(let i=0;i<30;i++){const q=i?arena.addPlayer(performance.now(),'frame-fixture-'+i):own;Object.assign(q,{x:2000+(i%6-2.5)*78,y:2000+(Math.floor(i/6)-2)*78,mass:2500,radius:38,skinId:skins[i%4],name:'Кадр '+i});q.targetX=q.x;q.targetY=q.y;q.spawnSerial++;}
   own.x=own.targetX=2000;own.y=own.targetY=2000;interval=setInterval(()=>{arena.tick++;app.broadcast();},50);app.broadcast();
   await page.waitForFunction(()=>sceneProbe.seen.size>=25);await page.waitForTimeout(2000);
   const positions=await page.evaluate(()=>sceneProbe.positions);fs.writeFileSync(out+'/'+engine+'-frame-positions.json',JSON.stringify({server:arena.snapshot(performance.now()).players.map(p=>({id:p.id,x:p.x,y:p.y,parts:p.parts})),client:positions},null,2));
   const batches=[];for(const mode of ['old','new','new','old']){
    await page.evaluate(mode=>{sceneProbe.mode=mode;frameProbe.enabled=false;},mode);await page.waitForTimeout(1500);
    await page.evaluate(()=>{frameProbe.cpu=[];frameProbe.gaps=[];frameProbe.last=null;frameProbe.enabled=true;sceneProbe.draws=0;});await page.waitForTimeout(5400);
    const result=await page.evaluate(()=>{frameProbe.enabled=false;const q=a=>{a.sort((x,y)=>x-y);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};};return {frames:frameProbe.cpu.length,cpu:q(frameProbe.cpu),gap:q(frameProbe.gaps),players:sceneProbe.seen.size,emoteDraws:sceneProbe.draws};});
    assert(result.frames>30&&result.players>=25&&result.emoteDraws>100);batches.push({mode,...result});
   }
   await page.screenshot({path:out+'/'+engine+'-full-frame.png'});assert.equal(errors.length,0);results.push({engine,batches,errors});console.log(JSON.stringify({engine,batches}));
  }finally{clearInterval(interval);await browser.close();await app.close();}
 }
 fs.writeFileSync(out+'/full-frame-browser.json',JSON.stringify({scope:'Full arena renderer with 30 stationary fixture players and real snapshots; ABBA on same scene; continuous Premium emotes with stable mixed indices; desktop headless browsers, not real phone FPS or moving combat',results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
