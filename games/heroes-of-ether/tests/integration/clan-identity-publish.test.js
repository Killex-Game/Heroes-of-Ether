"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{once}=require("node:events"),{randomUUID}=require("node:crypto");
const WebSocket=require("ws"),{createGameServer}=require("../../src/server/game-server"),{ProfileStore}=require("../../src/server/profiles/profile-store");

test("clan writes immediately refresh affected arena members, not unrelated players or replays",async t=>{
  const at=Date.UTC(2026,10,24,12),profiles=new ProfileStore({now:()=>at});
  const app=createGameServer({profiles,autoTick:false,wallNow:()=>at,testBots:{enabled:false},
    arenaPolicy:{...require("../../config/arena-rooms.json"),levelGroups:false}});
  const sockets=[];t.after(async()=>{for(const socket of sockets)socket.terminate();await app.close();});
  app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");
  const base=`http://127.0.0.1:${app.httpServer.address().port}`;
  const player=()=>{const auth=profiles.open(),p=profiles.find(auth.token);p.level=20;
    p.progress.xp=require("../../src/server/progression/experience-progression").xpForLevel(20);
    p.wallet.coins=10000;p.wallet.bucks=10000;p.wallet.crystals=1000;return auth;};
  const api=async(auth,path,body)=>{const response=await fetch(base+path,{method:"POST",headers:{
    Cookie:`sferorumiya_session=${auth.token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
  const clan=(auth,body)=>api(auth,"/api/clans/action",{requestId:randomUUID(),...body});
  const head=player(),a=player(),b=player(),unrelated=player();
  await clan(head,{action:"create",name:"Нагрузочный клан",prefix:"LOAD",emblem:"astral",privacy:"open"});
  const id=profiles.find(head.token).clanId;
  for(const auth of [a,b])await clan(auth,{action:"apply",clanId:id});
  const connect=async auth=>{const reservation=await api(auth,"/api/arena-reservations",{requestId:randomUUID()});
    const ws=new WebSocket(base.replace("http:","ws:")+reservation.wsPath,[`ticket.${reservation.ticket}`],{headers:{Cookie:`sferorumiya_session=${auth.token}`}});
    sockets.push(ws);const messages=[];ws.on("message",raw=>messages.push(JSON.parse(raw)));await once(ws,"open");
    const drain=async()=>{const done=once(ws,"pong");ws.ping();await done;};await drain();messages.length=0;return {ws,messages,drain};};
  const connected=await Promise.all([a,b,unrelated].map(connect));
  const operation=async(body,expected)=>{
    for(const c of connected)c.messages.length=0;
    const result=await clan(head,{clanId:id,...body});await Promise.all(connected.map(c=>c.drain()));
    for(let i=0;i<connected.length;i++)assert.equal(connected[i].messages.filter(m=>m.type==="profile").length,expected.includes(i)?1:0,`recipient ${i}, ${body.action}`);
    return result;
  };
  await operation({action:"edit",name:"Новое имя",prefix:"NEW"},[0,1]);
  for(const c of connected.slice(0,2))assert.equal(c.messages.find(m=>m.type==="profile").profile.clanPrefix,"NEW");
  const requestId=randomUUID();await operation({action:"deposit",amount:1000,requestId},[0,1]);
  const replay=await operation({action:"deposit",amount:1000,requestId},[]);assert.equal(replay.replay,true);
  const before=profiles.find(a.token).inventory.warheads||0;
  await operation({action:"buyBooster",boosterId:"warheads"},[0,1]);
  assert.equal(connected[0].messages.find(m=>m.type==="profile").profile.inventory.warheads,before+10);
  await operation({action:"kick",memberId:a.profile.id},[0,1]);
  assert.equal(connected[0].messages.find(m=>m.type==="profile").profile.clanId,null);
  await operation({action:"disband"},[1]);
  assert.equal(connected[1].messages.find(m=>m.type==="profile").profile.clanId,null);
});
