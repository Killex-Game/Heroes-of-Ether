'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{once}=require('node:events');
const {ProfileStore}=require('../../src/server/profiles/profile-store'),{createGameServer}=require('../../src/server/game-server');
const {sessionCookie}=require('../../public/shared/platform-contract');
const {Arena}=require('../../src/server/arena/arena-simulation');
test('real HTTP gifts record the sender after five windows, ignore retries, and preserve recipient privacy',async t=>{
 let at=Date.UTC(2026,10,22,10);const profiles=new ProfileStore({now:()=>at});
 const a=profiles.open(),b=profiles.open();profiles.find(a.token).wallet.bucks=100000;
 const app=createGameServer({profiles,arena:new Arena({etherCount:0}),autoTick:false,wallNow:()=>at,now:()=>at,rateNow:()=>at,testBots:{enabled:false}});
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');t.after(()=>app.close());
 const url='http://127.0.0.1:'+app.httpServer.address().port;
 const body={action:'gift',giftId:'clover',targetId:b.profile.id,confirmed:true,requestId:randomUUID()};
 async function post(data){const r=await fetch(url+'/api/social/action',{method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie+'='+a.token},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json();}
 assert.equal((await post(body)).replay,false);
 for(let n=0;n<310;n++){at+=1000;assert.equal((await post(body)).replay,true);}
 assert.equal(profiles.find(a.token).kill,undefined);
 for(let n=0;n<450;n++){at+=1000;await post({...body,requestId:randomUUID()});}
 await new Promise(resolve=>setImmediate(resolve));
 const sender=profiles.find(a.token);assert.equal(sender.kill.reason,'lobby-repeated-actions');
 assert.equal(sender.kill.lobbyEvidence.kind,'gift-send');assert(!sender.moderation?.ban);
 assert.equal(profiles.find(b.token).kill,undefined);assert.equal(profiles.view(sender).kill,undefined);
 assert.equal(profiles.publicPlayer(a.profile.id).kill,undefined);
});
test('currency spam after the daily quota is reviewed without awarding extra currency or counting retries',async t=>{
 let at=Date.UTC(2026,10,22,10);const profiles=new ProfileStore({now:()=>at});const a=profiles.open();
 const app=createGameServer({profiles,arena:new Arena({etherCount:0}),autoTick:false,wallNow:()=>at,now:()=>at,rateNow:()=>at,testBots:{enabled:false}});
 app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');t.after(()=>app.close());
 const url='http://127.0.0.1:'+app.httpServer.address().port+'/api/mock-payments/confirm';
 async function post(requestId){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie+'='+a.token},body:JSON.stringify({confirmed:true,productId:'bucks:change',requestId})});return {status:r.status,body:await r.json()};}
 for(let n=0;n<5;n++){at+=1000;assert.equal((await post(randomUUID())).status,200);}
 const wallet=structuredClone(profiles.find(a.token).wallet),retryId=randomUUID();
 for(let n=0;n<450;n++){at+=1000;assert.notEqual((await post(retryId)).status,200);}
 assert.equal(profiles.find(a.token).kill,undefined);
 for(let n=0;n<450;n++){at+=1000;assert.notEqual((await post(randomUUID())).status,200);}
 await new Promise(resolve=>setImmediate(resolve));const p=profiles.find(a.token);
 assert.equal(p.kill.lobbyEvidence.kind,'currency-purchase-attempt');assert.deepEqual(p.wallet,wallet);assert(!p.moderation?.ban);
});
