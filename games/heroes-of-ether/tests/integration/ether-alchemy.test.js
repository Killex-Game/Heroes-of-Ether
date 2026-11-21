"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),{once}=require("node:events"),{randomUUID}=require("node:crypto");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),{temporary}=require("../temp"),{EventManager}=require("../../src/server/events/event-manager"), A=require("../../src/server/events/ether-alchemy");
const {createGameServer}=require("../../src/server/game-server"),{Arena}=require("../../src/server/arena/arena-simulation"),WS=require("ws");
function setup(t,options={}){
 const filePath=path.join(temporary(t,"ether-alchemy"),"profiles.json"),at=Date.UTC(2026,10,16,12),store=new ProfileStore({...options,filePath,now:()=>at});
 const events=store.events=new EventManager({now:()=>at});events.apply("test","start",{eventId:A.manifest.id,revision:events.data.revision,requestId:randomUUID()});
 const user=store.open();store.transact(user.token,randomUUID(),"fixture",p=>{
  p.level=25;p.progress=require("../../src/server/progression/experience-progression").freshProgress(25);
  p.alchemy={version:1,natural:150000,ingredients:{mushroom:3,leaf:3,berries:5},learned:[],equipped:"strength"};
  p.inventory.alchemy_strength=2;p.inventory.alchemy_swiftness=2;
 });
 return{filePath,at,store,events,user,p:()=>store.find(user.token)};
}
test("brew and exchange roll back on save failure, survive restart and replay exactly once",t=>{
 const f=setup(t),save=f.store.save;
 for(const input of [{action:"brew",potionId:"strength",runId:f.events.active().id,requestId:randomUUID()},{action:"exchange",requestId:randomUUID()}]){
  const before=structuredClone(f.store.data);f.store.save=()=>{throw Error("fsync failure")};
  assert.throws(()=>A.mutate(f.store,f.user.token,input),/fsync failure/);assert.deepEqual(f.store.data,before);
  f.store.save=save;A.mutate(f.store,f.user.token,input);const onceOnly=structuredClone(f.p());
  const restored=new ProfileStore({filePath:f.filePath,now:()=>f.at});restored.events=f.events;
  assert.equal(A.mutate(restored,f.user.token,input).replay,true);assert.deepEqual(restored.find(f.user.token),onceOnly);
 }
 assert.equal(f.p().alchemy.natural,50000);assert.equal(f.p().inventory.alchemy_strength,7);
});
test("network Z slot enforces selected potion and one per life; laboratory requires lobby",async t=>{
 const f=setup(t),arena=new Arena({etherCount:0}),app=createGameServer({profiles:f.store,events:f.events,arena,autoTick:false,wallNow:()=>f.at,now:()=>5000,testBots:{enabled:false}});
 t.after(()=>app.close());app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");const url="http://127.0.0.1:"+app.httpServer.address().port;
 const ws=new WS(url.replace("http","ws"),{headers:{Cookie:"sferorumiya_session="+f.user.token}});t.after(()=>ws.terminate());
 const messages=[];ws.on("message",raw=>messages.push(JSON.parse(raw)));
 async function wait(type,from=0){const signal=AbortSignal.timeout(5000);for(;;){const m=messages.slice(from).find(m=>m.type===type);if(m)return m;await once(ws,"message",{signal});}}
 const welcome=await wait("welcome"),p=arena.players.get(welcome.id);p.protectedUntil=0;
 async function use(id,requestId=randomUUID()){const from=messages.length;ws.send(JSON.stringify({type:"useBooster",requestId,boosterId:id,spawnSerial:p.spawnSerial}));return wait("boosterResult",from);}
 assert.equal((await use("alchemy_swiftness")).ok,false);assert.equal(f.p().inventory.alchemy_swiftness,2);
 const id=randomUUID();assert.equal((await use("alchemy_strength",id)).ok,true);assert.equal(p.potion.id,"strength");assert.equal(f.p().inventory.alchemy_strength,1);
 assert.equal((await use("alchemy_strength",id)).replay,true);assert.equal(f.p().inventory.alchemy_strength,1);
 assert.equal((await use("alchemy_strength")).ok,false);assert.equal(f.p().inventory.alchemy_strength,1);
 const r=await fetch(url+"/api/alchemy/action",{method:"POST",headers:{"Content-Type":"application/json",Cookie:"sferorumiya_session="+f.user.token,Origin:url},body:JSON.stringify({action:"exchange",requestId:randomUUID()})});
 assert.equal(r.status,409);assert.equal(f.p().alchemy.natural,150000);
});

test("Z waits for durable journal; a life ending during fsync keeps the potion",async t=>{
 let app;t.after(()=>app?.close());
 const f=setup(t,{journal:true}),arena=new Arena({etherCount:0});app=createGameServer({profiles:f.store,events:f.events,arena,autoTick:false,wallNow:()=>f.at,now:()=>5000,testBots:{enabled:false}});
 app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");
 const ws=new WS("ws://127.0.0.1:"+app.httpServer.address().port,{headers:{Cookie:"sferorumiya_session="+f.user.token}});t.after(()=>ws.terminate());
 const messages=[];ws.on("message",raw=>messages.push(JSON.parse(raw)));
 async function wait(type){const signal=AbortSignal.timeout(5000);for(;;){const m=messages.find(m=>m.type===type);if(m)return m;await once(ws,"message",{signal});}}
 const welcome=await wait("welcome"),p=arena.players.get(welcome.id);p.protectedUntil=0;
 let entered,release;const gate=new Promise(r=>release=r),staged=new Promise(r=>entered=r),stage=f.store.journal.stage.bind(f.store.journal);
 t.after(()=>release());let count=0;
 t.mock.method(f.store.journal,"stage",async next=>{const result=await stage(next);if(++count===1){entered();await gate;}return result;});
 ws.send(JSON.stringify({type:"useBooster",requestId:randomUUID(),boosterId:"alchemy_strength",spawnSerial:p.spawnSerial}));
 await staged;assert.equal(p.potion,null);assert.equal(f.p().inventory.alchemy_strength,2);
 p.dead=true;release();assert.equal((await wait("boosterResult")).ok,false);
 assert.equal(f.p().inventory.alchemy_strength,2);assert.equal(p.potion,null);
});
