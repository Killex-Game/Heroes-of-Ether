"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path");
const {randomUUID}=require("node:crypto"),{once}=require("node:events"),WebSocket=require("ws");
const {temporary}=require("../temp"),{ProfileStore}=require("../../src/server/profiles/profile-store");
const {createGameServer}=require("../../src/server/game-server"),{Arena}=require("../../src/server/arena/arena-simulation");
const {recover}=require("../../src/server/profiles/profile-journal");
async function fixture(t){
 let app;t.after(async()=>{await app?.close();});
 const filePath=path.join(temporary(t,"arena-gift"),"profiles.json"),store=new ProfileStore({filePath,journal:true});
 const a=store.open(),b=store.open();store.transact(a.token,randomUUID(),"fund",p=>{p.wallet.bucks=100;p.wallet.crystals=100;});
 app=createGameServer({profiles:store,arena:new Arena({etherCount:0}),autoTick:false,testBots:{enabled:false}});
 app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");const url="http://127.0.0.1:"+app.httpServer.address().port;
 const sockets=[];t.after(()=>{for(const s of sockets)s.terminate();});
 async function join(user){const ws=new WebSocket(url.replace("http:","ws:"),{headers:{Cookie:"sferorumiya_session="+user.token}});sockets.push(ws);return new Promise((resolve,reject)=>{ws.on("error",reject);ws.on("message",raw=>{const v=JSON.parse(raw);if(v.type==="welcome")resolve(v.id);});});}
 const sender=await join(a),target=await join(b);
 const request=async(route,body)=>{const r=await fetch(url+route,{method:body?"POST":"GET",headers:{Cookie:"sferorumiya_session="+a.token,Origin:url,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const gift=extra=>({action:"gift",giftId:"skull",targetId:b.profile.id,confirmed:true,requestId:randomUUID(),...extra});
 return {app,store,a,b,sender,target,request,gift,saved:()=>recover(filePath).data};
}
test("arena profile, gift catalogue and named or anonymous gifts work with exactly-once durable debits",async t=>{
 const f=await fixture(t);assert.equal((await f.request("/api/players/"+f.b.profile.id)).status,200);assert.equal((await f.request("/api/social")).status,200);
 const body=f.gift(),results=await Promise.all([f.request("/api/social/action",body),f.request("/api/social/action",body)]);
 assert(results.every(r=>r.status===200));assert.equal(results.filter(r=>r.body.replay).length,1);
 assert.equal(f.store.find(f.a.token).wallet.bucks,95);assert.equal(f.store.find(f.b.token).social.gifts.find(g=>g.id==="skull").count,1);
 const anonymous=f.gift({action:"gift-anonymous",anonymous:true});assert.equal((await f.request("/api/social/action",anonymous)).status,200);
 const publicProfile=(await f.request("/api/players/"+f.b.profile.id)).body.player;
 const history=publicProfile.social.gifts.find(g=>g.id==="skull").history;assert(history.some(h=>h.anonymous&&!h.fromId&&!h.fromName));
 assert.equal((await f.request("/api/social/gifts?playerId="+f.b.profile.id+"&giftId=skull")).status,200);
 f.app.tick();assert.equal(f.app.arena.players.get(f.target).giftModifiers.xp,0.75);
 assert.equal(f.app.arena.players.get(f.sender).dead,false);
 const saved=Object.values(f.saved().profiles);assert.equal(saved.find(p=>p.id===f.a.profile.id).wallet.bucks,90);assert.equal(saved.find(p=>p.id===f.b.profile.id).social.gifts.find(g=>g.id==="skull").count,2);
 assert.equal((await f.request("/api/profile/loadout",{skinId:"forest-spirit",quickSlots:[],requestId:randomUUID()})).status,409);
 assert.equal((await f.request("/api/social/action",{action:"invite",targetId:f.b.profile.id,name:f.b.profile.name,requestId:randomUUID()})).status,409);
});
test("failed arena gift write changes neither participant and the same request can be retried",async t=>{
 const f=await fixture(t),before=structuredClone(f.store.data),body=f.gift();
 const mock=t.mock.method(f.store,"save",()=>{throw Error("test disk failure");});
 assert.equal((await f.request("/api/social/action",body)).status,500);assert.deepEqual(f.store.data,before);mock.mock.restore();
 assert.equal((await f.request("/api/social/action",body)).status,200);assert.equal(f.store.find(f.a.token).wallet.bucks,95);
});
